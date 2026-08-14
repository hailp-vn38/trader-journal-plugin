import { normalizePath, stringifyYaml, TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { splitFrontmatter } from '../trades/parser';
import { stringifyValue } from '../trades/format';
import { PLAN_CODE_BLOCK_LANGUAGE } from './types';
import type { LinkedTradeRef, TradePlanEntry, TradePlanOption, TradePlanStatus } from './types';
import { createWikiLink } from '../utils/wikiLinks';
import { mergeFrontmatterTags } from '../utils/frontmatterTags';
import { classifyTraderJournalPath } from '../journal/pathScope';
import { INDEX_READ_CONCURRENCY, mapWithConcurrency } from '../utils/async';
import { setTraderJournalNoteType, TRADER_JOURNAL_NOTE_TYPE_KEY } from '../utils/noteType';

const PLAN_NOTE_TYPE = 'trader-journal-live-plan';
const SCHEMA_VERSION = 1;
const DEFAULT_PLAN_FOLDER = 'Trading/Live/_plans';
const PLAN_BLOCK_PATTERN = /```trader-journal-plan\s*\n([\s\S]*?)\n```/g;

export interface TradePlanFileEntry {
	file: TFile;
	filePath: string;
	plan: TradePlanEntry;
}

interface ListTradePlanOptionsArgs {
	symbol?: string;
	date?: string;
	includePlanId?: string;
}

export function parsePlanJson(source: string): { plan: TradePlanEntry | null; error: string | null } {
	try {
		const parsed: unknown = JSON.parse(source);
		if (!isRecord(parsed)) {
			return {
				plan: null,
				error: 'Plan block must be a JSON object.',
			};
		}

		return {
			plan: parsed,
			error: null,
		};
	} catch (error) {
		return {
			plan: null,
			error: error instanceof Error ? error.message : 'Invalid JSON.',
		};
	}
}

export function extractPlans(body: string): TradePlanEntry[] {
	const plans: TradePlanEntry[] = [];

	for (const match of body.matchAll(PLAN_BLOCK_PATTERN)) {
		const source = match[1];
		if (!source?.trim()) {
			continue;
		}

		const { plan } = parsePlanJson(source);
		if (plan) {
			plans.push(plan);
		}
	}

	return plans;
}

export function hasPlanBlocks(content: string): boolean {
	return content.includes(`\`\`\`${PLAN_CODE_BLOCK_LANGUAGE}`);
}

export async function saveTradePlan(
	plugin: TraderJournalPlugin,
	plan: TradePlanEntry,
	targetFilePath?: string,
): Promise<TFile> {
	const symbol = normalizeSymbol(stringifyValue(plan.symbol));
	if (!symbol) {
		throw new Error('Symbol is required.');
	}

	const title = stringifyValue(plan.title);
	if (!title) {
		throw new Error('Plan title is required.');
	}

	const startDate = stringifyValue(plan.start_date);
	if (!isDateKey(startDate)) {
		throw new Error('Plan start date must use YYYY-MM-DD.');
	}

	const normalizedPlan: TradePlanEntry = {
		...plan,
		schemaVersion: SCHEMA_VERSION,
		id: stringifyValue(plan.id) || createPlanId(symbol, startDate),
		journal_type: 'live',
		symbol,
		title,
		status: normalizePlanStatus(plan.status),
		start_date: startDate,
		end_date: normalizePlanEndDate(plan.end_date),
		updated_at: getCurrentLocalIsoString(),
	};

	if (targetFilePath) {
		return updateTradePlanInFile(plugin, targetFilePath, normalizedPlan);
	}

	const filePath = getUniquePlanFilePath(plugin, normalizedPlan);
	await ensureFolder(plugin, getParentPath(filePath));
	const setupLink = await resolveSetupLink(plugin, normalizedPlan);
	const file = await plugin.app.vault.create(filePath, renderPlanNote(normalizedPlan, setupLink));
	await updatePlanFrontmatter(plugin, file, normalizedPlan);
	await plugin.referenceDataService.refreshFile(file);
	return file;
}

export async function updateTradePlanInFile(
	plugin: TraderJournalPlugin,
	filePath: string,
	plan: TradePlanEntry,
): Promise<TFile> {
	const planId = stringifyValue(plan.id);
	if (!planId) {
		throw new Error('Plan id is required.');
	}

	const file = getFile(plugin, filePath);
	if (!file) {
		throw new Error(`Could not find ${filePath}.`);
	}

	let updated = false;
	await plugin.app.vault.process(file, (content) =>
		content.replace(PLAN_BLOCK_PATTERN, (block, source: string) => {
			if (updated) {
				return block;
			}

			const { plan: existingPlan } = parsePlanJson(source);
			const existingPlanId = stringifyValue(existingPlan?.id);
			if (existingPlanId && existingPlanId !== planId) {
				return block;
			}

			updated = true;
			return renderPlanBlock(plan);
		}),
	);

	if (!updated) {
		throw new Error('Could not find plan block to update.');
	}

	await updatePlanFrontmatter(plugin, file, plan);
	await plugin.referenceDataService.refreshFile(file);
	return file;
}

export async function listTradePlanOptions(
	plugin: TraderJournalPlugin,
	args: ListTradePlanOptionsArgs = {},
): Promise<TradePlanOption[]> {
	const normalizedSymbol = args.symbol ? normalizeSymbol(args.symbol) : '';
	const includePlanId = stringifyValue(args.includePlanId);
	const entries = await plugin.referenceDataService.listPlans();

	return entries
		.filter(({ plan }) => {
			const planId = stringifyValue(plan.id);
			const isIncludedPlan = Boolean(includePlanId && planId === includePlanId);
			if (isIncludedPlan) {
				return true;
			}

			if (normalizePlanStatus(plan.status) !== 'open') {
				return false;
			}

			if (normalizedSymbol && normalizeSymbol(stringifyValue(plan.symbol)) !== normalizedSymbol) {
				return false;
			}

			return args.date ? isPlanActiveOnDate(plan, args.date) : true;
		})
		.map(({ filePath, plan }) => ({
			id: stringifyValue(plan.id),
			title: stringifyValue(plan.title) || stringifyValue(plan.id),
			symbol: normalizeSymbol(stringifyValue(plan.symbol)),
			status: normalizePlanStatus(plan.status),
			startDate: stringifyValue(plan.start_date),
			endDate: normalizePlanEndDate(plan.end_date),
			filePath,
			setupId: stringifyValue(plan.setup_id),
			setup: stringifyValue(plan.setup),
		}))
		.filter((option) => option.id && option.title && option.symbol && isDateKey(option.startDate))
		.sort((firstPlan, secondPlan) => {
			if (firstPlan.startDate !== secondPlan.startDate) {
				return secondPlan.startDate.localeCompare(firstPlan.startDate);
			}

			return firstPlan.title.localeCompare(secondPlan.title);
		});
}

export async function getTradePlanById(
	plugin: TraderJournalPlugin,
	planId: string,
): Promise<TradePlanFileEntry | null> {
	const normalizedPlanId = stringifyValue(planId);
	if (!normalizedPlanId) {
		return null;
	}

	return plugin.referenceDataService.getPlanById(normalizedPlanId);
}

export async function linkTradeToPlan(
	plugin: TraderJournalPlugin,
	planId: string,
	tradeRef: LinkedTradeRef,
): Promise<void> {
	const entry = await getTradePlanById(plugin, planId);
	if (!entry) {
		return;
	}

	const tradeId = stringifyValue(tradeRef.trade_id);
	const filePath = stringifyValue(tradeRef.file_path);
	if (!tradeId && !filePath) {
		return;
	}

	const existingRefs = normalizeLinkedTrades(entry.plan.linked_trades);
	const alreadyLinked = existingRefs.some((existingRef) =>
		tradeId
			? stringifyValue(existingRef.trade_id) === tradeId
			: stringifyValue(existingRef.file_path) === filePath,
	);

	if (alreadyLinked) {
		return;
	}

	await saveTradePlan(plugin, {
		...entry.plan,
		linked_trades: [...existingRefs, tradeRef],
	}, entry.filePath);
}

export async function unlinkTradeFromPlan(
	plugin: TraderJournalPlugin,
	planId: string,
	tradeId: string,
): Promise<void> {
	const entry = await getTradePlanById(plugin, planId);
	if (!entry) {
		return;
	}

	const normalizedTradeId = stringifyValue(tradeId);
	if (!normalizedTradeId) {
		return;
	}

	const existingRefs = normalizeLinkedTrades(entry.plan.linked_trades);
	const nextRefs = existingRefs.filter((tradeRef) => stringifyValue(tradeRef.trade_id) !== normalizedTradeId);
	if (nextRefs.length === existingRefs.length) {
		return;
	}

	await saveTradePlan(plugin, {
		...entry.plan,
		linked_trades: nextRefs,
	}, entry.filePath);
}

export function isPotentialPlanFile(plugin: TraderJournalPlugin, file: TFile): boolean {
	return file.extension === 'md' && classifyTraderJournalPath(plugin, file.path) === 'plan';
}

export function getPlanRootFolder(plugin: TraderJournalPlugin): string {
	return normalizePath(plugin.settings.planFolder || DEFAULT_PLAN_FOLDER).replace(/\/$/, '');
}

export function normalizePlanStatus(value: unknown): TradePlanStatus {
	return value === 'closed' || value === 'cancelled' ? value : 'open';
}

export function normalizeLinkedTrades(value: unknown): LinkedTradeRef[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter(isRecord)
		.map((tradeRef) => ({
			trade_id: stringifyValue(tradeRef.trade_id),
			file_path: stringifyValue(tradeRef.file_path),
			label: stringifyValue(tradeRef.label),
		}))
		.filter((tradeRef) => tradeRef.trade_id || tradeRef.file_path);
}

export function isPlanActiveOnDate(plan: TradePlanEntry, date: string): boolean {
	const startDate = stringifyValue(plan.start_date);
	if (!isDateKey(startDate) || !isDateKey(date) || date < startDate) {
		return false;
	}

	const endDate = normalizePlanEndDate(plan.end_date);
	return !endDate || date <= endDate;
}

export function normalizePlanEndDate(value: unknown): string | null {
	const raw = stringifyValue(value);
	return isDateKey(raw) ? raw : null;
}

export async function scanTradePlanEntries(plugin: TraderJournalPlugin): Promise<TradePlanFileEntry[]> {
	const files = getPlanFiles(plugin);
	const entries = await mapWithConcurrency(files, INDEX_READ_CONCURRENCY, async (file) =>
		readTradePlanFile(plugin, file),
	);
	return entries.filter((entry): entry is TradePlanFileEntry => entry !== null);
}

export async function readTradePlanFile(
	plugin: TraderJournalPlugin,
	file: TFile,
): Promise<TradePlanFileEntry | null> {
	try {
		const content = await plugin.app.vault.cachedRead(file);
		if (!hasPlanBlocks(content)) {
			return null;
		}

		const { body } = splitFrontmatter(content);
		const plan = extractPlans(body)[0];
		if (!plan) {
			return null;
		}

		return {
			file,
			filePath: file.path,
			plan,
		};
	} catch (error) {
		console.error(`Trader Journal failed to read plan ${file.path}`, error);
		return null;
	}
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

function renderPlanNote(plan: TradePlanEntry, setupLink: string): string {
	const title = stringifyValue(plan.title) || 'Trade plan';
	const frontmatter = stringifyYaml(createPlanMetadata(plan, setupLink));

	return `---\n${frontmatter}---\n\n# ${title}\n\n${renderPlanBlock(plan)}\n`;
}

function renderPlanBlock(plan: TradePlanEntry): string {
	return `\`\`\`${PLAN_CODE_BLOCK_LANGUAGE}\n${JSON.stringify(plan, null, '\t')}\n\`\`\``;
}

async function updatePlanFrontmatter(
	plugin: TraderJournalPlugin,
	file: TFile,
	plan: TradePlanEntry,
): Promise<void> {
	const metadata = createPlanMetadata(plan, await resolveSetupLink(plugin, plan));
	await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
		const targetMetadata = frontmatter as Record<string, unknown>;
		const tags = mergeFrontmatterTags(targetMetadata.tags, [PLAN_NOTE_TYPE]);
		for (const [key, value] of Object.entries(metadata)) {
			targetMetadata[key] = value;
		}
		setTraderJournalNoteType(targetMetadata, PLAN_NOTE_TYPE);
		targetMetadata.tags = tags;
	});
}

