import { normalizePath, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import {
	formatRr,
	formatSide,
	formatTags,
	parseTradeJson,
	stringifyValue,
} from './format';
import { TRADE_CODE_BLOCK_LANGUAGE } from './types';
import type { TradeEntry, TradeJournalType } from './types';

const BACKTEST_NOTE_TYPE = 'trader-journal-symbol-day';
const LIVE_NOTE_TYPE = 'trader-journal-live-symbol-day';
const DEFAULT_JOURNAL_TYPE: TradeJournalType = 'backtest';
const SCHEMA_VERSION = 1;
const SUMMARY_START = '<!-- trader-journal:summary:start -->';
const SUMMARY_END = '<!-- trader-journal:summary:end -->';
const TRADE_BLOCK_PATTERN = /```trader-journal-trade\s*\n([\s\S]*?)\n```/g;

interface MarkdownParts {
	frontmatter: string;
	body: string;
}

export interface DailyTradeStats {
	tradeCount: number;
	winCount: number;
	lossCount: number;
	breakevenCount: number;
	invalidTradeBlockCount: number;
	netRr: number;
	averageRr: number;
	bestRr: number | null;
	worstRr: number | null;
	winRate: number;
	tags: string[];
}

export interface RebuildDailyNoteStatsResult {
	stats: DailyTradeStats;
	updated: boolean;
	skipped: boolean;
}

interface JournalIdentity {
	symbol: string;
	journalDate: string;
	journalType: TradeJournalType;
}

interface RebuiltNote {
	content: string;
	metadata: Record<string, unknown>;
	stats: DailyTradeStats;
	skipped: boolean;
}

interface ExtractedTrades {
	trades: TradeEntry[];
	invalidTradeBlockCount: number;
}

export async function saveTradeToDailyNote(
	plugin: TraderJournalPlugin,
	journalDate: string,
	trade: TradeEntry,
): Promise<TFile> {
	const symbol = stringifyValue(trade.symbol);
	if (!symbol) {
		throw new Error('Symbol is required.');
	}

	const journalType = normalizeJournalType(trade.journal_type);
	const filePath = getJournalFilePath(getJournalRootFolder(plugin, journalType), symbol, journalDate);
	await ensureFolder(plugin, getParentPath(filePath));

	let file = getFile(plugin, filePath);
	if (!file) {
		file = await plugin.app.vault.create(filePath, renderInitialNote(symbol, journalDate, journalType));
	}

	await plugin.app.vault.process(file, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		const bodyWithTrade = appendTradeBlock(ensureTradesSection(body), trade);

		return `${frontmatter}${bodyWithTrade}`;
	});

	await rebuildDailyNoteStats(plugin, file, {
		symbol,
		journalDate,
		journalType,
	});

	return file;
}

export async function rebuildDailyNoteStats(
	plugin: TraderJournalPlugin,
	file: TFile,
	fallbackIdentity?: Partial<JournalIdentity>,
): Promise<RebuildDailyNoteStatsResult> {
	if (file.extension !== 'md') {
		return {
			stats: getEmptyStats(),
			updated: false,
			skipped: true,
		};
	}

	const initialContent = await plugin.app.vault.read(file);
	const initialRebuild = buildRebuiltNote(file, initialContent, fallbackIdentity);
	if (initialRebuild.skipped) {
		return {
			stats: initialRebuild.stats,
			updated: false,
			skipped: true,
		};
	}

	let stats = initialRebuild.stats;
	let metadata = initialRebuild.metadata;
	let updated = false;

	if (initialRebuild.content !== initialContent) {
		await plugin.app.vault.process(file, (latestContent) => {
			const latestRebuild = buildRebuiltNote(file, latestContent, fallbackIdentity);
			if (latestRebuild.skipped) {
				return latestContent;
			}

			stats = latestRebuild.stats;
			metadata = latestRebuild.metadata;

			if (latestRebuild.content === latestContent) {
				return latestContent;
			}

			updated = true;
			return latestRebuild.content;
		});
	}

	const latestContent = updated ? await plugin.app.vault.read(file) : initialContent;
	const currentFrontmatter = parseFrontmatter(splitFrontmatter(latestContent).frontmatter);

	if (hasMetadataChanges(currentFrontmatter, metadata)) {
		await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const targetMetadata = frontmatter as Record<string, unknown>;

			for (const [key, value] of Object.entries(metadata)) {
				targetMetadata[key] = value;
			}
		});
		updated = true;
	}

	return {
		stats,
		updated,
		skipped: false,
	};
}

