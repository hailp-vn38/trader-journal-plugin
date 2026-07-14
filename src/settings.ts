import { ECONOMIC_IMPACTS } from './economicCalendar/types';
import type { EconomicImpact } from './economicCalendar/types';

export type CalendarDisplayMode = 'month' | 'horizontal_calendar';
export type TraderJournalLanguage = 'en' | 'vi';
export const CALENDAR_DISPLAY_MODE_CHANGE_EVENT = 'trader-journal-calendar-display-mode-change';
export const LANGUAGE_CHANGE_EVENT = 'trader-journal-language-change';
export const ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT = 'trader-journal-economic-calendar-settings-change';
export const DEFAULT_ECONOMIC_CALENDAR_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export interface TraderJournalSettings {
	journalFolder: string;
	liveJournalFolder: string;
	planFolder: string;
	symbols: string[];
	timeframes: string[];
	allowRemoteImages: boolean;
	calendarDisplayMode: CalendarDisplayMode;
	language: TraderJournalLanguage;
	economicCalendarEnabled: boolean;
	economicCalendarTimeZone: string;
	economicCalendarCountries: string[];
	economicCalendarImpacts: EconomicImpact[];
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
	economicCalendarEnabled: false,
	economicCalendarTimeZone: DEFAULT_ECONOMIC_CALENDAR_TIME_ZONE,
	economicCalendarCountries: ['USD'],
	economicCalendarImpacts: ['High', 'Medium'],
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
		economicCalendarEnabled: settings?.economicCalendarEnabled === true,
		economicCalendarTimeZone: normalizeTimeZone(settings?.economicCalendarTimeZone),
		economicCalendarCountries: normalizeStringList(
			settings?.economicCalendarCountries,
			DEFAULT_SETTINGS.economicCalendarCountries,
			normalizeCountry,
		),
		economicCalendarImpacts: normalizeEconomicImpacts(settings?.economicCalendarImpacts),
	};
}

export function normalizeSymbol(value: string): string {
	return value.trim().toUpperCase();
}

export function normalizeTimeframe(value: string): string {
	return value.trim();
}

export function normalizeCountry(value: string): string {
	return value.trim().toUpperCase();
}

function normalizeCalendarDisplayMode(value: unknown): CalendarDisplayMode {
	return value === 'horizontal_calendar' ? 'horizontal_calendar' : DEFAULT_SETTINGS.calendarDisplayMode;
}

function normalizeLanguage(value: unknown): TraderJournalLanguage {
	return value === 'vi' ? 'vi' : DEFAULT_SETTINGS.language;
}

function normalizeTimeZone(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		return DEFAULT_ECONOMIC_CALENDAR_TIME_ZONE;
	}

	const timeZone = value.trim();
	try {
		new Intl.DateTimeFormat('en', { timeZone }).format();
		return timeZone;
	} catch {
		return DEFAULT_ECONOMIC_CALENDAR_TIME_ZONE;
	}
}

function normalizeEconomicImpacts(value: unknown): EconomicImpact[] {
	if (!Array.isArray(value)) {
		return [...DEFAULT_SETTINGS.economicCalendarImpacts];
	}

	const impacts = ECONOMIC_IMPACTS.filter((impact) => value.includes(impact));
	return impacts.length ? impacts : [...DEFAULT_SETTINGS.economicCalendarImpacts];
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
