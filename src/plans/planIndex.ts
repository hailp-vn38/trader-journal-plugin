import { TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { normalizeTradeImages, stringifyValue } from '../trades/format';
import { splitFrontmatter } from '../trades/parser';
import { extractPlans, getPlanRootFolder, isPotentialPlanFile, normalizeLinkedTrades, normalizePlanEndDate, normalizePlanStatus } from './storage';
import type { TradePlanBias, TradePlanEntry, TradePlanStatus } from './types';

const MAX_INDEXED_PLAN_DAYS = 730;

export interface JournalCalendarPlan {
	id: string;
	file: TFile;
	filePath: string;
	symbol: string;
	title: string;
	status: TradePlanStatus;
	bias: TradePlanBias | null;
	setup: string;
	timeframes: string[];
	startDate: string;
	endDate: string | null;
	notes: string;
	imageCount: number;
	linkedTradeCount: number;
	sortTime: number;
	plan: TradePlanEntry;
}

export interface JournalCalendarPlanDay {
	date: string;
	openPlanCount: number;
	closedPlanCount: number;
	cancelledPlanCount: number;
	plans: JournalCalendarPlan[];
}

export interface JournalPlanSnapshot {
	daysByDate: Record<string, JournalCalendarPlanDay>;
	dayDates: string[];
	planCount: number;
	plans: JournalCalendarPlan[];
}

interface JournalPlanFileEntry {
	path: string;
	plans: JournalCalendarPlan[];
}

export class JournalPlanIndex {
	private readonly plugin: TraderJournalPlugin;
	private readonly entriesByPath = new Map<string, JournalPlanFileEntry>();

	constructor(plugin: TraderJournalPlugin) {
		this.plugin = plugin;
	}

	async rebuild(): Promise<JournalPlanSnapshot> {
		this.entriesByPath.clear();

		const files = getPlanFiles(this.plugin);
		const entries = await Promise.all(files.map((file) => this.readFileEntry(file)));

		for (const entry of entries) {
			if (entry) {
				this.entriesByPath.set(entry.path, entry);
			}
		}

		return this.getSnapshot();
	}

	async updateFile(file: TFile): Promise<JournalPlanSnapshot> {
		this.entriesByPath.delete(file.path);

		if (isPotentialPlanFile(this.plugin, file)) {
			const entry = await this.readFileEntry(file);
			if (entry) {
				this.entriesByPath.set(entry.path, entry);
			}
		}

		return this.getSnapshot();
	}

	removePath(path: string): JournalPlanSnapshot {
		this.entriesByPath.delete(path);
		return this.getSnapshot();
	}

	getSnapshot(): JournalPlanSnapshot {
		const daysByDate: Record<string, JournalCalendarPlanDay> = {};
		const plans: JournalCalendarPlan[] = [];

		for (const entry of this.entriesByPath.values()) {
			for (const plan of entry.plans) {
				plans.push(plan);
				for (const date of getPlanDisplayDates(plan)) {
					const day =
						daysByDate[date] ??
						(daysByDate[date] = {
							date,
							openPlanCount: 0,
							closedPlanCount: 0,
							cancelledPlanCount: 0,
							plans: [],
						});

					if (plan.status === 'closed') {
						day.closedPlanCount += 1;
					} else if (plan.status === 'cancelled') {
						day.cancelledPlanCount += 1;
					} else {
						day.openPlanCount += 1;
					}

					day.plans.push(plan);
				}
			}
		}

		for (const day of Object.values(daysByDate)) {
			day.plans.sort((firstPlan, secondPlan) => {
				if (firstPlan.status !== secondPlan.status) {
					return getPlanStatusSortValue(firstPlan.status) - getPlanStatusSortValue(secondPlan.status);
				}

				if (firstPlan.sortTime !== secondPlan.sortTime) {
					return secondPlan.sortTime - firstPlan.sortTime;
				}

				return firstPlan.title.localeCompare(secondPlan.title);
			});
		}

		return {
			daysByDate,
			dayDates: Object.keys(daysByDate).sort(),
			planCount: plans.length,
			plans: plans.sort((first, second) => second.sortTime - first.sortTime),
		};
	}

	private async readFileEntry(file: TFile): Promise<JournalPlanFileEntry | null> {
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const { body } = splitFrontmatter(content);
			const plans = extractPlans(body);
			if (plans.length === 0) {
				return null;
			}

			return {
				path: file.path,
				plans: plans
					.map((plan, index) => createCalendarPlan(file, plan, index))
					.filter((plan): plan is JournalCalendarPlan => plan !== null),
			};
		} catch (error) {
			console.error(`Trader Journal failed to index plan ${file.path}`, error);
			return null;
		}
	}
}

