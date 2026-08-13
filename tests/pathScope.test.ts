import assert from 'node:assert/strict';
import test from 'node:test';
import type TraderJournalPlugin from '../src/main';
import { classifyTraderJournalPath, isPathInFolder } from '../src/journal/pathScope';
import { DEFAULT_SETTINGS } from '../src/settings';

function createPlugin(overrides: Partial<typeof DEFAULT_SETTINGS> = {}): TraderJournalPlugin {
	return {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
	} as TraderJournalPlugin;
}

void test('classifies nested reserved roots before journal roots', () => {
	const plugin = createPlugin();

	assert.equal(classifyTraderJournalPath(plugin, 'Trading/Backtests/NQ/2026/08/note.md'), 'journal');
	assert.equal(classifyTraderJournalPath(plugin, 'Trading/Live/_plans/NQ/plan.md'), 'plan');
	assert.equal(classifyTraderJournalPath(plugin, 'Trading/_setups/momentum.md'), 'setup');
	assert.equal(classifyTraderJournalPath(plugin, 'Trading/Live/_attachments/chart.png'), 'attachment');
	assert.equal(classifyTraderJournalPath(plugin, 'Notes/private.md'), 'unrelated');
});

void test('uses the longest configured root instead of fixed kind order', () => {
	const plugin = createPlugin({
		liveJournalFolder: 'Trading',
		planFolder: 'Trading/Data',
		setupFolder: 'Trading/Data/Setups',
	});

	assert.equal(classifyTraderJournalPath(plugin, 'Trading/Data/plan.md'), 'plan');
	assert.equal(classifyTraderJournalPath(plugin, 'Trading/Data/Setups/setup.md'), 'setup');
});

void test('matches exact folders, descendants, trailing slashes and vault root', () => {
	assert.equal(isPathInFolder('Trading/Live', 'Trading/Live/'), true);
	assert.equal(isPathInFolder('Trading/Live/NQ/note.md', 'Trading/Live'), true);
	assert.equal(isPathInFolder('Trading/Lively/note.md', 'Trading/Live'), false);
	assert.equal(isPathInFolder('Any/note.md', '.'), true);
});
