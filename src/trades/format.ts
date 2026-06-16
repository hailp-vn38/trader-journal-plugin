import type { NormalizedTradeImage, TradeEntry, TradeImage } from './types';

const RESULT_LABELS: Record<string, string> = {
	loss: 'Thua',
	win: 'WIN',
	breakeven: 'Hoà vốn',
};

const SIDE_LABELS: Record<string, string> = {
	long: 'Long',
	short: 'Short',
};

export const KNOWN_TRADE_FIELDS = new Set([
	'schemaVersion',
	'id',
	'journal_type',
	'symbol',
	'side',
	'setup',
	'timeframe',
	'result',
	'rr',
	'tags',
	'entry_price',
	'stop_loss',
	'exit_price',
	'take_profit',
	'images',
	'notes',
	'opened_at',
	'closed_at',
	'holding_time',
]);

export function parseTradeJson(source: string): { trade: TradeEntry | null; error: string | null } {
	try {
		const parsed: unknown = JSON.parse(source);

		if (!isRecord(parsed)) {
			return {
				trade: null,
				error: 'Trade block must be a JSON object.',
			};
		}

		return {
			trade: parsed,
			error: null,
		};
	} catch (error) {
		return {
			trade: null,
			error: error instanceof Error ? error.message : 'Invalid JSON.',
		};
	}
}

export function formatResult(value: unknown): string {
	const raw = stringifyValue(value);
	return RESULT_LABELS[raw.toLowerCase()] ?? raw;
}

export function formatSide(value: unknown): string {
	const raw = stringifyValue(value);
	return SIDE_LABELS[raw.toLowerCase()] ?? raw;
}

export function formatRr(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return `${formatNumber(value)}R`;
	}

	const raw = stringifyValue(value);
	if (!raw) {
		return '';
	}

	return raw.toLowerCase().endsWith('r') ? raw : `${raw}R`;
}

export function formatTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => stringifyValue(item)).filter(Boolean);
	}

	if (typeof value === 'string') {
		return value
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	return [];
}

export function getHoldingMinutes(trade: TradeEntry): number | null {
	const stored = parseNumber(trade.holding_time);
	if (stored !== null) {
		return stored;
	}

	const openedAt = parseDateMs(trade.opened_at);
	const closedAt = parseDateMs(trade.closed_at);

	if (openedAt === null || closedAt === null || closedAt < openedAt) {
		return null;
	}

	return Math.round((closedAt - openedAt) / 60000);
}

export function formatDuration(minutes: number | null): string {
	if (minutes === null) {
		return '';
	}

	if (minutes < 60) {
		return `${minutes}m`;
	}

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	if (remainingMinutes === 0) {
		return `${hours}h`;
	}

	return `${hours}h ${remainingMinutes}m`;
}

export function formatPrice(value: unknown): string {
	const parsed = parseNumber(value);
	if (parsed !== null) {
		return formatNumber(parsed);
	}

	return stringifyValue(value);
}

export function normalizeTradeImages(value: unknown): NormalizedTradeImage[] {
	const items = Array.isArray(value) ? value : value ? [value] : [];

	return items
		.map((item) => normalizeTradeImage(item))
		.filter((item): item is NormalizedTradeImage => item !== null);
}

export function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}

	if (typeof value === 'string') {
		return value.trim();
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

export function formatDateTime(value: unknown): string {
	const raw = stringifyValue(value);
	if (!raw) {
		return '';
	}

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		return raw;
	}

	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});
}

function normalizeTradeImage(value: unknown): NormalizedTradeImage | null {
	if (typeof value === 'string') {
		return normalizeImageValue(value);
	}

	if (!isRecord(value)) {
		return null;
	}

	const image = value as TradeImage;
	const rawValue = stringifyValue(image.value);
	if (!rawValue) {
		return null;
	}

	const type = image.type === 'url' || image.type === 'file' ? image.type : inferImageType(rawValue);
	const label = stringifyValue(image.label);

	return {
		type,
		value: cleanImageValue(rawValue),
		...(label ? { label } : {}),
	};
}

function normalizeImageValue(value: string): NormalizedTradeImage | null {
	const cleanedValue = cleanImageValue(value);
	if (!cleanedValue) {
		return null;
	}

	return {
		type: inferImageType(cleanedValue),
		value: cleanedValue,
	};
}

function cleanImageValue(value: string): string {
	const trimmed = value.trim();
	const wikiMatch = trimmed.match(/^!?\[\[([^\]]+)\]\]$/);

	if (wikiMatch?.[1]) {
		return wikiMatch[1].split('|')[0]?.trim() ?? '';
	}

	const markdownImageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
	if (markdownImageMatch?.[1]) {
		return markdownImageMatch[1].trim();
	}

	return trimmed;
}

function inferImageType(value: string): 'url' | 'file' {
	return /^https?:\/\//i.test(value) ? 'url' : 'file';
}

function parseNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : null;
}

function parseDateMs(value: unknown): number | null {
	const raw = stringifyValue(value);
	if (!raw) {
		return null;
	}

	const parsed = new Date(raw).getTime();
	return Number.isNaN(parsed) ? null : parsed;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
