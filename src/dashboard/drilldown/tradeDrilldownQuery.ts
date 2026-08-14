import type { JournalCalendarSnapshot, JournalCalendarTrade } from '../../trades/journalIndex';
import { normalizeTradeReview } from '../../trades/review';
import { stringifyValue } from '../../trades/format';
import { getDashboardTrades } from '../dashboardStats';
import type { TradeDrilldownQuery, TradeDrilldownSort } from './types';

export function getTradeDrilldownTrades(
	snapshot: JournalCalendarSnapshot,
	query: TradeDrilldownQuery,
	today = new Date(),
): JournalCalendarTrade[] {
	return getDashboardTrades(snapshot, query.filters, today)
		.filter((trade) => trade.journalType === 'live' && trade.status === 'closed')
		.filter((trade) => matchesCriterion(trade, query));
}

export function filterTradeDrilldownTrades(
	trades: readonly JournalCalendarTrade[],
	search: string,
	sort: TradeDrilldownSort,
): JournalCalendarTrade[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();
	return trades
		.filter((trade) => !normalizedSearch || getSearchText(trade).includes(normalizedSearch))
		.sort((first, second) => compareTrades(first, second, sort));
}

export function countTradeDrilldownFiles(trades: readonly JournalCalendarTrade[]): number {
	return new Set(trades.map((trade) => trade.filePath)).size;
}

function matchesCriterion(trade: JournalCalendarTrade, query: TradeDrilldownQuery): boolean {
	const review = normalizeTradeReview(trade.trade.review);
	if (query.criterion.kind === 'review-status') {
		if (query.criterion.value === 'all-closed') {
			return true;
		}
		return query.criterion.value === 'reviewed' ? Boolean(review) : !review;
	}
	if (!review) {
		return false;
	}
	if (query.criterion.kind === 'mistake') {
		return review.mistake_tags?.includes(query.criterion.value) ?? false;
	}
	return review.plan_adherence === query.criterion.value;
}

function getSearchText(trade: JournalCalendarTrade): string {
	return [
		trade.symbol,
		trade.side,
		trade.setup,
		trade.timeframe,
		trade.result,
		trade.rr,
		trade.notes,
		trade.filePath,
		stringifyValue(trade.trade.plan_id),
	]
		.filter(Boolean)
		.join(' ')
		.toLocaleLowerCase();
}

function compareTrades(
	first: JournalCalendarTrade,
	second: JournalCalendarTrade,
	sort: TradeDrilldownSort,
): number {
	if (sort === 'rr-high' || sort === 'rr-low') {
		const rrDifference = getSignedRr(first) - getSignedRr(second);
		if (rrDifference !== 0) {
			return sort === 'rr-high' ? -rrDifference : rrDifference;
		}
	}

	const dateDifference = first.journalDate.localeCompare(second.journalDate)
		|| first.sortTime - second.sortTime;
	return sort === 'oldest' ? dateDifference : -dateDifference;
}

function getSignedRr(trade: JournalCalendarTrade): number {
	const value = typeof trade.trade.rr === 'number'
		? trade.trade.rr
		: Number(stringifyValue(trade.trade.rr).replace(/r$/i, ''));
	const rr = Number.isFinite(value) ? value : 0;
	if (trade.resultKey === 'loss') {
		return -Math.abs(rr);
	}
	if (trade.resultKey === 'win') {
		return Math.abs(rr);
	}
	return trade.resultKey === 'breakeven' ? 0 : rr;
}