export function isPotentialJournalFile(plugin: TraderJournalPlugin, file: TFile): boolean {
	if (file.extension !== 'md') {
		return false;
	}

	const journalFolder = normalizePath(plugin.settings.journalFolder).replace(/\/$/, '');
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	const journalFolders = [journalFolder, liveJournalFolder].filter(Boolean);

	return journalFolders.some((folder) => file.path.startsWith(`${folder}/`));
}

export function getJournalFilePath(rootFolder: string, symbol: string, journalDate: string): string {
	const dateParts = parseJournalDate(journalDate);
	const root = normalizePath(rootFolder || 'Trading/Backtests').replace(/\/$/, '');
	const symbolFolder = sanitizePathSegment(symbol);

	return normalizePath(`${root}/${symbolFolder}/${dateParts.year}/${dateParts.month}/${journalDate}.md`);
}

export function createTradeId(symbol: string, openedAt: string, journalDate: string): string {
	const baseDate = openedAt ? openedAt.replace(/\D/g, '').slice(0, 14) : journalDate.replace(/\D/g, '');
	const randomPart = Math.random().toString(36).slice(2, 8);

	return `${baseDate}-${sanitizePathSegment(symbol)}-${randomPart}`;
}

export function calculateHoldingTime(openedAt: string, closedAt: string): number | null {
	if (!openedAt || !closedAt) {
		return null;
	}

	const openedAtMs = new Date(openedAt).getTime();
	const closedAtMs = new Date(closedAt).getTime();

	if (Number.isNaN(openedAtMs) || Number.isNaN(closedAtMs) || closedAtMs < openedAtMs) {
		return null;
	}

	return Math.round((closedAtMs - openedAtMs) / 60000);
}

function renderInitialNote(symbol: string, journalDate: string, journalType: TradeJournalType): string {
	const stats = getEmptyStats();
	const frontmatter = stringifyYaml({
		type: getNoteType(journalType),
		schemaVersion: SCHEMA_VERSION,
		journalType,
		symbol,
		journalDate,
		tradeCount: 0,
		winCount: 0,
		lossCount: 0,
		breakevenCount: 0,
		invalidTradeBlockCount: 0,
		netRr: 0,
		averageRr: 0,
		bestRr: null,
		worstRr: null,
		winRate: 0,
		tradeTags: [],
	});

	return `---\n${frontmatter}---\n\n${renderDailySummary(symbol, journalDate, journalType, stats)}\n\n## Trades\n`;
}

function appendTradeBlock(body: string, trade: TradeEntry): string {
	const heading = renderTradeHeading(trade);
	const json = JSON.stringify(trade, null, '\t');

	return `${body.trimEnd()}\n\n${heading}\n\n\`\`\`${TRADE_CODE_BLOCK_LANGUAGE}\n${json}\n\`\`\`\n`;
}

function renderTradeHeading(trade: TradeEntry): string {
	const openedAtTime = formatHeadingTime(trade.opened_at);
	const side = formatSide(trade.side);
	const result = stringifyValue(trade.result).toUpperCase();
	const rr = formatRr(trade.rr);
	const titleParts = [openedAtTime, side, result, rr].filter(Boolean);

	return `### ${titleParts.length ? titleParts.join(' ') : 'Trade'}`;
}