function createPlanMetadata(plan: TradePlanEntry, setupLink: string): Record<string, unknown> {
	return {
		[TRADER_JOURNAL_NOTE_TYPE_KEY]: PLAN_NOTE_TYPE,
		tags: [PLAN_NOTE_TYPE],
		schemaVersion: SCHEMA_VERSION,
		journalType: 'live',
		planId: stringifyValue(plan.id),
		symbol: normalizeSymbol(stringifyValue(plan.symbol)),
		title: stringifyValue(plan.title),
		setupId: stringifyValue(plan.setup_id),
		setup: stringifyValue(plan.setup),
		setupLink,
		status: normalizePlanStatus(plan.status),
		startDate: stringifyValue(plan.start_date),
		endDate: normalizePlanEndDate(plan.end_date),
		linkedTradeCount: normalizeLinkedTrades(plan.linked_trades).length,
	};
}

async function resolveSetupLink(plugin: TraderJournalPlugin, plan: TradePlanEntry): Promise<string> {
	const setupId = stringifyValue(plan.setup_id);
	if (!setupId) {
		return '';
	}

	const setup = await plugin.referenceDataService.getSetupById(setupId);
	return setup ? createWikiLink(setup.filePath) : '';
}

function getUniquePlanFilePath(plugin: TraderJournalPlugin, plan: TradePlanEntry): string {
	const root = getPlanRootFolder(plugin);
	const symbol = normalizeSymbol(stringifyValue(plan.symbol)) || 'UNKNOWN';
	const startDate = stringifyValue(plan.start_date);
	const dateParts = parseDateParts(startDate);
	const baseName = `${startDate}-${sanitizePathSegment(symbol)}`;
	let candidatePath = normalizePath(
		`${root}/${sanitizePathSegment(symbol)}/${dateParts.year}/${dateParts.month}/${baseName}.md`,
	);
	let suffix = 2;

	while (plugin.app.vault.getAbstractFileByPath(candidatePath)) {
		candidatePath = normalizePath(
			`${root}/${sanitizePathSegment(symbol)}/${dateParts.year}/${dateParts.month}/${baseName}-${suffix}.md`,
		);
		suffix += 1;
	}

	return candidatePath;
}

