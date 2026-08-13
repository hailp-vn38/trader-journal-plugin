import type { TFile } from 'obsidian';
import { createPlanDaysForRange, type JournalCalendarPlan } from '../src/plans/planIndex';
import { INDEX_READ_CONCURRENCY, mapWithConcurrency } from '../src/utils/async';

const PLAN_COUNT = 1_000;
const ITERATIONS = 5;
const plans = Array.from({ length: PLAN_COUNT }, (_, index) => createPlan(index));

materializeLegacyPlanDays(plans);
createPlanDaysForRange(plans, '2026-07-27', '2026-09-06', '2026-08-13');

const legacy = measure(() => materializeLegacyPlanDays(plans));
const rangeBased = measure(() =>
	createPlanDaysForRange(plans, '2026-07-27', '2026-09-06', '2026-08-13'),
);
const concurrencyPeak = await measureConcurrencyPeak();

console.log(
	JSON.stringify(
		{
			dataset: { plans: PLAN_COUNT, legacyMaxDaysPerPlan: 730, visibleRangeDays: 42 },
			legacy: {
				medianMs: round(legacy.medianMs),
				planDayReferences: countLegacyReferences(legacy.value),
			},
			rangeBased: {
				medianMs: round(rangeBased.medianMs),
				planDayReferences: countRangeReferences(rangeBased.value),
			},
			speedup: round(legacy.medianMs / Math.max(rangeBased.medianMs, 0.001)),
			configuredReadConcurrency: INDEX_READ_CONCURRENCY,
			observedPeakConcurrency: concurrencyPeak,
		},
		null,
		2,
	),
);

function materializeLegacyPlanDays(
	items: readonly JournalCalendarPlan[],
): Record<string, JournalCalendarPlan[]> {
	const daysByDate: Record<string, JournalCalendarPlan[]> = {};
	for (const plan of items) {
		const start = new Date(`${plan.startDate}T00:00:00`);
		const end = new Date('2026-08-13T00:00:00');
		for (let index = 0, date = start; date <= end && index < 730; index += 1) {
			const dateKey = formatDateKey(date);
			(daysByDate[dateKey] ??= []).push(plan);
			date = new Date(date);
			date.setDate(date.getDate() + 1);
		}
	}
	return daysByDate;
}

function measure<T>(operation: () => T): { medianMs: number; value: T } {
	const durations: number[] = [];
	let value = operation();
	for (let index = 0; index < ITERATIONS; index += 1) {
		const start = performance.now();
		value = operation();
		durations.push(performance.now() - start);
	}
	durations.sort((first, second) => first - second);
	return { medianMs: durations[Math.floor(durations.length / 2)] ?? 0, value };
}

async function measureConcurrencyPeak(): Promise<number> {
	let active = 0;
	let peak = 0;
	await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), INDEX_READ_CONCURRENCY, async () => {
		active += 1;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 1));
		active -= 1;
	});
	return peak;
}

function countLegacyReferences(days: Record<string, JournalCalendarPlan[]>): number {
	return Object.values(days).reduce((total, dayPlans) => total + dayPlans.length, 0);
}

function countRangeReferences(days: ReturnType<typeof createPlanDaysForRange>): number {
	return Object.values(days).reduce((total, day) => total + day.plans.length, 0);
}

function createPlan(index: number): JournalCalendarPlan {
	return {
		id: `plan-${index}`,
		file: null as unknown as TFile,
		filePath: `Trading/Live/_plans/plan-${index}.md`,
		symbol: 'NQ',
		title: `Plan ${index}`,
		status: 'open',
		bias: null,
		setup: '',
		timeframes: [],
		startDate: '2020-01-01',
		endDate: null,
		notes: '',
		imageCount: 0,
		linkedTradeCount: 0,
		sortTime: index,
		plan: {},
	};
}

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
