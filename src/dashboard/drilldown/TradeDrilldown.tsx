import type { Events } from 'obsidian';
import { Notice } from 'obsidian';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type TraderJournalPlugin from '../../main';
import { getLocale, getTranslator, type I18nKey } from '../../i18n';
import { LANGUAGE_CHANGE_EVENT, type TraderJournalLanguage } from '../../settings';
import type { JournalCalendarTrade } from '../../trades/journalIndex';
import { openJournalTrade } from '../../trades/openTrade';
import { TradeReviewModal } from '../../ui/TradeReviewModal';
import { TraderJournalModal } from '../../ui/TraderJournalModal';
import { DashboardIconButton } from '../DashboardIconButton';
import {
	countTradeDrilldownFiles,
	filterTradeDrilldownTrades,
	getTradeDrilldownTrades,
} from './tradeDrilldownQuery';
import type { TradeDrilldownQuery, TradeDrilldownSort } from './types';

interface TradeDrilldownProps {
	plugin: TraderJournalPlugin;
	query: TradeDrilldownQuery;
}

export function TradeDrilldown({ plugin, query }: TradeDrilldownProps) {
	const [journalData, setJournalData] = useState(plugin.journalDataService.getSnapshot());
	const [language, setLanguage] = useState<TraderJournalLanguage>(plugin.settings.language);
	const [search, setSearch] = useState('');
	const [sort, setSort] = useState<TradeDrilldownSort>('newest');
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
	useEffect(() => setSearch(''), [query]);

	const matchingTrades = useMemo(
		() => getTradeDrilldownTrades(journalData.trades, query),
		[journalData.trades, query],
	);
	const visibleTrades = useMemo(
		() => filterTradeDrilldownTrades(matchingTrades, search, sort),
		[matchingTrades, search, sort],
	);
	const fileCount = useMemo(() => countTradeDrilldownFiles(matchingTrades), [matchingTrades]);
	const title = tr('drilldown.title', { category: getCriterionLabel(query, language) });

	return (
		<div className="trader-journal-drilldown">
			<header className="trader-journal-drilldown__header">
				<div>
					<h2>{title}</h2>
					<p>{tr('drilldown.summary', { count: matchingTrades.length, files: fileCount })}</p>
				</div>
				<div className="trader-journal-drilldown__context" aria-label={tr('drilldown.appliedFilters')}>
					<span>{tr(getPeriodKey(query.filters.period))}</span>
					<span>{query.filters.symbol || tr('dashboard.allSymbols')}</span>
				</div>
			</header>

			<div className="trader-journal-drilldown__toolbar">
				<label className="trader-journal-drilldown__search">
					<span>{tr('dashboard.searchTrades')}</span>
					<input
						type="search"
						value={search}
						placeholder={tr('drilldown.searchPlaceholder')}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</label>
				<label>
					<span>{tr('drilldown.sort')}</span>
					<select value={sort} onChange={(event) => setSort(event.target.value as TradeDrilldownSort)}>
						<option value="newest">{tr('drilldown.sortNewest')}</option>
						<option value="oldest">{tr('drilldown.sortOldest')}</option>
						<option value="rr-high">{tr('drilldown.sortRrHigh')}</option>
						<option value="rr-low">{tr('drilldown.sortRrLow')}</option>
					</select>
				</label>
			</div>

			{search ? (
				<p className="trader-journal-drilldown__filtered-count">
					{tr('dashboard.filteredTradeCount', { count: visibleTrades.length, total: matchingTrades.length })}
				</p>
			) : null}

			{journalData.isLoading ? <p className="trader-journal-drilldown__empty">{tr('calendar.loadingTrades')}</p> : null}
			{!journalData.isLoading && visibleTrades.length ? (
				<div className="trader-journal-drilldown__list">
					{visibleTrades.map((trade) => (
						<TradeDrilldownRow
							key={`${trade.filePath}:${trade.id}`}
							language={language}
							locale={locale}
							plugin={plugin}
							trade={trade}
						/>
					))}
				</div>
			) : null}
			{!journalData.isLoading && !visibleTrades.length ? (
				<p className="trader-journal-drilldown__empty">{tr('drilldown.noResults')}</p>
			) : null}
		</div>
	);
}

function TradeDrilldownRow({
	language,
	locale,
	plugin,
	trade,
}: {
	language: TraderJournalLanguage;
	locale: string | undefined;
	plugin: TraderJournalPlugin;
	trade: JournalCalendarTrade;
}) {
	const tr = getTranslator(language);
	const openTrade = async () => {
		try {
			await openJournalTrade(plugin, trade);
		} catch (error) {
			console.error('Trader Journal failed to open trade from drill-down', error);
			new Notice(tr('calendar.openTradeNoteError'));
		}
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			void openTrade();
		}
	};
	const stopRowClick = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

	return (
		<div
			className="trader-journal-drilldown-row"
			role="button"
			tabIndex={0}
			onClick={() => void openTrade()}
			onKeyDown={handleKeyDown}
		>
			<div className="trader-journal-drilldown-row__main">
				<div className="trader-journal-drilldown-row__title">
					<strong>{trade.symbol}</strong>
					<span>{formatDate(trade.journalDate, locale)}</span>
				</div>
				<div className="trader-journal-drilldown-row__details">
					<span>{[trade.side, trade.setup, trade.timeframe].filter(Boolean).join(' · ') || '—'}</span>
					<span title={trade.filePath}>{trade.file.basename}</span>
				</div>
			</div>
			<div className="trader-journal-drilldown-row__metrics">
				<span className={`is-${trade.resultKey ?? 'neutral'}`}>{trade.result || '—'}</span>
				<strong>{trade.rr || '—'}</strong>
				<span className={trade.reviewed ? 'is-reviewed' : 'is-unreviewed'}>
					{tr(trade.reviewed ? 'dashboard.reviewedTrades' : 'dashboard.unreviewed')}
				</span>
			</div>
			<div className="trader-journal-drilldown-row__actions" onClick={stopRowClick}>
				<DashboardIconButton
					icon="pencil"
					label={tr('dashboard.editTrade')}
					size="compact"
					onClick={() => new TraderJournalModal(plugin.app, plugin, trade.journalType, trade.trade, trade.filePath).open()}
				/>
				<DashboardIconButton
					icon={trade.reviewed ? 'clipboard-check' : 'clipboard-pen'}
					label={tr('action.reviewTrade')}
					size="compact"
					onClick={() => new TradeReviewModal(plugin.app, plugin, trade.trade, trade.filePath).open()}
				/>
			</div>
		</div>
	);
}

function getCriterionLabel(query: TradeDrilldownQuery, language: TraderJournalLanguage): string {
	const tr = getTranslator(language);
	if (query.criterion.kind === 'review-status') {
		const keys = {
			reviewed: 'dashboard.reviewedTrades',
			unreviewed: 'dashboard.unreviewedTrades',
			'all-closed': 'dashboard.reviewCompletionRate',
		} as const;
		return tr(keys[query.criterion.value]);
	}
	if (query.criterion.kind === 'mistake') {
		return tr(`review.mistake.${query.criterion.value}`);
	}
	return tr(`review.planAdherence.${query.criterion.value}`);
}

function getPeriodKey(period: TradeDrilldownQuery['filters']['period']): I18nKey {
	return ({
		'7d': 'dashboard.last7Days',
		'30d': 'dashboard.last30Days',
		month: 'dashboard.currentMonth',
		all: 'dashboard.viewAllTime',
	} as const)[period];
}

function formatDate(value: string, locale: string | undefined): string {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime())
		? value
		: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