function createPlanId(symbol: string, startDate: string): string {
	const datePart = startDate.replace(/\D/g, '');
	const randomPart = Math.random().toString(36).slice(2, 8);
	return `plan-${datePart}-${sanitizePathSegment(symbol)}-${randomPart}`;
}

async function ensureFolder(plugin: TraderJournalPlugin, folderPath: string): Promise<void> {
	const normalizedFolderPath = normalizePath(folderPath);
	if (!normalizedFolderPath) {
		return;
	}

	let currentPath = '';
	for (const segment of normalizedFolderPath.split('/')) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		const abstractFile = plugin.app.vault.getAbstractFileByPath(currentPath);

		if (abstractFile instanceof TFolder) {
			continue;
		}

		if (abstractFile instanceof TFile) {
			throw new Error(`${currentPath} is a file, not a folder.`);
		}

		await plugin.app.vault.createFolder(currentPath);
	}
}

function getFile(plugin: TraderJournalPlugin, path: string): TFile | null {
	const abstractFile = plugin.app.vault.getAbstractFileByPath(path);

	if (abstractFile instanceof TFile) {
		return abstractFile;
	}

	if (abstractFile) {
		throw new Error(`${path} exists but is not a file.`);
	}

	return null;
}

function getParentPath(path: string): string {
	const parts = path.split('/');
	parts.pop();
	return parts.join('/');
}

function parseDateParts(date: string): { year: string; month: string } {
	const [year = '', month = ''] = date.split('-');
	if (!isDateKey(date)) {
		throw new Error('Plan start date must use YYYY-MM-DD.');
	}

	return { year, month };
}

function isDateKey(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}

	const [yearPart = '', monthPart = '', dayPart = ''] = value.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function sanitizePathSegment(value: string): string {
	const sanitized = value.trim().replace(/[\\/#^[\]|?*:]/g, '-').replace(/\s+/g, '-');
	return sanitized || 'UNKNOWN';
}

function getCurrentLocalIsoString(): string {
	const date = new Date();
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const absoluteOffsetMinutes = Math.abs(offsetMinutes);
	const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
	const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

	return [
		`${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
		`T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`,
		`${sign}${padDatePart(offsetHours)}:${padDatePart(offsetRemainderMinutes)}`,
	].join('');
}

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
