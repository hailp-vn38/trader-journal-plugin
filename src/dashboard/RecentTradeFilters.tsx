import type { TraderJournalLanguage } from '../settings';
import type { TradeJournalType } from '../trades/types';
import { getTranslator } from '../i18n';
import type {
	RecentTradeFilters as RecentTradeFilterState,
	RecentTradeOutcomeFilter,
	RecentTradePlanFilter,
	RecentTradeReviewFilter,
	RecentTradeSideFilter,
} from './dashboardStats';

interface RecentTradeFiltersProps {
	filters: RecentTradeFilterState;
	journalType: TradeJournalType;
	language: TraderJournalLanguage;
	matchedCount: number;
	onChange: (filters: RecentTradeFilterState) => void;
	onReset: () => void;
	setupOptions: string[];
	totalCount: number;
}

export function RecentTradeFilters({
	filters,
	journalType,
	language,
	matchedCount,
	onChange,
	onReset,
	setupOptions,
	totalCount,
}: RecentTradeFiltersProps) {
	const tr = getTranslator(language);
	const updateFilter = <K extends keyof RecentTradeFilterState>(
		key: K,
		value: RecentTradeFilterState[K],
	) => onChange({ ...filters, [key]: value });
	const activeFilterCount = [
		Boolean(filters.query.trim()),
		filters.outcome !== 'all',
		filters.side !== 'all',
		Boolean(filters.setup),
		journalType === 'live' && filters.review !== 'all',
		journalType === 'live' && filters.plan !== 'all',
	].filter(Boolean).length;

	return (
		<details className="trader-journal-dashboard-recent-filters">
			<summary>
				<span>{tr('dashboard.advancedFilters')}</span>
				<span className="trader-journal-dashboard-recent-filters__summary-meta">
					{activeFilterCount ? <strong>{activeFilterCount}</strong> : null}
					<small>{tr('dashboard.filteredTradeCount', { count: matchedCount, total: totalCount })}</small>
				</span>
			</summary>
			<div className="trader-journal-dashboard-recent-filters__grid">
				<label>
					<span>{tr('dashboard.searchTrades')}</span>
					<input
						type="search"
						value={filters.query}
						placeholder={tr('placeholder.searchTrades')}
						onChange={(event) => updateFilter('query', event.target.value)}
					/>
				</label>
				<label>
					<span>{tr('dashboard.resultStatus')}</span>
					<select
						value={filters.outcome}
						onChange={(event) => updateFilter('outcome', event.target.value as RecentTradeOutcomeFilter)}
					>
						<option value="all">{tr('dashboard.allResults')}</option>
						{journalType === 'live' ? <option value="open">{tr('option.open')}</option> : null}
						<option value="win">{tr('option.win')}</option>
						<option value="loss">{tr('option.loss')}</option>
						<option value="breakeven">{tr('option.breakeven')}</option>
					</select>
				</label>
				<label>
					<span>{tr('detail.side')}</span>
					<select
						value={filters.side}
						onChange={(event) => updateFilter('side', event.target.value as RecentTradeSideFilter)}
					>
						<option value="all">{tr('dashboard.allSides')}</option>
						<option value="long">{tr('option.long')}</option>
						<option value="short">{tr('option.short')}</option>
					</select>
				</label>
				<label>
					<span>{tr('detail.setup')}</span>
					<select value={filters.setup} onChange={(event) => updateFilter('setup', event.target.value)}>
						<option value="">{tr('dashboard.allSetups')}</option>
						{setupOptions.map((setup) => <option value={setup} key={setup}>{setup}</option>)}
					</select>
				</label>
				{journalType === 'live' ? (
					<>
						<label>
							<span>{tr('dashboard.reviewStatus')}</span>
							<select
								value={filters.review}
								onChange={(event) => updateFilter('review', event.target.value as RecentTradeReviewFilter)}
							>
								<option value="all">{tr('dashboard.allReviewStatuses')}</option>
								<option value="reviewed">{tr('dashboard.reviewedTrades')}</option>
								<option value="unreviewed">{tr('dashboard.unreviewedTrades')}</option>
							</select>
						</label>
						<label>
							<span>{tr('dashboard.planLinkStatus')}</span>
							<select
								value={filters.plan}
								onChange={(event) => updateFilter('plan', event.target.value as RecentTradePlanFilter)}
							>
								<option value="all">{tr('dashboard.allPlanLinks')}</option>
								<option value="linked">{tr('dashboard.withPlan')}</option>
								<option value="unplanned">{tr('dashboard.withoutPlan')}</option>
							</select>
						</label>
					</>
				) : null}
			</div>
			<div className="trader-journal-dashboard-recent-filters__footer">
				<span>{tr('dashboard.filteredTradeCount', { count: matchedCount, total: totalCount })}</span>
				<button type="button" onClick={onReset} disabled={activeFilterCount === 0}>
					{tr('action.resetFilters')}
				</button>
			</div>
		</details>
	);
}
