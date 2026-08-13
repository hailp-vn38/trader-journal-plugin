import type { JournalPlanSnapshot, JournalCalendarPlan } from '../plans/planIndex';
import type { JournalCalendarSnapshot, JournalCalendarTrade } from '../trades/journalIndex';
import { stringifyValue } from '../trades/format';
import type { TradeJournalType } from '../trades/types';

export type DashboardPeriod = '7d' | '30d' | 'month' | 'all';

export interface DashboardFilters {
	journalType: TradeJournalType;
	period: DashboardPeriod;
	symbol: string;
}

export interface DashboardMetrics {
	tradeCount: number;
	completedTradeCount: number;
	winRate: number;
	netRr: number;
	averageRr: number;
}

export interface PlanMetrics {
	totalCount: number;
	openCount: number;
	closedCount: number;
	cancelledCount: number;
	withTradesCount: number;
	executionRate: number;
	openWithoutTradesCount: number;
}

export function getDashboardTrades(
	snapshot: JournalCalendarSnapshot,
	filters: DashboardFilters,
	today = new Date(),
): JournalCalendarTrade[] {
	const startDate = getPeriodStartDate(filters.period, today);
	return collectTrades(snapshot)
		.filter((trade) => trade.journalType === filters.journalType)
		.filter((trade) => !filters.symbol || trade.symbol === filters.symbol)
		.filter((trade) => !startDate || trade.journalDate >= startDate)
		.sort((first, second) => {
			if (first.journalDate !== second.journalDate) {
				return second.journalDate.localeCompare(first.journalDate);
			}
			return second.sortTime - first.sortTime;
		});
}

export function getDashboardMetrics(trades: JournalCalendarTrade[]): DashboardMetrics {
	const completedTrades = trades.filter(isTradeIncludedInOutcomeStats);
	const winCount = completedTrades.filter((trade) => trade.resultKey === 'win').length;
	const rrValues = completedTrades.map(getSignedRr);
	const netRr = rrValues.reduce((total, rr) => total + rr, 0);

	return {
		tradeCount: trades.length,
		completedTradeCount: completedTrades.length,
		winRate: completedTrades.length ? (winCount / completedTrades.length) * 100 : 0,
		netRr,
		averageRr: completedTrades.length ? netRr / completedTrades.length : 0,
	};
}

export function getDashboardSymbols(
	tradeSnapshot: JournalCalendarSnapshot,
	planSnapshot: JournalPlanSnapshot,
	journalType: TradeJournalType,
): string[] {
	const tradeSymbols = collectTrades(tradeSnapshot)
		.filter((trade) => trade.journalType === journalType)
		.map((trade) => trade.symbol);
	const planSymbols = planSnapshot.plans.map((plan) => plan.symbol);

	return [...new Set([...tradeSymbols, ...planSymbols].filter(Boolean))]
		.sort((first, second) => first.localeCompare(second));
}

export function getOpenPlans(snapshot: JournalPlanSnapshot, symbol = ''): JournalCalendarPlan[] {
	return snapshot.plans
		.filter((plan) => plan.status === 'open')
		.filter((plan) => !symbol || plan.symbol === symbol)
		.sort((first, second) => {
			if ((first.linkedTradeCount === 0) !== (second.linkedTradeCount === 0)) {
				return first.linkedTradeCount === 0 ? -1 : 1;
			}
			return second.sortTime - first.sortTime;
		});
}

export function getPlanMetrics(snapshot: JournalPlanSnapshot, symbol = ''): PlanMetrics {
	const plans = snapshot.plans.filter((plan) => !symbol || plan.symbol === symbol);
	const openPlans = plans.filter((plan) => plan.status === 'open');
	const withTradesCount = plans.filter((plan) => plan.linkedTradeCount > 0).length;

	return {
		totalCount: plans.length,
		openCount: openPlans.length,
		closedCount: plans.filter((plan) => plan.status === 'closed').length,
		cancelledCount: plans.filter((plan) => plan.status === 'cancelled').length,
		withTradesCount,
		executionRate: plans.length ? (withTradesCount / plans.length) * 100 : 0,
		openWithoutTradesCount: openPlans.filter((plan) => plan.linkedTradeCount === 0).length,
	};
}

export function getOpenLiveTradeCount(snapshot: JournalCalendarSnapshot, symbol = ''): number {
	return collectTrades(snapshot).filter(
		(trade) =>
			trade.journalType === 'live' &&
			trade.status === 'open' &&
			(!symbol || trade.symbol === symbol),
	).length;
}

function collectTrades(snapshot: JournalCalendarSnapshot): JournalCalendarTrade[] {
	return Object.values(snapshot.daysByDate).flatMap((day) => day.trades);
}

function isTradeIncludedInOutcomeStats(trade: JournalCalendarTrade): boolean {
	return trade.journalType !== 'live' || trade.status === 'closed';
}

function getSignedRr(trade: JournalCalendarTrade): number {
	const rr = parseRr(trade.trade.rr);
	if (trade.resultKey === 'loss') {
		return -Math.abs(rr);
	}
	if (trade.resultKey === 'win') {
		return Math.abs(rr);
	}
	if (trade.resultKey === 'breakeven') {
		return 0;
	}
	return rr;
}

function parseRr(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	const parsed = Number(stringifyValue(value).replace(/r$/i, ''));
	return Number.isFinite(parsed) ? parsed : 0;
}

function getPeriodStartDate(period: DashboardPeriod, today: Date): string | null {
	if (period === 'all') {
		return null;
	}

	const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	if (period === 'month') {
		start.setDate(1);
	} else {
		start.setDate(start.getDate() - (period === '7d' ? 6 : 29));
	}
	return formatDateKey(start);
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
