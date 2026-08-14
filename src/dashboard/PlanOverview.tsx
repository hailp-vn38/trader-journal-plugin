import { Notice } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { getLocale, getTranslator } from '../i18n';
import type { JournalCalendarPlan, JournalPlanSnapshot } from '../plans/planIndex';
import type { TraderJournalLanguage } from '../settings';
import type { JournalCalendarSnapshot } from '../trades/journalIndex';
import { TradePlanModal } from '../ui/TradePlanModal';
import { getOpenPlans, getPlanMetrics, getTradePlanLinkMetrics } from './dashboardStats';
import { DashboardIconButton } from './DashboardIconButton';
import type { KeyboardEvent, MouseEvent } from 'react';

interface PlanOverviewProps {
	language: TraderJournalLanguage;
	plugin: TraderJournalPlugin;
	snapshot: JournalPlanSnapshot;
	tradeSnapshot: JournalCalendarSnapshot;
	symbol: string;
}

export function PlanOverview({ language, plugin, snapshot, tradeSnapshot, symbol }: PlanOverviewProps) {
	const tr = getTranslator(language);
	const metrics = getPlanMetrics(snapshot, symbol);
	const openPlans = getOpenPlans(snapshot, symbol);
	const tradePlanMetrics = getTradePlanLinkMetrics(tradeSnapshot, symbol);

	return (
		<section className="trader-journal-dashboard__panel trader-journal-dashboard__plan-overview">
			<div className="trader-journal-dashboard__section-header">
				<div>
					<h3>{tr('dashboard.planOverview')}</h3>
					<p>{tr('dashboard.planOverviewSubtitle')}</p>
				</div>
				<DashboardIconButton
					icon="plus"
					label={tr('command.addTradePlan')}
					primary
					size="compact"
					onClick={() => new TradePlanModal(plugin.app, plugin).open()}
				/>
			</div>

			<div className="trader-journal-dashboard__plan-metrics">
				<PlanMetric label={tr('dashboard.totalPlans')} value={metrics.totalCount} />
				<PlanMetric label={tr('dashboard.openPlans')} value={metrics.openCount} tone="accent" />
				<PlanMetric label={tr('dashboard.closedPlans')} value={metrics.closedCount} />
				<PlanMetric label={tr('dashboard.cancelledPlans')} value={metrics.cancelledCount} />
			</div>

			<div className="trader-journal-dashboard__plan-execution">
				<div className="trader-journal-dashboard__plan-execution-header">
					<div>
						<strong>{tr('dashboard.planExecution')}</strong>
						<span>{tr('dashboard.planExecutionDescription')}</span>
					</div>
					<strong>{metrics.executionRate.toFixed(1)}%</strong>
				</div>
				<div
					className="trader-journal-dashboard__plan-execution-track"
					role="progressbar"
					aria-label={tr('dashboard.planExecution')}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={metrics.executionRate}
				>
					<span style={{ width: `${Math.min(100, Math.max(0, metrics.executionRate))}%` }} />
				</div>
			</div>

			<div className="trader-journal-dashboard__subheading trader-journal-dashboard__trade-plan-heading">
				<h4>{tr('dashboard.tradePlanLinkage')}</h4>
				<span>{tr('dashboard.allTime')}</span>
			</div>
			<div className="trader-journal-dashboard__trade-plan-metrics">
				<PlanMetric label={tr('dashboard.linkedLiveTrades')} value={tradePlanMetrics.linkedTradeCount} tone="accent" />
				<PlanMetric label={tr('dashboard.unplannedLiveTrades')} value={tradePlanMetrics.unplannedTradeCount} />
				<PlanMetric label={tr('dashboard.tradesPerExecutedPlan')} value={formatDecimal(tradePlanMetrics.tradesPerExecutedPlan)} />
			</div>

			<div className="trader-journal-dashboard__subheading">
				<h4>{tr('dashboard.activePlans')}</h4>
				<span>{openPlans.length}</span>
			</div>

			{openPlans.length ? (
				<div className="trader-journal-dashboard__plan-grid">
					{openPlans.map((plan) => (
						<OpenPlanCard language={language} plan={plan} plugin={plugin} key={`${plan.filePath}:${plan.id}`} />
					))}
				</div>
			) : (
				<p className="trader-journal-dashboard__empty">{tr('dashboard.emptyPlans')}</p>
			)}
		</section>
	);
}

function PlanMetric({
	label,
	value,
	tone = 'neutral',
}: {
	label: string;
	value: number | string;
	tone?: 'accent' | 'neutral';
}) {
	return (
		<div className={`trader-journal-dashboard-plan-metric trader-journal-dashboard-plan-metric--${tone}`}>
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}

function formatDecimal(value: number): string {
	return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function OpenPlanCard({
	language,
	plan,
	plugin,
}: {
	language: TraderJournalLanguage;
	plan: JournalCalendarPlan;
	plugin: TraderJournalPlugin;
}) {
	const tr = getTranslator(language);
	const locale = getLocale(language);
	const openPlan = async () => {
		try {
			await plugin.app.workspace.openLinkText(plan.filePath, '', false);
		} catch (error) {
			console.error('Trader Journal failed to open plan note from dashboard', error);
			new Notice(tr('calendar.openPlanNoteError'));
		}
	};
	const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
			return;
		}

		event.preventDefault();
		void openPlan();
	};
	const stopCardClick = (event: MouseEvent<HTMLDivElement>) => {
		event.stopPropagation();
	};

	return (
		<article
			className={`trader-journal-dashboard-plan-card${plan.linkedTradeCount === 0 ? ' trader-journal-dashboard-plan-card--attention' : ''}`}
			role="button"
			tabIndex={0}
			onClick={() => void openPlan()}
			onKeyDown={handleCardKeyDown}
		>
			<div className="trader-journal-dashboard-plan-card__header">
				<div>
					<div className="trader-journal-dashboard-plan-card__identity">
						<strong>{plan.symbol}</strong>
						<span>{formatBias(plan, language)}</span>
					</div>
					<h5>{plan.title}</h5>
				</div>
				<span className="trader-journal-dashboard-plan-card__status">{tr('option.open')}</span>
			</div>

			<div className="trader-journal-dashboard-plan-card__details">
				<span>{tr('dashboard.started', { date: formatDate(plan.startDate, locale) })}</span>
				{plan.setup ? <span>{plan.setup}</span> : null}
				{plan.timeframes.length ? <span>{plan.timeframes.join(', ')}</span> : null}
			</div>

			<div className="trader-journal-dashboard-plan-card__footer">
				<span className={plan.linkedTradeCount === 0 ? 'is-attention' : 'is-linked'}>
					{plan.linkedTradeCount === 0
						? tr('dashboard.noLinkedTrades')
						: tr('calendar.linkedTradeCount', { count: plan.linkedTradeCount })}
				</span>
				<div className="trader-journal-dashboard-plan-card__actions" onClick={stopCardClick}>
					<DashboardIconButton
						icon="pencil"
						label={tr('dashboard.editPlan')}
						primary
						size="compact"
						onClick={() => new TradePlanModal(plugin.app, plugin, plan.plan, plan.filePath).open()}
					/>
				</div>
			</div>
		</article>
	);
}

function formatBias(plan: JournalCalendarPlan, language: TraderJournalLanguage): string {
	const tr = getTranslator(language);
	if (plan.bias === 'long') {
		return tr('option.long');
	}
	if (plan.bias === 'short') {
		return tr('option.short');
	}
	return tr('option.neutral');
}

function formatDate(value: string, locale: string | undefined): string {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime())
		? value
		: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
