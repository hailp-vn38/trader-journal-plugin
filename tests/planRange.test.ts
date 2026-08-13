import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFile } from 'obsidian';
import {
	createPlanDaysForRange,
	type JournalCalendarPlan,
} from '../src/plans/planIndex';
import type { TradePlanStatus } from '../src/plans/types';

void test('materializes an old open plan in the visible range without a 730-day cutoff', () => {
	const plan = createPlan('open', '2020-01-01', null);
	const days = createPlanDaysForRange([plan], '2026-08-01', '2026-08-31', '2026-08-13');

	assert.equal(Object.keys(days).length, 13);
	assert.equal(days['2026-08-13']?.openPlanCount, 1);
	assert.equal(days['2026-08-14'], undefined);
});

void test('clips closed plans to the visible range and preserves leap days', () => {
	const plan = createPlan('closed', '2028-02-28', '2028-03-01');
	const days = createPlanDaysForRange([plan], '2028-02-29', '2028-03-31', '2028-04-01');

	assert.deepEqual(Object.keys(days), ['2028-02-29', '2028-03-01']);
	assert.equal(days['2028-02-29']?.closedPlanCount, 1);
});

void test('returns no plan days when the interval does not overlap the visible range', () => {
	const plan = createPlan('cancelled', '2026-01-01', '2026-01-02');
	assert.deepEqual(createPlanDaysForRange([plan], '2026-08-01', '2026-08-31', '2026-08-13'), {});
});

function createPlan(status: TradePlanStatus, startDate: string, endDate: string | null): JournalCalendarPlan {
	return {
		id: `${status}-${startDate}`,
		file: null as unknown as TFile,
		filePath: `Trading/Live/_plans/${status}-${startDate}.md`,
		symbol: 'NQ',
		title: 'Test plan',
		status,
		bias: null,
		setup: '',
		timeframes: [],
		startDate,
		endDate,
		notes: '',
		imageCount: 0,
		linkedTradeCount: 0,
		sortTime: 0,
		plan: {},
	};
}
