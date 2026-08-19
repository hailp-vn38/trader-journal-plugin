import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_RECENT_TRADE_FILTERS,
	filterRecentTrades,
	getDashboardTrades,
	getReviewMetrics,
	getTradePlanLinkMetrics,
	getUnreviewedClosedLiveTradeCount,
} from '../src/dashboard/dashboardStats';
import type { JournalCalendarSnapshot, JournalCalendarTrade } from '../src/trades/journalIndex';
import { isTradeReviewed, normalizeTradeReview } from '../src/trades/review';
import type { TradeEntry, TradeReview } from '../src/trades/types';
import {
	countTradeDrilldownFiles,
	filterTradeDrilldownTrades,
	getTradeDrilldownTrades,
} from '../src/dashboard/drilldown/tradeDrilldownQuery';

void test('normalizes valid review fields and drops unsupported mistake tags', () => {
	const review = normalizeTradeReview({
		schema_version: 3,
		context: 'wrong',
		entry_timing: 'early',
		plan_adherence: 'not_followed',
		mistake_tags: ['early_entry', 'unknown', 'early_entry'],
		lesson: ' Wait for confirmation. ',
		reviewed_at: '2026-08-14T12:00:00+07:00',
	});

	assert.deepEqual(review, {
		schema_version: 1,
		context: 'wrong',
		entry_timing: 'early',
		plan_adherence: 'not_followed',
		mistake_tags: ['early_entry'],
		lesson: 'Wait for confirmation.',
		reviewed_at: '2026-08-14T12:00:00+07:00',
	});
	assert.equal(isTradeReviewed({ review: { lesson: 'Missing timestamp' } as unknown as TradeReview }), false);
});

void test('aggregates mistake frequency and signed RR by plan adherence', () => {
	const trades = [
		createTrade('win', 2, createReview('followed', ['early_entry'])),
		createTrade('loss', 1, createReview('not_followed', ['early_entry', 'wrong_context'])),
		createTrade('win', 1.5, createReview(undefined, ['fomo'])),
		createTrade('loss', 1, undefined),
	];

	const metrics = getReviewMetrics(trades);
	assert.equal(metrics.closedTradeCount, 4);
	assert.equal(metrics.reviewedTradeCount, 3);
	assert.equal(metrics.unreviewedTradeCount, 1);
	assert.equal(metrics.reviewCompletionRate, 75);
	assert.deepEqual(metrics.mistakes.map(({ tag, count }) => ({ tag, count })), [
		{ tag: 'early_entry', count: 2 },
		{ tag: 'fomo', count: 1 },
		{ tag: 'wrong_context', count: 1 },
	]);
	assert.ok(Math.abs((metrics.mistakes[0]?.rate ?? 0) - 200 / 3) < 1e-10);
	assert.deepEqual(metrics.planAdherence, [
		{ adherence: 'followed', tradeCount: 1, winRate: 100, netRr: 2, averageRr: 2 },
		{ adherence: 'not_followed', tradeCount: 1, winRate: 0, netRr: -1, averageRr: -1 },
	]);
});

void test('counts linked and unplanned live trades and averages by referenced plans', () => {
	const linkedPlanAFirst = createTrade('win', 2, undefined, 'NQ', 'plan-a');
	const linkedPlanASecond = createTrade('loss', 1, undefined, 'NQ', 'plan-a');
	const linkedPlanB = createTrade('win', 1, undefined, 'NQ', 'plan-b');
	const unplannedNq = createTrade('loss', 1, undefined, 'NQ');
	const linkedEs = createTrade('win', 1, undefined, 'ES', 'plan-es');
	const snapshot = createSnapshot([
		linkedPlanAFirst,
		linkedPlanASecond,
		linkedPlanB,
		unplannedNq,
		linkedEs,
	]);

	assert.deepEqual(getTradePlanLinkMetrics(snapshot, 'NQ'), {
		linkedTradeCount: 3,
		unplannedTradeCount: 1,
		executedPlanCount: 2,
		tradesPerExecutedPlan: 1.5,
	});
	assert.deepEqual(getTradePlanLinkMetrics(snapshot, 'YM'), {
		linkedTradeCount: 0,
		unplannedTradeCount: 0,
		executedPlanCount: 0,
		tradesPerExecutedPlan: 0,
	});
});

