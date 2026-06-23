import type { TradeImage, TradeSide } from '../trades/types';

export const PLAN_CODE_BLOCK_LANGUAGE = 'trader-journal-plan';

export type TradePlanStatus = 'open' | 'closed' | 'cancelled';
export type TradePlanBias = TradeSide | 'neutral';

export interface LinkedTradeRef {
	trade_id?: string;
	file_path?: string;
	label?: string;
}

export interface TradePlanEntry {
	schemaVersion?: number;
	id?: string;
	journal_type?: 'live';
	symbol?: string;
	title?: string;
	status?: TradePlanStatus;
	start_date?: string;
	end_date?: string | null;
	bias?: TradePlanBias;
	setup?: string;
	timeframes?: string[] | string;
	entry_plan?: string;
	invalidation?: string;
	take_profit_plan?: string;
	risk_notes?: string;
	images?: Array<TradeImage | string> | string;
	notes?: string;
	linked_trades?: LinkedTradeRef[];
	created_at?: string;
	updated_at?: string;
	[key: string]: unknown;
}

export interface TradePlanOption {
	id: string;
	title: string;
	symbol: string;
	status: TradePlanStatus;
	startDate: string;
	endDate: string | null;
	filePath: string;
}
