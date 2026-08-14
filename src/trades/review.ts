import type {
	TradeEntry,
	TradeReview,
	TradeReviewContext,
	TradeReviewEntryTiming,
	TradeReviewMistakeTag,
	TradeReviewPlanAdherence,
} from './types';

export const TRADE_REVIEW_CONTEXTS: readonly TradeReviewContext[] = ['correct', 'partial', 'wrong'];
export const TRADE_REVIEW_ENTRY_TIMINGS: readonly TradeReviewEntryTiming[] = ['early', 'on_time', 'late'];
export const TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS: readonly TradeReviewPlanAdherence[] = [
	'followed',
	'partial',
	'not_followed',
	'no_plan',
];
export const TRADE_REVIEW_MISTAKE_TAGS: readonly TradeReviewMistakeTag[] = [
	'wrong_context',
	'early_entry',
	'late_entry',
	'no_confirmation',
	'fomo',
	'revenge_trade',
	'over_risk',
	'moved_stop',
	'cut_winner_early',
	'ignored_plan',
];

export function normalizeTradeReview(value: unknown): TradeReview | null {
	if (!isRecord(value)) {
		return null;
	}

	const reviewedAt = readString(value.reviewed_at);
	if (!reviewedAt) {
		return null;
	}

	const review: TradeReview = {
		schema_version: 1,
		reviewed_at: reviewedAt,
	};
	const context = readEnum(value.context, TRADE_REVIEW_CONTEXTS);
	const entryTiming = readEnum(value.entry_timing, TRADE_REVIEW_ENTRY_TIMINGS);
	const planAdherence = readEnum(value.plan_adherence, TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS);
	const mistakeTags = Array.isArray(value.mistake_tags)
		? value.mistake_tags
				.map((tag) => readEnum(tag, TRADE_REVIEW_MISTAKE_TAGS))
				.filter((tag): tag is TradeReviewMistakeTag => Boolean(tag))
		: [];

	if (context) review.context = context;
	if (entryTiming) review.entry_timing = entryTiming;
	if (planAdherence) review.plan_adherence = planAdherence;
	if (mistakeTags.length) review.mistake_tags = [...new Set(mistakeTags)];
	assignText(review, 'what_went_well', value.what_went_well);
	assignText(review, 'lesson', value.lesson);
	assignText(review, 'next_action', value.next_action);

	return review;
}

export function isTradeReviewed(trade: TradeEntry): boolean {
	return normalizeTradeReview(trade.review) !== null;
}

export function isClosedLiveTrade(trade: TradeEntry): boolean {
	return trade.journal_type === 'live' && (trade.status === 'closed' || Boolean(readString(trade.closed_at)));
}

function assignText<K extends 'what_went_well' | 'lesson' | 'next_action'>(
	review: TradeReview,
	key: K,
	value: unknown,
): void {
	const text = readString(value);
	if (text) {
		review[key] = text;
	}
}

function readString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function readEnum<T extends string>(value: unknown, options: readonly T[]): T | null {
	return typeof value === 'string' && options.includes(value as T) ? value as T : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