function renderDailySummary(
	symbol: string,
	journalDate: string,
	journalType: TradeJournalType,
	stats: DailyTradeStats,
): string {
	const invalidBlockLabel = stats.invalidTradeBlockCount === 1 ? 'block was' : 'blocks were';
	const invalidBlockWarning =
		stats.invalidTradeBlockCount === 0
			? ''
			: `\n\n> ${stats.invalidTradeBlockCount} invalid trade ${invalidBlockLabel} skipped. Fix invalid JSON before relying on these stats.`;

	return `${SUMMARY_START}
## Summary

${getJournalTypeLabel(journalType)} / ${symbol} / ${journalDate}

| Trades | WIN | Thua | Hoà vốn | Win rate | Net RR | Avg RR | Best RR | Worst RR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${stats.tradeCount} | ${stats.winCount} | ${stats.lossCount} | ${stats.breakevenCount} | ${formatPercent(stats.winRate)} | ${formatRrValue(stats.netRr)} | ${formatRrValue(stats.averageRr)} | ${formatNullableRr(stats.bestRr)} | ${formatNullableRr(stats.worstRr)} |${invalidBlockWarning}
${SUMMARY_END}`;
}

function buildRebuiltNote(
	file: TFile,
	content: string,
	fallbackIdentity: Partial<JournalIdentity> | undefined,
): RebuiltNote {
	const { frontmatter, body } = splitFrontmatter(content);
	const parsedFrontmatter = parseFrontmatter(frontmatter);
	const extractedTrades = extractTrades(body);
	const { trades } = extractedTrades;
	const isJournalNote =
		isKnownNoteType(stringifyValue(parsedFrontmatter.type)) ||
		body.includes(`\`\`\`${TRADE_CODE_BLOCK_LANGUAGE}`) ||
		Boolean(fallbackIdentity?.symbol || fallbackIdentity?.journalDate || fallbackIdentity?.journalType);

	if (!isJournalNote) {
		return {
			content,
			metadata: {},
			stats: getEmptyStats(),
			skipped: true,
		};
	}

	const identity = getJournalIdentity(file, parsedFrontmatter, trades, fallbackIdentity);
	const stats = calculateDailyTradeStats(trades, extractedTrades.invalidTradeBlockCount);
	const metadata = createDailyMetadata(identity, stats);
	const summary = renderDailySummary(identity.symbol, identity.journalDate, identity.journalType, stats);
	const bodyWithSummary = upsertSummary(ensureTradesSection(body), summary);

	return {
		content: `${frontmatter}${bodyWithSummary}`,
		metadata,
		stats,
		skipped: false,
	};
}

function createDailyMetadata(identity: JournalIdentity, stats: DailyTradeStats): Record<string, unknown> {
	return {
		type: getNoteType(identity.journalType),
		schemaVersion: SCHEMA_VERSION,
		journalType: identity.journalType,
		symbol: identity.symbol,
		journalDate: identity.journalDate,
		tradeCount: stats.tradeCount,
		winCount: stats.winCount,
		lossCount: stats.lossCount,
		breakevenCount: stats.breakevenCount,
		invalidTradeBlockCount: stats.invalidTradeBlockCount,
		netRr: roundNumber(stats.netRr),
		averageRr: roundNumber(stats.averageRr),
		bestRr: stats.bestRr === null ? null : roundNumber(stats.bestRr),
		worstRr: stats.worstRr === null ? null : roundNumber(stats.worstRr),
		winRate: roundNumber(stats.winRate),
		tradeTags: stats.tags,
	};
}

function getJournalIdentity(
	file: TFile,
	frontmatter: Record<string, unknown>,
	trades: TradeEntry[],
	fallbackIdentity: Partial<JournalIdentity> | undefined,
): JournalIdentity {
	const firstTrade = trades[0];
	const journalType = getJournalType(frontmatter, firstTrade, fallbackIdentity);
	const symbol =
		fallbackIdentity?.symbol ||
		stringifyValue(frontmatter.symbol) ||
		stringifyValue(firstTrade?.symbol) ||
		inferSymbolFromPath(file.path);
	const journalDate =
		fallbackIdentity?.journalDate ||
		stringifyValue(frontmatter.journalDate) ||
		stringifyValue(firstTrade?.journalDate) ||
		stringifyValue(firstTrade?.tradeDate) ||
		inferJournalDateFromFile(file);

	if (!symbol || !journalDate) {
		throw new Error('Could not determine journal symbol or date.');
	}

	return {
		symbol,
		journalDate,
		journalType,
	};
}

