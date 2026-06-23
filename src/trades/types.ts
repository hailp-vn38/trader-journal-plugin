export const TRADE_CODE_BLOCK_LANGUAGE = 'trader-journal-trade';

export type TradeJournalType = 'backtest' | 'live';
export type TradeResult = 'loss' | 'win' | 'breakeven';
export type TradeSide = 'long' | 'short';
export type TradeImageType = 'url' | 'file';
export type LiveTradeStatus = 'open' | 'closed';

export interface TradeImage {
	type?: TradeImageType;
	value?: string;
	label?: string;
}

export interface TradeEntry {
	schemaVersion?: number;
	id?: string;
	date?: string;
	journal_type?: TradeJournalType;
	plan_id?: string;
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
	[key: string]: unknown;
}

export interface NormalizedTradeImage {
	type: TradeImageType;
	value: string;
	label?: string;
}