function createCalendarPlan(file: TFile, plan: TradePlanEntry, index: number): JournalCalendarPlan | null {
	const id = stringifyValue(plan.id) || `${file.path}-${index}`;
	const symbol = normalizeSymbol(stringifyValue(plan.symbol));
	const title = stringifyValue(plan.title);
	const startDate = stringifyValue(plan.start_date);

	if (!symbol || !title || !isDateKey(startDate)) {
		return null;
	}

	return {
		id,
		file,
		filePath: file.path,
		symbol,
		title,
		status: normalizePlanStatus(plan.status),
		bias: normalizePlanBias(plan.bias),
		setup: stringifyValue(plan.setup),
		timeframes: formatPlanTimeframes(plan.timeframes),
		startDate,
		endDate: normalizePlanEndDate(plan.end_date),
		notes: stringifyValue(plan.notes),
		imageCount: normalizeTradeImages(plan.images).length,
		linkedTradeCount: normalizeLinkedTrades(plan.linked_trades).length,
		sortTime: parseDateMs(stringifyValue(plan.updated_at)) ?? file.stat.mtime + index,
		plan,
	};
}

function getPlanFiles(plugin: TraderJournalPlugin): TFile[] {
	const rootFolder = plugin.app.vault.getAbstractFileByPath(getPlanRootFolder(plugin));
	if (!(rootFolder instanceof TFolder)) {
		return [];
	}

	const files: TFile[] = [];
	collectPlanFiles(plugin, rootFolder, files);
	return files;
}

function collectPlanFiles(plugin: TraderJournalPlugin, folder: TFolder, files: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectPlanFiles(plugin, child, files);
			continue;
		}

		if (child instanceof TFile && isPotentialPlanFile(plugin, child)) {
			files.push(child);
		}
	}
}

function getPlanDisplayDates(plan: JournalCalendarPlan): string[] {
	const startDate = parseDateKey(plan.startDate);
	if (!startDate) {
		return [];
	}

	const todayKey = formatDateKey(new Date());
	const fallbackEndDate = plan.status === 'open' ? todayKey : plan.startDate;
	const endDateKey = plan.endDate ?? fallbackEndDate;
	const endDate = parseDateKey(endDateKey) ?? startDate;
	const dates: string[] = [];

	for (let index = 0, date = new Date(startDate); date <= endDate && index < MAX_INDEXED_PLAN_DAYS; index += 1) {
		dates.push(formatDateKey(date));
		date = new Date(date);
		date.setDate(date.getDate() + 1);
	}

	return dates;
}

function normalizePlanBias(value: unknown): TradePlanBias | null {
	return value === 'long' || value === 'short' || value === 'neutral' ? value : null;
}

function formatPlanTimeframes(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => stringifyValue(item)).filter(Boolean);
	}

	if (typeof value === 'string') {
		return value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}

	return [];
}

function getPlanStatusSortValue(status: TradePlanStatus): number {
	if (status === 'open') {
		return 0;
	}

	if (status === 'closed') {
		return 1;
	}

	return 2;
}

function parseDateMs(value: string): number | null {
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? null : parsed;
}

function isDateKey(value: string): boolean {
	return parseDateKey(value) !== null;
}

function parseDateKey(dateKey: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
		return null;
	}

	const [yearPart = '', monthPart = '', dayPart = ''] = dateKey.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	const date = new Date(year, month - 1, day);

	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
		return null;
	}

	return date;
}

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}
