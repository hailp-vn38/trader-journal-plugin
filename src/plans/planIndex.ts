import { TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { normalizeTradeImages, stringifyValue } from '../trades/format';
import { splitFrontmatter } from '../trades/parser';
import { extractPlans, getPlanRootFolder, isPotentialPlanFile, normalizeLinkedTrades, normalizePlanEndDate, normalizePlanStatus } from './storage';
import type { TradePlanBias, TradePlanEntry, TradePlanStatus } from './types';
import { isPathInFolder } from '../journal/pathScope';
import { INDEX_READ_CONCURRENCY, mapWithConcurrency } from '../utils/async';

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
	planCount: number;
	plans: JournalCalendarPlan[];
}

interface JournalPlanFileEntry {
	path: string;
	plans: JournalCalendarPlan[];
	fingerprint: string;
}

const EMPTY_JOURNAL_PLAN_SNAPSHOT: JournalPlanSnapshot = {
	planCount: 0,
	plans: [],
};

export class JournalPlanIndex {
	private readonly plugin: TraderJournalPlugin;
	private readonly entriesByPath = new Map<string, JournalPlanFileEntry>();
	private snapshot = EMPTY_JOURNAL_PLAN_SNAPSHOT;

	constructor(plugin: TraderJournalPlugin) {
		this.plugin = plugin;
	}

	async rebuild(): Promise<JournalPlanSnapshot> {
		this.entriesByPath.clear();

		const files = getPlanFiles(this.plugin);
		const entries = await mapWithConcurrency(files, INDEX_READ_CONCURRENCY, async (file) =>
			this.readFileEntry(file),
		);

		for (const entry of entries) {
			if (entry) {
				this.entriesByPath.set(entry.path, entry);
			}
		}

		this.snapshot = this.buildSnapshot();
		return this.snapshot;
	}

	async updateFile(file: TFile): Promise<boolean> {
		const previousEntry = this.entriesByPath.get(file.path) ?? null;
		if (!isPotentialPlanFile(this.plugin, file)) {
			return false;
		}

		const entry = await this.readFileEntry(file);
		if (previousEntry?.fingerprint === entry?.fingerprint) {
			return false;
		}

		if (entry) {
			this.entriesByPath.set(entry.path, entry);
		} else {
			this.entriesByPath.delete(file.path);
		}
		this.snapshot = this.buildSnapshot();
		return true;
	}

	removePath(path: string): boolean {
		if (!this.entriesByPath.delete(path)) {
			return false;
		}

		this.snapshot = this.buildSnapshot();
		return true;
	}

	removePathPrefix(pathPrefix: string): boolean {
		let changed = false;
		for (const path of this.entriesByPath.keys()) {
			if (isPathInFolder(path, pathPrefix)) {
				this.entriesByPath.delete(path);
				changed = true;
			}
		}

		if (!changed) {
			return false;
		}

		this.snapshot = this.buildSnapshot();
		return true;
	}

	getSnapshot(): JournalPlanSnapshot {
		return this.snapshot;
	}

	private buildSnapshot(): JournalPlanSnapshot {
		const plans: JournalCalendarPlan[] = [];

		for (const entry of this.entriesByPath.values()) {
			for (const plan of entry.plans) {
				plans.push(plan);
			}
		}

		return {
			planCount: plans.length,
			plans: plans.sort((first, second) => second.sortTime - first.sortTime),
		};
	}

	private async readFileEntry(file: TFile): Promise<JournalPlanFileEntry | null> {
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const { body } = splitFrontmatter(content);
			const extractedPlans = extractPlans(body);
			if (extractedPlans.length === 0) {
				return null;
			}
			const plans = extractedPlans
				.map((plan, index) => createCalendarPlan(file, plan, index))
				.filter((plan): plan is JournalCalendarPlan => plan !== null);

			return {
				path: file.path,
				plans,
				fingerprint: createPlanEntryFingerprint(plans),
			};
		} catch (error) {
			console.error(`Trader Journal failed to index plan ${file.path}`, error);
			return null;
		}
	}
}

function createPlanEntryFingerprint(plans: readonly JournalCalendarPlan[]): string {
	return JSON.stringify(
		plans.map(({ file: _file, ...plan }) => plan),
	);
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

export function createPlanDaysForRange(
	plans: readonly JournalCalendarPlan[],
	rangeStart: string,
	rangeEnd: string,
	today = formatDateKey(new Date()),
): Record<string, JournalCalendarPlanDay> {
	if (!isDateKey(rangeStart) || !isDateKey(rangeEnd) || rangeEnd < rangeStart) {
		return {};
	}

	const daysByDate: Record<string, JournalCalendarPlanDay> = {};
	for (const plan of plans) {
		const effectiveEnd = getPlanEffectiveEndDate(plan, today);
		const visibleStart = plan.startDate > rangeStart ? plan.startDate : rangeStart;
		const visibleEnd = effectiveEnd < rangeEnd ? effectiveEnd : rangeEnd;
		const startDate = parseDateKey(visibleStart);
		const endDate = parseDateKey(visibleEnd);
		if (!startDate || !endDate || startDate > endDate) {
			continue;
		}

		for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
			const dateKey = formatDateKey(date);
			const day =
				daysByDate[dateKey] ??
				(daysByDate[dateKey] = {
					date: dateKey,
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

	for (const day of Object.values(daysByDate)) {
		day.plans.sort(comparePlansForDay);
	}
	return daysByDate;
}

export function getPlanEffectiveEndDate(plan: JournalCalendarPlan, today: string): string {
	return plan.endDate ?? (plan.status === 'open' ? today : plan.startDate);
}

function addLocalDays(date: Date, days: number): Date {
	const nextDate = new Date(date);
	nextDate.setDate(nextDate.getDate() + days);
	return nextDate;
}

function comparePlansForDay(firstPlan: JournalCalendarPlan, secondPlan: JournalCalendarPlan): number {
	if (firstPlan.status !== secondPlan.status) {
		return getPlanStatusSortValue(firstPlan.status) - getPlanStatusSortValue(secondPlan.status);
	}
	if (firstPlan.sortTime !== secondPlan.sortTime) {
		return secondPlan.sortTime - firstPlan.sortTime;
	}
	return firstPlan.title.localeCompare(secondPlan.title);
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
