import assert from 'node:assert/strict';
import test from 'node:test';
import {
	getTraderJournalNoteType,
	setTraderJournalNoteType,
} from '../src/utils/noteType';

void test('reads the current note type key before the legacy type key', () => {
	assert.equal(
		getTraderJournalNoteType({
			traderJournalNoteType: 'trader-journal-live-plan',
			type: 'legacy-value',
		}),
		'trader-journal-live-plan',
	);
});

void test('reads legacy note types and replaces the legacy key when writing', () => {
	const metadata: Record<string, unknown> = {
		type: 'trader-journal-setup',
	};

	assert.equal(getTraderJournalNoteType(metadata), 'trader-journal-setup');
	setTraderJournalNoteType(metadata, 'trader-journal-setup');
	assert.deepEqual(metadata, {
		traderJournalNoteType: 'trader-journal-setup',
	});
});