function getJournalRootFolder(plugin: TraderJournalPlugin, journalType: TradeJournalType): string {
	return journalType === 'live' ? plugin.settings.liveJournalFolder : plugin.settings.journalFolder;
}

function getJournalType(
	frontmatter: Record<string, unknown>,
	firstTrade: TradeEntry | undefined,
	fallbackIdentity: Partial<JournalIdentity> | undefined,
): TradeJournalType {
	const noteType = stringifyValue(frontmatter.type);
	if (noteType === LIVE_NOTE_TYPE) {
		return 'live';
	}

	if (noteType === BACKTEST_NOTE_TYPE) {
		return 'backtest';
	}

	return normalizeJournalType(
		fallbackIdentity?.journalType ||
			stringifyValue(frontmatter.journalType) ||
			stringifyValue(firstTrade?.journal_type),
	);
}

function normalizeJournalType(value: unknown): TradeJournalType {
	return value === 'live' ? 'live' : DEFAULT_JOURNAL_TYPE;
}

function getNoteType(journalType: TradeJournalType): string {
	return journalType === 'live' ? LIVE_NOTE_TYPE : BACKTEST_NOTE_TYPE;
}

function isKnownNoteType(noteType: string): boolean {
	return noteType === BACKTEST_NOTE_TYPE || noteType === LIVE_NOTE_TYPE;
}

function getJournalTypeLabel(journalType: TradeJournalType): string {
	return journalType === 'live' ? 'Live' : 'Backtest';
}

function upsertSummary(body: string, summary: string): string {
	const summaryPattern = new RegExp(`${escapeRegExp(SUMMARY_START)}[\\s\\S]*?${escapeRegExp(SUMMARY_END)}`);

	if (summaryPattern.test(body)) {
		return body.replace(summaryPattern, summary);
	}

	const tradesHeadingMatch = /^## Trades\b/m.exec(body);
	if (tradesHeadingMatch?.index !== undefined) {
		const beforeTrades = body.slice(0, tradesHeadingMatch.index).trimEnd();
		const fromTrades = body.slice(tradesHeadingMatch.index).trimStart();
		return `${beforeTrades ? `${beforeTrades}\n\n` : ''}${summary}\n\n${fromTrades}`;
	}

	return `${summary}\n\n${body.trimStart()}`;
}

function ensureTradesSection(body: string): string {
	if (/^## Trades\b/m.test(body)) {
		return body;
	}

	return `${body.trimEnd()}\n\n## Trades\n`;
}

function splitFrontmatter(content: string): MarkdownParts {
	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);

	if (!match?.[0]) {
		return {
			frontmatter: '',
			body: content,
		};
	}

	return {
		frontmatter: match[0],
		body: content.slice(match[0].length),
	};
}

function parseFrontmatter(frontmatter: string): Record<string, unknown> {
	const match = frontmatter.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const yaml = match?.[1];
	if (!yaml) {
		return {};
	}

	const parsed: unknown = parseYaml(yaml);
	return isRecord(parsed) ? parsed : {};
}

function extractTrades(body: string): ExtractedTrades {
	const trades: TradeEntry[] = [];
	let invalidTradeBlockCount = 0;

	for (const match of body.matchAll(TRADE_BLOCK_PATTERN)) {
		const source = match[1];
		if (!source?.trim()) {
			invalidTradeBlockCount += 1;
			continue;
		}

		const { trade } = parseTradeJson(source);
		if (trade) {
			trades.push(trade);
		} else {
			invalidTradeBlockCount += 1;
		}
	}

	return {
		trades,
		invalidTradeBlockCount,
	};
}

