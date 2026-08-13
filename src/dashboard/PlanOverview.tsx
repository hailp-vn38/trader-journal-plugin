import { Notice } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { getLocale, getTranslator } from '../i18n';
import type { JournalCalendarPlan, JournalPlanSnapshot } from '../plans/planIndex';
import type { TraderJournalLanguage } from '../settings';
import { TradePlanModal } from '../ui/TradePlanModal';
import { getOpenPlans, getPlanMetrics } from './dashboardStats';
import { DashboardIconButton } from './DashboardIconButton';
import type { KeyboardEvent, MouseEvent } from 'react';

interface PlanOverviewProps {
	language: TraderJournalLanguage;
	plugin: TraderJournalPlugin;
	snapshot: JournalPlanSnapshot;
	symbol: string;
}

export function PlanOverview({ language, plugin, snapshot, symbol }: PlanOverviewProps) {
	const tr = getTranslator(language);
	const metrics = getPlanMetrics(snapshot, symbol);
	const openPlans = getOpenPlans(snapshot, symbol);

	return (
		<section className="trader-journal-dashboard__panel trader-journal-dashboard__plan-overview">
			<div className="trader-journal-dashboard__section-header">
				<div>
					<h3>{tr('dashboard.planOverview')}</h3>
					<p>{tr('dashboard.planOverviewSubtitle')}</p>
				</div>
			</div>

			<div className="trader-journal-dashboard__plan-metrics">
				<PlanMetric label={tr('dashboard.totalPlans')} value={metrics.totalCount} />
				<PlanMetric label={tr('dashboard.openPlans')} value={metrics.openCount} tone="accent" />
				<PlanMetric label={tr('dashboard.closedPlans')} value={metrics.closedCount} />
				<PlanMetric label={tr('dashboard.cancelledPlans')} value={metrics.cancelledCount} />
				<PlanMetric
					label={tr('dashboard.planExecution')}
					value={`${metrics.executionRate.toFixed(1)}%`}
					title={tr('dashboard.planExecutionDescription')}
				/>
			</div>
			<p className="trader-journal-dashboard__metric-note">
				{tr('dashboard.planExecutionDescription')}
			</p>

			{metrics.openWithoutTradesCount > 0 ? (
				<div className="trader-journal-dashboard__plan-alert">
					<strong>{metrics.openWithoutTradesCount}</strong>
					<span>{tr('dashboard.plansNeedTrade')}</span>
				</div>
			) : null}

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
	title,
}: {
	label: string;
	value: number | string;
	tone?: 'accent' | 'neutral';
	title?: string;
}) {
	return (
		<div className={`trader-journal-dashboard-plan-metric trader-journal-dashboard-plan-metric--${tone}`} title={title}>
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
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
