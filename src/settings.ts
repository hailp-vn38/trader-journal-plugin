export type CalendarDisplayMode = 'month' | 'horizontal_calendar';
export type TraderJournalLanguage = 'en' | 'vi';
export const CALENDAR_DISPLAY_MODE_CHANGE_EVENT = 'trader-journal-calendar-display-mode-change';
export const LANGUAGE_CHANGE_EVENT = 'trader-journal-language-change';

export interface TraderJournalSettings {
	journalFolder: string;
	liveJournalFolder: string;
	planFolder: string;
	symbols: string[];
	timeframes: string[];
	allowRemoteImages: boolean;
	calendarDisplayMode: CalendarDisplayMode;
	language: TraderJournalLanguage;
}

export const DEFAULT_SETTINGS: TraderJournalSettings = {
	journalFolder: 'Trading/Backtests',
	liveJournalFolder: 'Trading/Live',
	planFolder: 'Trading/Live/_plans',
	symbols: ['NQ', 'ES'],
	timeframes: ['1m', '3m', '5m', '15m', '1h'],
	allowRemoteImages: false,
	calendarDisplayMode: 'month',
	language: 'en',
};

export function normalizeSettings(settings: Partial<TraderJournalSettings> | null | undefined): TraderJournalSettings {
	return {
		journalFolder: settings?.journalFolder?.trim() || DEFAULT_SETTINGS.journalFolder,
		liveJournalFolder: settings?.liveJournalFolder?.trim() || DEFAULT_SETTINGS.liveJournalFolder,
		planFolder: settings?.planFolder?.trim() || DEFAULT_SETTINGS.planFolder,
		symbols: normalizeStringList(settings?.symbols, DEFAULT_SETTINGS.symbols, normalizeSymbol),
		timeframes: normalizeStringList(settings?.timeframes, DEFAULT_SETTINGS.timeframes, normalizeTimeframe),
		allowRemoteImages: settings?.allowRemoteImages === true,
		calendarDisplayMode: normalizeCalendarDisplayMode(settings?.calendarDisplayMode),
		language: normalizeLanguage(settings?.language),
	};
}

export function normalizeSymbol(value: string): string {
	return value.trim().toUpperCase();
}

export function normalizeTimeframe(value: string): string {
	return value.trim();
}

function normalizeCalendarDisplayMode(value: unknown): CalendarDisplayMode {
	return value === 'horizontal_calendar' ? 'horizontal_calendar' : DEFAULT_SETTINGS.calendarDisplayMode;
}

function normalizeLanguage(value: unknown): TraderJournalLanguage {
	return value === 'vi' ? 'vi' : DEFAULT_SETTINGS.language;
}

function normalizeStringList(
	values: unknown,
	fallback: string[],
	normalize: (value: string) => string,
): string[] {
	const sourceValues = Array.isArray(values) && values.length ? values : fallback;
	const normalizedValues = sourceValues
		.map((value) => (typeof value === 'string' ? normalize(value) : ''))
		.filter(Boolean);

	const uniqueValues = [...new Set(normalizedValues)];
	return uniqueValues.length ? uniqueValues : [...new Set(fallback.map((value) => normalize(value)).filter(Boolean))];
}