void test('filters recent trades by search, outcome, side, setup, review, and plan link', () => {
	const reviewedLinked = {
		...createTrade('win', 2, createReview('followed', []), 'NQ', 'plan-a'),
		side: 'Long',
		sideKey: 'long' as const,
		setup: 'Breakout',
		timeframe: '5m',
		notes: 'Waited for confirmation',
	};
	const unreviewedUnplanned = {
		...createTrade('loss', 1, undefined, 'NQ'),
		side: 'Short',
		sideKey: 'short' as const,
		setup: 'Reversal',
		timeframe: '1m',
		notes: 'Entered early',
	};
	const openLinked = {
		...createTrade('win', 1, undefined, 'NQ', 'plan-b'),
		status: 'open' as const,
		side: 'Long',
		sideKey: 'long' as const,
		setup: 'Breakout',
	};
	const trades = [reviewedLinked, unreviewedUnplanned, openLinked];

	assert.deepEqual(filterRecentTrades(trades, {
		...DEFAULT_RECENT_TRADE_FILTERS,
		query: 'confirmation',
		outcome: 'win',
		side: 'long',
		setup: 'Breakout',
		review: 'reviewed',
		plan: 'linked',
	}), [reviewedLinked]);
	assert.deepEqual(filterRecentTrades(trades, {
		...DEFAULT_RECENT_TRADE_FILTERS,
		review: 'unreviewed',
		plan: 'unplanned',
	}), [unreviewedUnplanned]);
	assert.deepEqual(filterRecentTrades(trades, {
		...DEFAULT_RECENT_TRADE_FILTERS,
		outcome: 'open',
	}), [openLinked]);
});

void test('counts only closed unreviewed live trades for the selected symbol', () => {
	const unreviewedNq = createTrade('loss', 1, undefined, 'NQ');
	const reviewedNq = createTrade('win', 2, createReview('followed', []), 'NQ');
	const unreviewedEs = createTrade('loss', 1, undefined, 'ES');
	const openNq = { ...createTrade('win', 1, undefined, 'NQ'), status: 'open' as const };
	const snapshot = createSnapshot([unreviewedNq, reviewedNq, unreviewedEs, openNq]);

	assert.equal(getUnreviewedClosedLiveTradeCount(snapshot), 2);
	assert.equal(getUnreviewedClosedLiveTradeCount(snapshot, 'NQ'), 1);
});

void test('drills down by review status, mistake, and plan adherence within dashboard filters', () => {
	const followedFomo = createIndexedTrade(
		'followed-fomo',
		'2026-08-14',
		'win',
		2,
		createReview('followed', ['fomo']),
		'NQ',
		'Journal/day-a.md',
	);
	const ignoredPlan = createIndexedTrade(
		'ignored-plan',
		'2026-08-13',
		'loss',
		1,
		createReview('not_followed', ['ignored_plan']),
		'NQ',
		'Journal/day-a.md',
	);
	const unreviewed = createIndexedTrade(
		'unreviewed',
		'2026-08-12',
		'loss',
		1.5,
		undefined,
		'ES',
		'Journal/day-b.md',
	);
	const snapshot = createSnapshot([followedFomo, ignoredPlan, unreviewed]);
	const filters = { journalType: 'live' as const, period: 'all' as const, symbol: 'NQ' };

	assert.deepEqual(getTradeDrilldownTrades(snapshot, {
		criterion: { kind: 'mistake', value: 'fomo' },
		filters,
	}), [followedFomo]);
	assert.deepEqual(getTradeDrilldownTrades(snapshot, {
		criterion: { kind: 'plan-adherence', value: 'not_followed' },
		filters,
	}), [ignoredPlan]);
	assert.deepEqual(getTradeDrilldownTrades(snapshot, {
		criterion: { kind: 'review-status', value: 'unreviewed' },
		filters: { ...filters, symbol: '' },
	}), [unreviewed]);
	assert.equal(countTradeDrilldownFiles([followedFomo, ignoredPlan, unreviewed]), 2);
	assert.deepEqual(filterTradeDrilldownTrades(
		[followedFomo, ignoredPlan, unreviewed],
		'NQ',
		'rr-low',
	), [ignoredPlan, followedFomo]);
});

