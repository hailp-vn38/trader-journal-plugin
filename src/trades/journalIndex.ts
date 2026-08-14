import { normalizePath, TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import {
	formatResult,
	formatRr,
	formatSide,
	stringifyValue,
} from './format';
import { extractTrades, hasTradeBlocks, parseFrontmatter, splitFrontmatter } from './parser';
import { isPotentialJournalFile } from './storage';
import type { TradeEntry, TradeJournalType } from './types';
import type { LiveTradeStatus, TradeResult, TradeSide } from './types';
import type { TraderJournalLanguage } from '../settings';
import { isPathInFolder } from '../journal/pathScope';
import { INDEX_READ_CONCURRENCY, mapWithConcurrency } from '../utils/async';
import { getTraderJournalNoteType } from '../utils/noteType';
import { isTradeReviewed } from './review';

const BACKTEST_NOTE_TYPE = 'trader-journal-symbol-day';
const LIVE_NOTE_TYPE = 'trader-journal-live-symbol-day';

export interface JournalCalendarTrade {
	id: string;
	file: TFile;
	filePath: string;
	journalDate: string;
	journalType: TradeJournalType;
	symbol: string;
	side: string;
	sideKey: TradeSide | null;
	setup: string;
	timeframe: string;
	result: string;
	resultKey: TradeResult | null;
	rr: string;
	notes: string;
	createdAt: string;
	sortTime: number;
	status: LiveTradeStatus | null;
	reviewed: boolean;
	headingLine: number | null;
	trade: TradeEntry;
}

export interface JournalCalendarDay {
	date: string;
	backtestCount: number;
	liveCount: number;
	trades: JournalCalendarTrade[];
}

export interface JournalCalendarSnapshot {
	daysByDate: Record<string, JournalCalendarDay>;
	dayDates: string[];
	tradeCount: number;
}

interface JournalCalendarFileEntry {
	path: string;
	trades: JournalCalendarTrade[];
	fingerprint: string;
}

const EMPTY_JOURNAL_CALENDAR_SNAPSHOT: JournalCalendarSnapshot = {
	daysByDate: {},
	dayDates: [],
	tradeCount: 0,
};

interface JournalIdentity {
	journalDate: string;
	journalType: TradeJournalType;
	symbol: string;
}

export class JournalCalendarIndex {
	private readonly plugin: TraderJournalPlugin;
	private readonly entriesByPath = new Map<string, JournalCalendarFileEntry>();
	private snapshot = EMPTY_JOURNAL_CALENDAR_SNAPSHOT;

	constructor(plugin: TraderJournalPlugin) {
		this.plugin = plugin;
	}

	async rebuild(): Promise<JournalCalendarSnapshot> {
		this.entriesByPath.clear();

		const files = getJournalFiles(this.plugin);
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
		if (!isPotentialJournalFile(this.plugin, file)) {
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

	getSnapshot(): JournalCalendarSnapshot {
		return this.snapshot;
	}

	private buildSnapshot(): JournalCalendarSnapshot {
		const daysByDate: Record<string, JournalCalendarDay> = {};

		for (const entry of this.entriesByPath.values()) {
			for (const trade of entry.trades) {
				const day =
					daysByDate[trade.journalDate] ??
					(daysByDate[trade.journalDate] = {
						date: trade.journalDate,
						backtestCount: 0,
						liveCount: 0,
						trades: [],
					});

				if (trade.journalType === 'live') {
					day.liveCount += 1;
				} else {
					day.backtestCount += 1;
				}

				day.trades.push(trade);
			}
		}

		for (const day of Object.values(daysByDate)) {
			day.trades.sort((firstTrade, secondTrade) => {
				if (firstTrade.sortTime !== secondTrade.sortTime) {
					return secondTrade.sortTime - firstTrade.sortTime;
				}

				return firstTrade.filePath.localeCompare(secondTrade.filePath);
			});
		}

		const dayDates = Object.keys(daysByDate).sort();
		const tradeCount = Object.values(daysByDate).reduce((total, day) => total + day.trades.length, 0);

		return {
			daysByDate,
			dayDates,
			tradeCount,
		};
	}

	private async readFileEntry(file: TFile): Promise<JournalCalendarFileEntry | null> {
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (!hasTradeBlocks(content)) {
				return null;
			}

			const { frontmatter, body } = splitFrontmatter(content);
			const parsedFrontmatter = parseFrontmatter(frontmatter);
			const extractedTrades = extractTrades(body);
			if (extractedTrades.trades.length === 0) {
				return null;
			}

			const identity = getJournalIdentity(this.plugin, file, parsedFrontmatter, extractedTrades.trades);
			const trades = extractedTrades.trades.map((trade, index) =>
				createCalendarTrade(file, content, identity, trade, index, this.plugin.settings.language),
			);

			return {
				path: file.path,
				trades,
				fingerprint: createTradeEntryFingerprint(trades),
			};
		} catch (error) {
			console.error(`Trader Journal failed to index ${file.path}`, error);
			return null;
		}
	}
}

function createTradeEntryFingerprint(trades: readonly JournalCalendarTrade[]): string {
	return JSON.stringify(
		trades.map(({ file: _file, ...trade }) => trade),
	);
}

function getJournalFiles(plugin: TraderJournalPlugin): TFile[] {
	const files: TFile[] = [];

	for (const folder of getJournalRootFolders(plugin)) {
		collectJournalFiles(plugin, folder, files);
	}

	return files;
}

function getJournalRootFolders(plugin: TraderJournalPlugin): TFolder[] {
	const folderPaths = [plugin.settings.journalFolder, plugin.settings.liveJournalFolder]
		.map(normalizeJournalRootPath)
		.filter(Boolean);
	const uniqueFolderPaths = [...new Set(folderPaths)];

	return uniqueFolderPaths
		.map((folderPath) => plugin.app.vault.getAbstractFileByPath(folderPath))
		.filter((file): file is TFolder => file instanceof TFolder);
}

function collectJournalFiles(plugin: TraderJournalPlugin, folder: TFolder, files: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectJournalFiles(plugin, child, files);
			continue;
		}

		if (child instanceof TFile && isPotentialJournalFile(plugin, child)) {
			files.push(child);
		}
	}
}