function calculateDailyTradeStats(trades: TradeEntry[], invalidTradeBlockCount: number): DailyTradeStats {
	const rrValues = trades.map((trade) => getSignedRr(trade));
	const netRr = rrValues.reduce((total, rr) => total + rr, 0);
	const winCount = trades.filter((trade) => getResultKey(trade) === 'win').length;
	const lossCount = trades.filter((trade) => getResultKey(trade) === 'loss').length;
	const breakevenCount = trades.filter((trade) => getResultKey(trade) === 'breakeven').length;
	const tags = [...new Set(trades.flatMap((trade) => formatTags(trade.tags)))].sort();

	return {
		tradeCount: trades.length,
		winCount,
		lossCount,
		breakevenCount,
		invalidTradeBlockCount,
		netRr,
		averageRr: trades.length ? netRr / trades.length : 0,
		bestRr: rrValues.length ? Math.max(...rrValues) : null,
		worstRr: rrValues.length ? Math.min(...rrValues) : null,
		winRate: trades.length ? (winCount / trades.length) * 100 : 0,
		tags,
	};
}

function getSignedRr(trade: TradeEntry): number {
	const rr = parseRr(trade.rr);
	const result = getResultKey(trade);

	if (result === 'loss') {
		return -Math.abs(rr);
	}

	if (result === 'win') {
		return Math.abs(rr);
	}

	if (result === 'breakeven') {
		return 0;
	}

	return rr;
}

function getResultKey(trade: TradeEntry): string {
	const result = stringifyValue(trade.result).toLowerCase();

	if (result === 'win') {
		return 'win';
	}

	if (result === 'loss' || result === 'thua') {
		return 'loss';
	}

	if (result === 'breakeven' || result === 'hoà vốn' || result === 'hoa von') {
		return 'breakeven';
	}

	return result;
}

function parseRr(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	const parsed = Number(stringifyValue(value).replace(/r$/i, ''));
	return Number.isFinite(parsed) ? parsed : 0;
}

function getEmptyStats(): DailyTradeStats {
	return {
		tradeCount: 0,
		winCount: 0,
		lossCount: 0,
		breakevenCount: 0,
		invalidTradeBlockCount: 0,
		netRr: 0,
		averageRr: 0,
		bestRr: null,
		worstRr: null,
		winRate: 0,
		tags: [],
	};
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

function parseJournalDate(journalDate: string): { year: string; month: string } {
	const match = journalDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
	const year = match?.[1];
	const month = match?.[2];

	if (!year || !month) {
		throw new Error('Journal date must use YYYY-MM-DD.');
	}

	return { year, month };
}

function inferSymbolFromPath(path: string): string {
	const parts = path.split('/');
	const fileNameIndex = parts.length - 1;
	const monthIndex = fileNameIndex - 1;
	const yearIndex = monthIndex - 1;
	const symbolIndex = yearIndex - 1;

	return parts[symbolIndex] ?? '';
}

function inferJournalDateFromFile(file: TFile): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(file.basename) ? file.basename : '';
}

function sanitizePathSegment(value: string): string {
	const sanitized = value.trim().replace(/[\\/#^[\]|?*:]/g, '-').replace(/\s+/g, '-');
	return sanitized || 'UNKNOWN';
}

function formatHeadingTime(value: unknown): string {
	const raw = stringifyValue(value);
	if (!raw) {
		return '';
	}

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		return '';
	}

	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
}

function formatNullableRr(value: number | null): string {
	return value === null ? '-' : formatRrValue(value);
}

function formatRrValue(value: number): string {
	return `${roundNumber(value)}R`;
}

function formatPercent(value: number): string {
	return `${roundNumber(value)}%`;
}

function roundNumber(value: number): number {
	return Number(value.toFixed(2));
}

function hasMetadataChanges(
	currentMetadata: Record<string, unknown>,
	nextMetadata: Record<string, unknown>,
): boolean {
	return Object.entries(nextMetadata).some(([key, value]) => !areMetadataValuesEqual(currentMetadata[key], value));
}

function areMetadataValuesEqual(currentValue: unknown, nextValue: unknown): boolean {
	return JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
