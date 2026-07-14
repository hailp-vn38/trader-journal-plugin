export const ECONOMIC_IMPACTS = ['High', 'Medium', 'Low', 'Holiday'] as const;

export type EconomicImpact = (typeof ECONOMIC_IMPACTS)[number];

export interface EconomicCalendarEvent {
	title: string;
	country: string;
	date: string;
	impact: EconomicImpact;
	forecast: string;
	previous: string;
}

export interface EconomicCalendarCache {
	weekKey: string;
	fetchedAt: string;
	events: EconomicCalendarEvent[];
}

export interface EconomicCalendarSnapshot {
	events: EconomicCalendarEvent[];
	fromCache: boolean;
	fetchedAt: string;
}