function normalizeJournalRootPath(folderPath: string): string {
	const normalizedPath = normalizePath(folderPath).replace(/\/$/, '');
	return isVaultRootPath(normalizedPath) ? '' : normalizedPath;
}

function isVaultRootPath(path: string): boolean {
	return path === '' || path === '/' || path === '.';
}

function createCalendarTrade(
	file: TFile,
	content: string,
	identity: JournalIdentity,
	trade: TradeEntry,
	index: number,
	language: TraderJournalLanguage,
): JournalCalendarTrade {
	const createdAt = getTradeCreatedAt(trade, file);
	const sideKey = normalizeTradeSide(trade.side);
	const resultKey = normalizeTradeResult(trade.result);
	const journalType = normalizeJournalType(trade.journal_type) ?? identity.journalType;

	return {
		id: stringifyValue(trade.id) || `${file.path}-${index}`,
		file,
		filePath: file.path,
		journalDate: identity.journalDate,
		journalType,
		symbol: stringifyValue(trade.symbol) || identity.symbol,
		side: formatSide(trade.side, language),
		sideKey,
		setup: stringifyValue(trade.setup),
		timeframe: stringifyValue(trade.timeframe),
		result: formatResult(trade.result, language),
		resultKey,
		rr: formatRr(trade.rr),
		notes: stringifyValue(trade.notes),
		createdAt,
		sortTime: parseDateMs(createdAt) ?? file.stat.ctime + index,
		status: journalType === 'live' ? getLiveTradeStatus(trade) : null,
		reviewed: isTradeReviewed(trade),
		headingLine: findTradeHeadingLine(content, trade),
		trade,
	};
}

