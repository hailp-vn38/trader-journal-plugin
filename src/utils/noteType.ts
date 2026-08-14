export const TRADER_JOURNAL_NOTE_TYPE_KEY = 'traderJournalNoteType';
const LEGACY_NOTE_TYPE_KEY = 'type';

export function getTraderJournalNoteType(metadata: Record<string, unknown>): string {
	return normalizeNoteType(metadata[TRADER_JOURNAL_NOTE_TYPE_KEY]) || normalizeNoteType(metadata[LEGACY_NOTE_TYPE_KEY]);
}

export function setTraderJournalNoteType(metadata: Record<string, unknown>, noteType: string): void {
	metadata[TRADER_JOURNAL_NOTE_TYPE_KEY] = noteType;
	delete metadata[LEGACY_NOTE_TYPE_KEY];
}

function normalizeNoteType(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
