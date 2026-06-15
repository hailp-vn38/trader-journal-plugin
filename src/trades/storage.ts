import { normalizePath, stringifyYaml, TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import {
	formatRr,
	formatSide,
	formatTags,
	parseTradeJson,
	stringifyValue,
} from './format';
import { TRADE_CODE_BLOCK_LANGUAGE } from './types';
import type { TradeEntry } from './types';

const NOTE_TYPE = 'trader-journal-symbol-day';
const SCHEMA_VERSION = 1;
const SUMMARY_START = '<!-- trader-journal:summary:start -->';
const SUMMARY_END = '<!-- trader-journal:summary:end -->';
const TRADE_BLOCK_PATTERN = /```trader-journal-trade\s*\n([\s\S]*?)\n```/g;

interface MarkdownParts {
	frontmatter: string;
	body: string;
}

interface DailyTradeStats {
	tradeCount: number;
	winCount: number;
	lossCount: number;
	breakevenCount: number;
	netRr: number;
	averageRr: number;
	bestRr: number | null;
	worstRr: number | null;
	winRate: number;
	tags: string[];
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

	const filePath = getJournalFilePath(plugin.settings.journalFolder, symbol, journalDate);
	await ensureFolder(plugin, getParentPath(filePath));

	let file = getFile(plugin, filePath);
	if (!file) {
		file = await plugin.app.vault.create(filePath, renderInitialNote(symbol, journalDate));
	}

	let stats = getEmptyStats();
	await plugin.app.vault.process(file, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		const bodyWithTrade = appendTradeBlock(ensureTradesSection(body), trade);
		const trades = extractTrades(bodyWithTrade);
		stats = calculateDailyTradeStats(trades);
		const summary = renderDailySummary(symbol, journalDate, stats);

		return `${frontmatter}${upsertSummary(bodyWithTrade, summary)}`;
	});

	await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
		const metadata = frontmatter as Record<string, unknown>;

		metadata.type = NOTE_TYPE;
		metadata.schemaVersion = SCHEMA_VERSION;
		metadata.symbol = symbol;
		metadata.journalDate = journalDate;
		metadata.tradeCount = stats.tradeCount;
		metadata.winCount = stats.winCount;
		metadata.lossCount = stats.lossCount;
		metadata.breakevenCount = stats.breakevenCount;
		metadata.netRr = roundNumber(stats.netRr);
		metadata.averageRr = roundNumber(stats.averageRr);
		metadata.bestRr = stats.bestRr === null ? null : roundNumber(stats.bestRr);
		metadata.worstRr = stats.worstRr === null ? null : roundNumber(stats.worstRr);
		metadata.winRate = roundNumber(stats.winRate);
		metadata.tradeTags = stats.tags;
	});

	return file;
}

export function getJournalFilePath(rootFolder: string, symbol: string, journalDate: string): string {
	const dateParts = parseJournalDate(journalDate);
	const root = normalizePath(rootFolder || 'Trading/Backtests').replace(/\/$/, '');
	const symbolFolder = sanitizePathSegment(symbol);

	return normalizePath(`${root}/${symbolFolder}/${dateParts.year}/${dateParts.year}-${dateParts.month}/${journalDate}.md`);
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

function renderInitialNote(symbol: string, journalDate: string): string {
	const stats = getEmptyStats();
	const frontmatter = stringifyYaml({
		type: NOTE_TYPE,
		schemaVersion: SCHEMA_VERSION,
		symbol,
		journalDate,
		tradeCount: 0,
		winCount: 0,
		lossCount: 0,
		breakevenCount: 0,
		netRr: 0,
		averageRr: 0,
		bestRr: null,
		worstRr: null,
		winRate: 0,
		tradeTags: [],
	});

	return `---\n${frontmatter}---\n\n${renderDailySummary(symbol, journalDate, stats)}\n\n## Trades\n`;
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

function renderDailySummary(symbol: string, journalDate: string, stats: DailyTradeStats): string {
	return `${SUMMARY_START}
## Summary

${symbol} / ${journalDate}

| Trades | WIN | Thua | Hoà vốn | Win rate | Net RR | Avg RR | Best RR | Worst RR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${stats.tradeCount} | ${stats.winCount} | ${stats.lossCount} | ${stats.breakevenCount} | ${formatPercent(stats.winRate)} | ${formatRrValue(stats.netRr)} | ${formatRrValue(stats.averageRr)} | ${formatNullableRr(stats.bestRr)} | ${formatNullableRr(stats.worstRr)} |
${SUMMARY_END}`;
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

function extractTrades(body: string): TradeEntry[] {
	const trades: TradeEntry[] = [];

	for (const match of body.matchAll(TRADE_BLOCK_PATTERN)) {
		const source = match[1];
		if (!source) {
			continue;
		}

		const { trade } = parseTradeJson(source);
		if (trade) {
			trades.push(trade);
		}
	}

	return trades;
}

function calculateDailyTradeStats(trades: TradeEntry[]): DailyTradeStats {
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
