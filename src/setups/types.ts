export type TradeSetupStatus = 'active' | 'archived';

export interface TradeSetupDefinition {
	id: string;
	name: string;
	status: TradeSetupStatus;
	symbols: string[];
	timeframes: string[];
	updatedAt: string;
	description: string;
	entryCriteria: string;
	invalidation: string;
	takeProfit: string;
	riskRules: string;
	filePath: string;
}

export interface NewTradeSetup {
	name: string;
	status: TradeSetupStatus;
	symbols: string[];
	timeframes: string[];
}
