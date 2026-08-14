import type { Events } from 'obsidian';
import { Notice } from 'obsidian';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type TraderJournalPlugin from '../main';
import { getLocale, getTranslator } from '../i18n';
import { LANGUAGE_CHANGE_EVENT, type TraderJournalLanguage } from '../settings';
import type { JournalCalendarTrade } from '../trades/journalIndex';
import type { TradeJournalType } from '../trades/types';
import { TradePlanModal } from '../ui/TradePlanModal';
import { TraderJournalModal } from '../ui/TraderJournalModal';
import { openTraderJournalCalendar } from '../ui/TradeCalendarView';
import {
	getDashboardMetrics,
	getDashboardSymbols,
	getDashboardTrades,
	getOpenLiveTradeCount,
	getPlanMetrics,
	type DashboardPeriod,
} from './dashboardStats';
import { PlanOverview } from './PlanOverview';
import { DashboardIconButton } from './DashboardIconButton';
import { SetupOverview } from './SetupOverview';

interface DashboardProps {
	plugin: TraderJournalPlugin;
}

export function Dashboard({ plugin }: DashboardProps) {
	const initialData = plugin.journalDataService.getSnapshot();
	const [journalData, setJournalData] = useState(initialData);
	const [language, setLanguage] = useState<TraderJournalLanguage>(plugin.settings.language);
	const [journalType, setJournalType] = useState<TradeJournalType>('live');
	const [period, setPeriod] = useState<DashboardPeriod>('30d');
	const [symbol, setSymbol] = useState('');
	const tr = getTranslator(language);
	const locale = getLocale(language);

	useEffect(() => plugin.journalDataService.subscribe(setJournalData), [plugin]);

	useEffect(() => {
		const eventRef = (plugin.app.workspace as Events).on(LANGUAGE_CHANGE_EVENT, (nextLanguage: unknown) => {
			if (nextLanguage === 'en' || nextLanguage === 'vi') {
				setLanguage(nextLanguage);
			}
		});
		return () => plugin.app.workspace.offref(eventRef);
	}, [plugin]);

	const symbols = useMemo(
		() => getDashboardSymbols(journalData.trades, journalData.plans, journalType),
		[journalData.plans, journalData.trades, journalType],
	);
	const trades = useMemo(
		() => getDashboardTrades(journalData.trades, { journalType, period, symbol }),
		[journalData.trades, journalType, period, symbol],
	);
	const metrics = useMemo(() => getDashboardMetrics(trades), [trades]);
	const planMetrics = useMemo(
		() => getPlanMetrics(journalData.plans, symbol),
		[journalData.plans, symbol],
	);
	const openLiveTradeCount = useMemo(
		() => getOpenLiveTradeCount(journalData.trades, symbol),
		[journalData.trades, symbol],
	);

	useEffect(() => {
		if (symbol && !symbols.includes(symbol)) {
			setSymbol('');
		}
	}, [symbol, symbols]);

	return (
		<div className="trader-journal-dashboard">
			<header className="trader-journal-dashboard__header">
				<div>
					<h2>{tr('dashboard.title')}</h2>
					<p>{tr('dashboard.subtitle')}</p>
				</div>
				<div className="trader-journal-dashboard__quick-actions" aria-label={tr('dashboard.quickActions')}>
					<DashboardIconButton
						icon="activity"
						label={tr('command.addLiveTrade')}
						primary
						onClick={() => new TraderJournalModal(plugin.app, plugin, 'live').open()}
					/>
					<DashboardIconButton
						icon="history"
						label={tr('command.addBacktestTrade')}
						onClick={() => new TraderJournalModal(plugin.app, plugin, 'backtest').open()}
					/>
					<DashboardIconButton
						icon="clipboard-list"
						label={tr('command.addTradePlan')}
						onClick={() => new TradePlanModal(plugin.app, plugin).open()}
					/>
					<DashboardIconButton
						icon="calendar-clock"
						label={tr('dashboard.openCalendar')}
						onClick={() => void openTraderJournalCalendar(plugin)}
					/>
				</div>
			</header>

			{journalData.isLoading ? <div className="trader-journal-dashboard__loading">{tr('calendar.loadingTrades')}</div> : null}

			<section className="trader-journal-dashboard__attention" aria-label={tr('dashboard.attention')}>
				<AttentionCard label={tr('dashboard.openLiveTrades')} value={openLiveTradeCount} />
				<AttentionCard label={tr('dashboard.plansNeedTrade')} value={planMetrics.openWithoutTradesCount} />
			</section>

			<section className="trader-journal-dashboard__performance">
				<div className="trader-journal-dashboard__section-header">
					<h3>{tr('dashboard.performance')}</h3>
				</div>
				<div className="trader-journal-dashboard__filters" aria-label={tr('dashboard.filters')}>
					<label>
						<span>{tr('calendar.filterTradeType')}</span>
						<select value={journalType} onChange={(event) => setJournalType(event.target.value as TradeJournalType)}>
							<option value="live">{tr('option.live')}</option>
							<option value="backtest">{tr('option.backtest')}</option>
						</select>
					</label>
					<label>
						<span>{tr('dashboard.period')}</span>
						<select value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}>
							<option value="7d">{tr('dashboard.last7Days')}</option>
							<option value="30d">{tr('dashboard.last30Days')}</option>
							<option value="month">{tr('dashboard.currentMonth')}</option>
							<option value="all">{tr('dashboard.viewAllTime')}</option>
						</select>
					</label>
					<label>
						<span>{tr('detail.symbol')}</span>
						<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
							<option value="">{tr('dashboard.allSymbols')}</option>
							{symbols.map((item) => <option value={item} key={item}>{item}</option>)}
						</select>
					</label>
				</div>
				<div className="trader-journal-dashboard__metrics">
					<MetricCard label={tr('dashboard.totalTrades')} value={String(metrics.tradeCount)} />
					<MetricCard label={tr('dashboard.completedTrades')} value={String(metrics.completedTradeCount)} />
					<MetricCard label={tr('dashboard.winRate')} value={formatPercent(metrics.winRate)} />
					<MetricCard label={tr('dashboard.netRr')} value={formatRr(metrics.netRr)} tone={getNumberTone(metrics.netRr)} />
					<MetricCard label={tr('dashboard.averageRr')} value={formatRr(metrics.averageRr)} tone={getNumberTone(metrics.averageRr)} />
				</div>
			</section>

			<PlanOverview
				language={language}
				plugin={plugin}
				snapshot={journalData.plans}
				symbol={symbol}
			/>

			<div className="trader-journal-dashboard__secondary-grid">
				<section className="trader-journal-dashboard__panel">
					<h3>{tr('dashboard.recentTrades')}</h3>
					{trades.length ? (
						<div className="trader-journal-dashboard__list">
							{trades.slice(0, 10).map((trade) => (
								<RecentTradeRow trade={trade} locale={locale} plugin={plugin} key={`${trade.filePath}:${trade.id}`} />
							))}
						</div>
					) : <p className="trader-journal-dashboard__empty">{tr('dashboard.emptyTrades')}</p>}
				</section>

				<SetupOverview language={language} plugin={plugin} />
			</div>
		</div>
	);
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
	return <article className={`trader-journal-dashboard-metric trader-journal-dashboard-metric--${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function AttentionCard({ label, value }: { label: string; value: number }) {
	return <article className={`trader-journal-dashboard-attention${value > 0 ? ' is-active' : ''}`}><strong>{value}</strong><span>{label}</span></article>;
}

function RecentTradeRow({ trade, locale, plugin }: { trade: JournalCalendarTrade; locale: string | undefined; plugin: TraderJournalPlugin }) {
	const tr = getTranslator(plugin.settings.language);
	const openTrade = async () => {
		try {
			await plugin.app.workspace.openLinkText(trade.filePath, '', false);
		} catch (error) {
			console.error('Trader Journal failed to open trade note from dashboard', error);
			new Notice(getTranslator(plugin.settings.language)('calendar.openTradeNoteError'));
		}
	};
	const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
			return;
		}

		event.preventDefault();
		void openTrade();
	};
	const stopRowClick = (event: MouseEvent<HTMLSpanElement>) => {
		event.stopPropagation();
	};
	const tradeDescription = [trade.side, trade.setup].filter(Boolean).join(' · ') || '—';

	return (
		<div
			className="trader-journal-dashboard-row"
			role="button"
			tabIndex={0}
			onClick={() => void openTrade()}
			onKeyDown={handleRowKeyDown}
		>
			<span className="trader-journal-dashboard-row__primary"><strong>{trade.symbol}</strong><span>{tradeDescription}</span></span>
			<span className="trader-journal-dashboard-row__secondary">
				<span>{formatJournalDate(trade.journalDate, locale)}</span>
				<span className={`trader-journal-dashboard-row__result trader-journal-dashboard-row__result--${trade.resultKey ?? 'open'}`}>
					{trade.status === 'open' ? tr('option.open') : trade.result || '—'}
				</span>
				<span className="trader-journal-dashboard-row__rr">{trade.rr || '—'}</span>
			</span>
			<span className="trader-journal-dashboard-row__actions" onClick={stopRowClick}>
				<DashboardIconButton
					icon="pencil"
					label={tr('dashboard.editTrade')}
					size="compact"
					onClick={() => new TraderJournalModal(plugin.app, plugin, trade.journalType, trade.trade, trade.filePath).open()}
				/>
			</span>
		</div>
	);
}

function formatJournalDate(value: string, locale: string | undefined): string {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatPercent(value: number): string { return `${value.toFixed(1)}%`; }
function formatRr(value: number): string { return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`; }
function getNumberTone(value: number): 'positive' | 'negative' | 'neutral' { return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'; }
