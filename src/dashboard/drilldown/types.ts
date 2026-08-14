import type { DashboardFilters } from '../dashboardStats';
import type { TradeReviewMistakeTag, TradeReviewPlanAdherence } from '../../trades/types';

export type TradeDrilldownCriterion =
	| { kind: 'review-status'; value: 'reviewed' | 'unreviewed' | 'all-closed' }
	| { kind: 'mistake'; value: TradeReviewMistakeTag }
	| { kind: 'plan-adherence'; value: TradeReviewPlanAdherence };

export interface TradeDrilldownQuery {
	criterion: TradeDrilldownCriterion;
	filters: DashboardFilters;
}

export type TradeDrilldownSort = 'newest' | 'oldest' | 'rr-high' | 'rr-low';