void test('filters dashboard trades for today, yesterday, and a custom date range', () => {
	const todayTrade = createIndexedTrade('today', '2026-08-14', 'win', 1, undefined, 'NQ', 'Journal/today.md');
	const yesterdayTrade = createIndexedTrade('yesterday', '2026-08-13', 'loss', 1, undefined, 'NQ', 'Journal/yesterday.md');
	const earlierTrade = createIndexedTrade('earlier', '2026-08-10', 'win', 2, undefined, 'NQ', 'Journal/earlier.md');
	const futureTrade = createIndexedTrade('future', '2026-08-15', 'win', 1, undefined, 'NQ', 'Journal/future.md');
	const snapshot = createSnapshot([todayTrade, yesterdayTrade, earlierTrade, futureTrade]);
	const now = new Date(2026, 7, 14, 12, 0, 0);

	assert.deepEqual(getDashboardTrades(snapshot, {
		journalType: 'live',
		period: 'today',
		symbol: '',
	}, now), [todayTrade]);
	assert.deepEqual(getDashboardTrades(snapshot, {
		journalType: 'live',
		period: 'yesterday',
		symbol: '',
	}, now), [yesterdayTrade]);
	assert.deepEqual(getDashboardTrades(snapshot, {
		journalType: 'live',
		period: 'custom',
		symbol: '',
		dateFrom: '2026-08-10',
		dateTo: '2026-08-13',
	}, now), [yesterdayTrade, earlierTrade]);
});

function createReview(
	planAdherence: TradeReview['plan_adherence'],
	mistakeTags: NonNullable<TradeReview['mistake_tags']>,
): TradeReview {
	return {
		schema_version: 1,
		...(planAdherence ? { plan_adherence: planAdherence } : {}),
		mistake_tags: mistakeTags,
		reviewed_at: '2026-08-14T12:00:00+07:00',
	};
}

function createTrade(
	resultKey: 'win' | 'loss',
	rr: number,
	review: TradeReview | undefined,
	symbol = 'NQ',
	planId = '',
): JournalCalendarTrade {
	const trade: TradeEntry = {
		journal_type: 'live',
		status: 'closed',
		result: resultKey,
		rr,
		review,
		...(planId ? { plan_id: planId } : {}),
	};
	return {
		journalType: 'live',
		status: 'closed',
		resultKey,
		reviewed: Boolean(review),
		symbol,
		trade,
	} as JournalCalendarTrade;
}

function createSnapshot(trades: JournalCalendarTrade[]): JournalCalendarSnapshot {
	return {
		daysByDate: {
			'2026-08-14': {
				date: '2026-08-14',
				backtestCount: 0,
				liveCount: trades.length,
				trades,
			},
		},
		dayDates: ['2026-08-14'],
		tradeCount: trades.length,
	};
}

function createIndexedTrade(
	id: string,
	journalDate: string,
	resultKey: 'win' | 'loss',
	rr: number,
	review: TradeReview | undefined,
	symbol: string,
	filePath: string,
): JournalCalendarTrade {
	return {
		...createTrade(resultKey, rr, review, symbol),
		id,
		journalDate,
		sortTime: new Date(`${journalDate}T12:00:00`).getTime(),
		filePath,
		setup: id,
		timeframe: '5m',
		side: 'Long',
		result: resultKey,
		rr: `${rr}R`,
	};
}