function getJournalIdentity(
	plugin: TraderJournalPlugin,
	file: TFile,
	frontmatter: Record<string, unknown>,
	trades: TradeEntry[],
): JournalIdentity {
	const firstTrade = trades[0];
	const journalType = getJournalType(plugin, file, frontmatter, firstTrade);
	const symbol =
		stringifyValue(frontmatter.symbol) ||
		stringifyValue(firstTrade?.symbol) ||
		inferSymbolFromPath(file.path);
	const journalDate =
		stringifyValue(frontmatter.journalDate) ||
		stringifyValue(firstTrade?.journalDate) ||
		stringifyValue(firstTrade?.tradeDate) ||
		inferJournalDateFromFile(file) ||
		formatDateKey(new Date(file.stat.ctime));

	return {
		journalDate,
		journalType,
		symbol: symbol || 'UNKNOWN',
	};
}

function getJournalType(
	plugin: TraderJournalPlugin,
	file: TFile,
	frontmatter: Record<string, unknown>,
	firstTrade: TradeEntry | undefined,
): TradeJournalType {
	const noteType = getTraderJournalNoteType(frontmatter);
	if (noteType === LIVE_NOTE_TYPE) {
		return 'live';
	}

	if (noteType === BACKTEST_NOTE_TYPE) {
		return 'backtest';
	}

	return (
		normalizeJournalType(frontmatter.journalType) ??
		normalizeJournalType(firstTrade?.journal_type) ??
		inferJournalTypeFromPath(plugin, file.path)
	);
}

function normalizeJournalType(value: unknown): TradeJournalType | null {
	return value === 'live' || value === 'backtest' ? value : null;
}

function normalizeTradeSide(value: unknown): TradeSide | null {
	return value === 'long' || value === 'short' ? value : null;
}

function normalizeTradeResult(value: unknown): TradeResult | null {
	const result = stringifyValue(value).toLowerCase();
	if (result === 'win' || result === 'thắng') {
		return 'win';
	}

	if (result === 'loss' || result === 'thua') {
		return 'loss';
	}

	if (result === 'breakeven' || result === 'hoà vốn' || result === 'hòa vốn' || result === 'hoa von') {
		return 'breakeven';
	}

	return null;
}

function getLiveTradeStatus(trade: TradeEntry): LiveTradeStatus {
	if (trade.status === 'open' || trade.status === 'closed') {
		return trade.status;
	}

	return stringifyValue(trade.closed_at) ? 'closed' : 'open';
}

function findTradeHeadingLine(content: string, trade: TradeEntry): number | null {
	const id = stringifyValue(trade.id);
	if (!id) {
		return null;
	}

	const idIndex = content.indexOf(`"id": ${JSON.stringify(id)}`);
	if (idIndex === -1) {
		return null;
	}

	const beforeId = content.slice(0, idIndex);
	const headingMatches = [...beforeId.matchAll(/^###\s+.*$/gm)];
	const headingIndex = headingMatches[headingMatches.length - 1]?.index;
	if (headingIndex === undefined) {
		return beforeId.split(/\r?\n/).length - 1;
	}

	return content.slice(0, headingIndex).split(/\r?\n/).length - 1;
}

function inferJournalTypeFromPath(plugin: TraderJournalPlugin, path: string): TradeJournalType {
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	return liveJournalFolder && path.startsWith(`${liveJournalFolder}/`) ? 'live' : 'backtest';
}

function getTradeCreatedAt(trade: TradeEntry, file: TFile): string {
	const date =
		stringifyValue(trade.date) ||
		stringifyValue(trade.opened_at) ||
		stringifyValue(trade.closed_at);
	if (date) {
		return date;
	}

	return new Date(file.stat.ctime).toISOString();
}

function parseDateMs(value: string): number | null {
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? null : parsed;
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

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}
