import { useMemo } from 'react';
import type { JournalCalendarTrade } from '../trades/journalIndex';
import type { TraderJournalLanguage } from '../settings';
import { getTranslator } from '../i18n';
import type { TradeReviewMistakeTag, TradeReviewPlanAdherence } from '../trades/types';
import { getReviewMetrics } from './dashboardStats';

interface ReviewInsightsProps {
	language: TraderJournalLanguage;
	trades: JournalCalendarTrade[];
}

export function ReviewInsights({ language, trades }: ReviewInsightsProps) {
	const tr = getTranslator(language);
	const metrics = useMemo(() => getReviewMetrics(trades), [trades]);
	const maxMistakeCount = metrics.mistakes[0]?.count ?? 0;

	return (
		<section className="trader-journal-dashboard__review-insights">
			<div className="trader-journal-dashboard__section-header">
				<div>
					<h3>{tr('dashboard.reviewInsights')}</h3>
					<p>{tr('dashboard.reviewInsightsDescription')}</p>
				</div>
			</div>
			<div className="trader-journal-dashboard__review-metrics">
				<ReviewMetric label={tr('dashboard.reviewedTrades')} value={String(metrics.reviewedTradeCount)} tone="positive" />
				<ReviewMetric label={tr('dashboard.unreviewedTrades')} value={String(metrics.unreviewedTradeCount)} tone={metrics.unreviewedTradeCount ? 'attention' : 'neutral'} />
				<ReviewMetric label={tr('dashboard.reviewCompletionRate')} value={formatPercent(metrics.reviewCompletionRate)} tone="accent" />
			</div>
			<div className="trader-journal-dashboard__review-grid">
				<div className="trader-journal-dashboard-review-panel">
					<h4>{tr('dashboard.commonMistakes')}</h4>
					{metrics.mistakes.length ? (
						<div className="trader-journal-dashboard-mistakes">
							{metrics.mistakes.slice(0, 6).map((mistake) => (
								<div className="trader-journal-dashboard-mistake" key={mistake.tag}>
									<div><span>{tr(getMistakeKey(mistake.tag))}</span><strong>{mistake.count}</strong></div>
									<div className="trader-journal-dashboard-mistake__track">
										<span style={{ width: `${maxMistakeCount ? (mistake.count / maxMistakeCount) * 100 : 0}%` }} />
									</div>
									<small>{formatPercent(mistake.rate)}</small>
								</div>
							))}
						</div>
					) : <p className="trader-journal-dashboard__empty">{tr('dashboard.noMistakes')}</p>}
				</div>

				<div className="trader-journal-dashboard-review-panel">
					<h4>{tr('dashboard.planAdherenceAnalysis')}</h4>
					{metrics.planAdherence.length ? (
						<div className="trader-journal-dashboard-adherence">
							<div className="trader-journal-dashboard-adherence__header">
								<span>{tr('review.planAdherence')}</span>
								<span>{tr('storage.trades')}</span>
								<span>{tr('dashboard.averageRr')}</span>
								<span>{tr('dashboard.netRr')}</span>
							</div>
							{metrics.planAdherence.map((item) => (
								<div className="trader-journal-dashboard-adherence__row" key={item.adherence}>
									<strong>{tr(getPlanAdherenceKey(item.adherence))}</strong>
									<span>{item.tradeCount}</span>
									<span className={getRrTone(item.averageRr)}>{formatRr(item.averageRr)}</span>
									<span className={getRrTone(item.netRr)}>{formatRr(item.netRr)}</span>
								</div>
							))}
						</div>
					) : <p className="trader-journal-dashboard__empty">{tr('dashboard.noReviewAdherence')}</p>}
				</div>
			</div>
		</section>
	);
}

function ReviewMetric({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone: 'positive' | 'attention' | 'accent' | 'neutral';
}) {
	return (
		<div className={`trader-journal-dashboard-review-metric trader-journal-dashboard-review-metric--${tone}`}>
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}

function getMistakeKey(value: TradeReviewMistakeTag) {
	return `review.mistake.${value}` as const;
}

function getPlanAdherenceKey(value: TradeReviewPlanAdherence) {
	return `review.planAdherence.${value}` as const;
}

function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatRr(value: number): string {
	return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function getRrTone(value: number): string {
	return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : '';
}
