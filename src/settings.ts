export interface TraderJournalSettings {
	journalFolder: string;
	symbols: string[];
	timeframes: string[];
}

export const DEFAULT_SETTINGS: TraderJournalSettings = {
	journalFolder: 'Trading/Backtests',
	symbols: ['NQ', 'ES'],
	timeframes: ['1m', '3m', '5m', '15m', '1h'],
};

export function normalizeSettings(settings: Partial<TraderJournalSettings> | null | undefined): TraderJournalSettings {
	return {
		journalFolder: settings?.journalFolder?.trim() || DEFAULT_SETTINGS.journalFolder,
		symbols: normalizeStringList(settings?.symbols, DEFAULT_SETTINGS.symbols, normalizeSymbol),
		timeframes: normalizeStringList(settings?.timeframes, DEFAULT_SETTINGS.timeframes, normalizeTimeframe),
	};
}

export function normalizeSymbol(value: string): string {
	return value.trim().toUpperCase();
}

export function normalizeTimeframe(value: string): string {
	return value.trim();
}

function normalizeStringList(
	values: string[] | undefined,
	fallback: string[],
	normalize: (value: string) => string,
): string[] {
	const normalizedValues = (values?.length ? values : fallback)
		.map((value) => normalize(value))
		.filter(Boolean);

	return [...new Set(normalizedValues)];
}
