export const TRADE_CODE_BLOCK_LANGUAGE = 'trader-journal-trade';

export type TradeJournalType = 'backtest' | 'live';
export type TradeResult = 'loss' | 'win' | 'breakeven';
export type TradeSide = 'long' | 'short';
export type TradeImageType = 'url' | 'file';
export type LiveTradeStatus = 'open' | 'closed';
export type TradeReviewContext = 'correct' | 'partial' | 'wrong';
export type TradeReviewEntryTiming = 'early' | 'on_time' | 'late';
export type TradeReviewPlanAdherence = 'followed' | 'partial' | 'not_followed' | 'no_plan';
export type TradeReviewMistakeTag =
	| 'wrong_context'
	| 'early_entry'
	| 'late_entry'
	| 'no_confirmation'
	| 'fomo'
	| 'revenge_trade'
	| 'over_risk'
	| 'moved_stop'
	| 'cut_winner_early'
	| 'ignored_plan';

export interface TradeImage {
	type?: TradeImageType;
	value?: string;
	label?: string;
}

export interface TradeReview {
	schema_version: 1;
	context?: TradeReviewContext;
	entry_timing?: TradeReviewEntryTiming;
	plan_adherence?: TradeReviewPlanAdherence;
	mistake_tags?: TradeReviewMistakeTag[];
	what_went_well?: string;
	lesson?: string;
	next_action?: string;
	reviewed_at: string;
}

export interface TradeEntry {
	schemaVersion?: number;
	id?: string;
	date?: string;
	journal_type?: TradeJournalType;
	plan_id?: string;
	setup_id?: string;
	status?: LiveTradeStatus;
	symbol?: string;
	side?: TradeSide;
	setup?: string;
	timeframe?: string;
	result?: TradeResult;
	rr?: number | string;
	tags?: string[] | string;
	entry_price?: number | string;
	stop_loss?: number | string;
	exit_price?: number | string;
	take_profit?: number | string;
	images?: Array<TradeImage | string> | string;
	notes?: string;
	opened_at?: string;
	closed_at?: string;
	holding_time?: number | string | null;
	backtest_start_date?: string | null;
	backtest_end_date?: string | null;
	review?: TradeReview;
	[key: string]: unknown;
}

export interface NormalizedTradeImage {
	type: TradeImageType;
	value: string;
	label?: string;
}
