import type { EventRef, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, MarkdownView, Notice, setIcon, TFile } from 'obsidian';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from './TraderJournalModal';
import { CALENDAR_DISPLAY_MODE_CHANGE_EVENT, LANGUAGE_CHANGE_EVENT } from '../settings';
import type { CalendarDisplayMode, TraderJournalLanguage } from '../settings';
import {
	formatTradeCount,
	getJournalTypeLabel,
	getLocale,
	getTranslator,
	getWeekdayLabels,
} from '../i18n';
import {
	JournalCalendarIndex,
	type JournalCalendarDay,
	type JournalCalendarSnapshot,
	type JournalCalendarTrade,
} from '../trades/journalIndex';
import { formatResult, formatSide, stringifyValue } from '../trades/format';
import type { TradeJournalType } from '../trades/types';

export const TRADER_JOURNAL_CALENDAR_VIEW_TYPE = 'trader-journal-calendar';
export const TRADER_JOURNAL_CALENDAR_ICON = 'calendar-clock';

const FILE_UPDATE_DEBOUNCE_MS = 250;

const EMPTY_SNAPSHOT: JournalCalendarSnapshot = {
	daysByDate: {},
	dayDates: [],
	tradeCount: 0,
};

type TradeCalendarFilter = TradeJournalType;

interface TradeCalendarViewProps {
	plugin: TraderJournalPlugin;
}

interface CalendarDateCell {
	date: string;
	dayNumber: number;
	inMonth: boolean;
}

export function registerTraderJournalCalendarView(plugin: TraderJournalPlugin): void {
	plugin.registerView(
		TRADER_JOURNAL_CALENDAR_VIEW_TYPE,
		(leaf) => new TraderJournalCalendarView(leaf, plugin),
	);
}

export async function openTraderJournalCalendar(plugin: TraderJournalPlugin): Promise<void> {
	let leaf = plugin.app.workspace.getLeavesOfType(TRADER_JOURNAL_CALENDAR_VIEW_TYPE)[0];

	if (!leaf) {
		leaf = plugin.app.workspace.getRightLeaf(false) ?? undefined;
	}

	if (!leaf) {
		new Notice(getTranslator(plugin.settings.language)('calendar.openError'));
		return;
	}

	await leaf.setViewState({
		type: TRADER_JOURNAL_CALENDAR_VIEW_TYPE,
		active: true,
	});
	plugin.app.workspace.rightSplit.expand();
	plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
}

export class TraderJournalCalendarView extends ItemView {
	private readonly plugin: TraderJournalPlugin;
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TraderJournalPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
		this.icon = TRADER_JOURNAL_CALENDAR_ICON;
	}

	getViewType(): string {
		return TRADER_JOURNAL_CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return getTranslator(this.plugin.settings.language)('calendar.displayText');
	}

	getIcon(): string {
		return TRADER_JOURNAL_CALENDAR_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('trader-journal-calendar-view');
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TradeCalendarView plugin={this.plugin} />
			</StrictMode>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.removeClass('trader-journal-calendar-view');
		this.contentEl.empty();
	}
}

function TradeCalendarView({ plugin }: TradeCalendarViewProps) {
	const today = useMemo(() => formatDateKey(new Date()), []);
	const [snapshot, setSnapshot] = useState<JournalCalendarSnapshot>(EMPTY_SNAPSHOT);
	const [selectedDate, setSelectedDate] = useState(today);
	const [visibleMonth, setVisibleMonth] = useState(getMonthKey(today));
	const [journalTypeFilter, setJournalTypeFilter] = useState<TradeCalendarFilter>('live');
	const [calendarDisplayMode, setCalendarDisplayMode] = useState<CalendarDisplayMode>(
		plugin.settings.calendarDisplayMode,
	);
	const [language, setLanguage] = useState<TraderJournalLanguage>(plugin.settings.language);
	const [todayScrollRequest, setTodayScrollRequest] = useState(0);
	const [selectedDateScrollRequest, setSelectedDateScrollRequest] = useState(0);
	const [monthStartScrollTarget, setMonthStartScrollTarget] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const initialSelectionAppliedRef = useRef(false);
	const previousFilterRef = useRef<TradeCalendarFilter>(journalTypeFilter);
	const horizontalCalendarRef = useRef<HTMLDivElement>(null);
	const hasCenteredInitialHorizontalTodayRef = useRef(false);
	const tr = getTranslator(language);
	const locale = getLocale(language);
	const weekdayLabels = getWeekdayLabels(language);

	useEffect(() => {
		const index = new JournalCalendarIndex(plugin);
		const fileUpdateTimers = new Map<string, number>();
		let disposed = false;

		const applySnapshot = (nextSnapshot: JournalCalendarSnapshot) => {
			if (!disposed) {
				setSnapshot(nextSnapshot);
			}
		};

		const rebuild = async () => {
			try {
				setIsLoading(true);
				applySnapshot(await index.rebuild());
			} finally {
				if (!disposed) {
					setIsLoading(false);
				}
			}
		};

		const updateFile = async (file: TFile) => {
			applySnapshot(await index.updateFile(file));
		};

		const scheduleFileUpdate = (file: TFile) => {
			const existingTimer = fileUpdateTimers.get(file.path);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
			}

			const timer = window.setTimeout(() => {
				fileUpdateTimers.delete(file.path);
				void updateFile(file).catch((error: unknown) => {
					console.error('Trader Journal failed to update calendar index', error);
				});
			}, FILE_UPDATE_DEBOUNCE_MS);

			fileUpdateTimers.set(file.path, timer);
		};

		const eventRefs: EventRef[] = [
			plugin.app.vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile) {
					scheduleFileUpdate(file);
				}
			}),
			plugin.app.vault.on('modify', (file: TAbstractFile) => {
				if (file instanceof TFile) {
					scheduleFileUpdate(file);
				}
			}),
			plugin.app.vault.on('delete', (file: TAbstractFile) => {
				applySnapshot(index.removePath(file.path));
			}),
			plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				applySnapshot(index.removePath(oldPath));
				if (file instanceof TFile) {
					scheduleFileUpdate(file);
				}
			}),
		];

		void rebuild().catch((error: unknown) => {
			console.error('Trader Journal failed to build calendar index', error);
			if (!disposed) {
				setIsLoading(false);
			}
		});

		return () => {
			disposed = true;
			for (const timer of fileUpdateTimers.values()) {
				window.clearTimeout(timer);
			}
			fileUpdateTimers.clear();
			for (const eventRef of eventRefs) {
				plugin.app.vault.offref(eventRef);
			}
		};
	}, [plugin]);

	useEffect(() => {
		const handleCalendarDisplayModeChange = (event: Event) => {
			const nextMode = (event as CustomEvent<CalendarDisplayMode>).detail;
			if (nextMode === 'month' || nextMode === 'horizontal_calendar') {
				setCalendarDisplayMode(nextMode);
			}
		};

		window.addEventListener(CALENDAR_DISPLAY_MODE_CHANGE_EVENT, handleCalendarDisplayModeChange);

		return () => {
			window.removeEventListener(CALENDAR_DISPLAY_MODE_CHANGE_EVENT, handleCalendarDisplayModeChange);
		};
	}, []);

	useEffect(() => {
		const handleLanguageChange = (event: Event) => {
			const nextLanguage = (event as CustomEvent<TraderJournalLanguage>).detail;
			if (nextLanguage === 'en' || nextLanguage === 'vi') {
				setLanguage(nextLanguage);
			}
		};

		window.addEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);

		return () => {
			window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
		};
	}, []);

	const filteredSnapshot = useMemo(
		() => filterSnapshotByJournalType(snapshot, journalTypeFilter),
		[snapshot, journalTypeFilter],
	);

	useEffect(() => {
		if (isLoading) {
			return;
		}

		const filterChanged = previousFilterRef.current !== journalTypeFilter;
		previousFilterRef.current = journalTypeFilter;

		if (!filterChanged && initialSelectionAppliedRef.current) {
			return;
		}

		initialSelectionAppliedRef.current = true;
		if (filteredSnapshot.daysByDate[selectedDate]) {
			return;
		}

		const latestDate = filteredSnapshot.dayDates[filteredSnapshot.dayDates.length - 1];
		if (latestDate) {
			setSelectedDate(latestDate);
			setVisibleMonth(getMonthKey(latestDate));
		}
	}, [filteredSnapshot, isLoading, journalTypeFilter, selectedDate]);

	const calendarDates = useMemo(() => getCalendarDates(visibleMonth), [visibleMonth]);
	const horizontalCalendarDates = useMemo(() => getMonthDates(visibleMonth), [visibleMonth]);
	const selectedDay = filteredSnapshot.daysByDate[selectedDate] ?? createEmptyDay(selectedDate);

	useEffect(() => {
		if (calendarDisplayMode !== 'horizontal_calendar') {
			return;
		}

		const calendarEl = horizontalCalendarRef.current;
		if (!calendarEl) {
			return;
		}

		if (getMonthKey(today) !== visibleMonth) {
			return;
		}

		if (todayScrollRequest === 0 && hasCenteredInitialHorizontalTodayRef.current) {
			return;
		}

		const targetEl = calendarEl.querySelector<HTMLElement>(`[data-date="${today}"]`);
		if (!targetEl) {
			return;
		}

		const timer = window.setTimeout(() => {
			hasCenteredInitialHorizontalTodayRef.current = true;
			targetEl.scrollIntoView({
				behavior: 'auto',
				block: 'nearest',
				inline: 'center',
			});
		}, 0);

		return () => window.clearTimeout(timer);
	}, [calendarDisplayMode, horizontalCalendarDates, today, todayScrollRequest, visibleMonth]);

	useEffect(() => {
		if (calendarDisplayMode !== 'horizontal_calendar' || selectedDateScrollRequest === 0) {
			return;
		}

		const calendarEl = horizontalCalendarRef.current;
		if (!calendarEl) {
			return;
		}

		const targetEl = calendarEl.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
		if (!targetEl) {
			return;
		}

		const timer = window.setTimeout(() => {
			targetEl.scrollIntoView({
				behavior: 'auto',
				block: 'nearest',
				inline: 'center',
			});
		}, 0);

		return () => window.clearTimeout(timer);
	}, [calendarDisplayMode, horizontalCalendarDates, selectedDate, selectedDateScrollRequest]);

	useEffect(() => {
		if (calendarDisplayMode !== 'horizontal_calendar' || monthStartScrollTarget !== visibleMonth) {
			return;
		}

		const calendarEl = horizontalCalendarRef.current;
		if (!calendarEl) {
			return;
		}

		const targetEl = calendarEl.querySelector<HTMLElement>(`[data-date="${visibleMonth}-01"]`);
		if (!targetEl) {
			return;
		}

		const timer = window.setTimeout(() => {
			targetEl.scrollIntoView({
				behavior: 'auto',
				block: 'nearest',
				inline: 'start',
			});
		}, 0);

		return () => window.clearTimeout(timer);
	}, [calendarDisplayMode, horizontalCalendarDates, monthStartScrollTarget, visibleMonth]);

	const selectDate = (date: string) => {
		setMonthStartScrollTarget(null);
		setSelectedDate(date);
		setVisibleMonth(getMonthKey(date));
		setSelectedDateScrollRequest((currentRequest) => currentRequest + 1);
	};

	const goToToday = () => {
		setMonthStartScrollTarget(null);
		setSelectedDate(today);
		setVisibleMonth(getMonthKey(today));
		setTodayScrollRequest((currentRequest) => currentRequest + 1);
	};

	const goToAdjacentMonth = (offset: number) => {
		const nextMonth = addMonths(visibleMonth, offset);
		setVisibleMonth(nextMonth);
		setMonthStartScrollTarget(nextMonth);
	};

	const openCreateTradeModal = () => {
		new TraderJournalModal(plugin.app, plugin, journalTypeFilter).open();
	};

	return (
		<div className="trader-journal-calendar">
			<header className="trader-journal-calendar__header">
				<button
					type="button"
					className="trader-journal-calendar__nav-button"
					aria-label={tr('calendar.previousMonth')}
					onClick={() => goToAdjacentMonth(-1)}
				>
					‹
				</button>
				<div className="trader-journal-calendar__month">{formatMonthLabel(visibleMonth, locale)}</div>
				<button
					type="button"
					className="trader-journal-calendar__nav-button"
					aria-label={tr('calendar.nextMonth')}
					onClick={() => goToAdjacentMonth(1)}
				>
					›
				</button>
				<button type="button" className="trader-journal-calendar__today-button" onClick={goToToday}>
					{tr('calendar.today')}
				</button>
			</header>

			{calendarDisplayMode === 'horizontal_calendar' ? (
				<div
					className="trader-journal-horizontal-calendar"
					aria-label={tr('calendar.horizontalAria')}
					ref={horizontalCalendarRef}
				>
					{horizontalCalendarDates.map((calendarDate) => (
						<HorizontalCalendarDateButton
							calendarDate={calendarDate}
							day={snapshot.daysByDate[calendarDate.date]}
							isSelected={calendarDate.date === selectedDate}
							isToday={calendarDate.date === today}
							key={calendarDate.date}
							language={language}
							onSelect={selectDate}
						/>
					))}
				</div>
			) : (
				<>
					<div className="trader-journal-calendar__weekday-row">
						{weekdayLabels.map((weekday) => (
							<div className="trader-journal-calendar__weekday" key={weekday}>
								{weekday}
							</div>
						))}
					</div>

					<div className="trader-journal-calendar__grid">
						{calendarDates.map((calendarDate) => (
							<CalendarDateButton
								calendarDate={calendarDate}
								day={snapshot.daysByDate[calendarDate.date]}
								isSelected={calendarDate.date === selectedDate}
								isToday={calendarDate.date === today}
								key={calendarDate.date}
								language={language}
								onSelect={selectDate}
							/>
						))}
					</div>
				</>
			)}

			<section className="trader-journal-calendar__day-panel">
				<div className="trader-journal-calendar__day-header">
					<div className="trader-journal-calendar__day-count">
						{formatTradeCount(language, selectedDay.trades.length)}
					</div>
					<div className="trader-journal-calendar__actions">
						<CalendarIconButton
							icon="plus"
							label={tr('calendar.addTrade', {
								type: getJournalTypeLabel(language, journalTypeFilter).toLowerCase(),
							})}
							onClick={openCreateTradeModal}
						/>
						<select
							className="trader-journal-calendar__filter"
							value={journalTypeFilter}
							aria-label={tr('calendar.filterTradeType')}
							onChange={(event) => setJournalTypeFilter(event.target.value as TradeCalendarFilter)}
						>
							<option value="live">{tr('option.live')}</option>
							<option value="backtest">{tr('option.backtest')}</option>
						</select>
					</div>
				</div>

				{isLoading ? (
					<div className="trader-journal-calendar__empty">{tr('calendar.loadingTrades')}</div>
				) : selectedDay.trades.length > 0 ? (
					<div className="trader-journal-calendar__trade-list">
						{selectedDay.trades.map((trade) => (
							<TradeCalendarCard
								language={language}
								plugin={plugin}
								trade={trade}
								key={`${trade.filePath}-${trade.id}`}
							/>
						))}
					</div>
				) : (
					<div className="trader-journal-calendar__empty">{tr('calendar.noTrades')}</div>
				)}
			</section>
		</div>
	);
}

function CalendarIconButton({
	icon,
	label,
	onClick,
	stopPropagation = false,
	variant = 'default',
}: {
	icon: string;
	label: string;
	onClick: () => void;
	stopPropagation?: boolean;
	variant?: 'default' | 'plain';
}) {
	const iconElRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!iconElRef.current) {
			return;
		}

		iconElRef.current.replaceChildren();
		setIcon(iconElRef.current, icon);
	}, [icon]);

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		if (stopPropagation) {
			event.stopPropagation();
		}

		onClick();
	};

	return (
		<button
			type="button"
			className={[
				'trader-journal-calendar__icon-button',
				variant === 'plain' ? 'trader-journal-calendar__icon-button--plain' : '',
			]
				.filter(Boolean)
				.join(' ')}
			aria-label={label}
			title={label}
			onClick={handleClick}
		>
			<span ref={iconElRef} aria-hidden="true" />
		</button>
	);
}

function CalendarDateButton({
	calendarDate,
	day,
	isSelected,
	isToday,
	language,
	onSelect,
}: {
	calendarDate: CalendarDateCell;
	day: JournalCalendarDay | undefined;
	isSelected: boolean;
	isToday: boolean;
	language: TraderJournalLanguage;
	onSelect: (date: string) => void;
}) {
	const tr = getTranslator(language);
	const labelParts = [calendarDate.date];
	if (day?.backtestCount) {
		labelParts.push(`${day.backtestCount} ${tr('option.backtest').toLowerCase()}`);
	}
	if (day?.liveCount) {
		labelParts.push(`${day.liveCount} ${tr('option.live').toLowerCase()}`);
	}

	return (
		<button
			type="button"
			className={[
				'trader-journal-calendar-day',
				calendarDate.inMonth ? '' : 'trader-journal-calendar-day--muted',
				isSelected ? 'trader-journal-calendar-day--selected' : '',
				isToday ? 'trader-journal-calendar-day--today' : '',
			]
				.filter(Boolean)
				.join(' ')}
			aria-label={labelParts.join(', ')}
			data-date={calendarDate.date}
			onClick={() => onSelect(calendarDate.date)}
		>
			<CalendarDotSummary day={day} />
			<span className="trader-journal-calendar-day__number">{calendarDate.dayNumber}</span>
		</button>
	);
}

function HorizontalCalendarDateButton({
	calendarDate,
	day,
	isSelected,
	isToday,
	language,
	onSelect,
}: {
	calendarDate: CalendarDateCell;
	day: JournalCalendarDay | undefined;
	isSelected: boolean;
	isToday: boolean;
	language: TraderJournalLanguage;
	onSelect: (date: string) => void;
}) {
	const tr = getTranslator(language);
	const locale = getLocale(language);
	const date = parseDateKey(calendarDate.date);
	const weekdayLabel = date
		? date.toLocaleDateString(locale, { weekday: 'short' })
		: calendarDate.date.slice(5);
	const labelParts = [calendarDate.date];
	if (day?.backtestCount) {
		labelParts.push(`${day.backtestCount} ${tr('option.backtest').toLowerCase()}`);
	}
	if (day?.liveCount) {
		labelParts.push(`${day.liveCount} ${tr('option.live').toLowerCase()}`);
	}

	return (
		<button
			type="button"
			className={[
				'trader-journal-horizontal-calendar-day',
				isSelected ? 'trader-journal-horizontal-calendar-day--selected' : '',
				isToday ? 'trader-journal-horizontal-calendar-day--today' : '',
			]
				.filter(Boolean)
				.join(' ')}
			aria-label={labelParts.join(', ')}
			data-date={calendarDate.date}
			onClick={() => onSelect(calendarDate.date)}
		>
			<CalendarDotSummary day={day} />
			<span className="trader-journal-horizontal-calendar-day__weekday">{weekdayLabel}</span>
			<span className="trader-journal-horizontal-calendar-day__number">{calendarDate.dayNumber}</span>
		</button>
	);
}

function CalendarDotSummary({ day }: { day: JournalCalendarDay | undefined }) {
	return (
		<div className="trader-journal-calendar-dots" aria-hidden="true">
			{day?.backtestCount ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--backtest" />
			) : null}
			{day?.liveCount ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--live" />
			) : null}
		</div>
	);
}

function TradeCalendarCard({
	language,
	plugin,
	trade,
}: {
	language: TraderJournalLanguage;
	plugin: TraderJournalPlugin;
	trade: JournalCalendarTrade;
}) {
	const tr = getTranslator(language);
	const side = formatSide(trade.trade.side, language);
	const result = formatResult(trade.trade.result, language);
	const openTradeFile = async () => {
		try {
			await plugin.app.workspace.openLinkText(trade.filePath, '', false);
			scrollActiveMarkdownViewToTrade(plugin, trade);
		} catch (error) {
			console.error('Trader Journal failed to open trade note', error);
			new Notice(tr('calendar.openTradeNoteError'));
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		void openTradeFile();
	};

	const openEditModal = () => {
		new TraderJournalModal(plugin.app, plugin, 'live', trade.trade, trade.filePath).open();
	};

	return (
		<div
			className={[
				'trader-journal-calendar-card',
				trade.sideKey ? `trader-journal-calendar-card--${trade.sideKey}` : '',
			].join(' ')}
			role="button"
			tabIndex={0}
			onClick={() => void openTradeFile()}
			onKeyDown={handleKeyDown}
		>
			<div className="trader-journal-calendar-card__head">
				<strong className="trader-journal-calendar-card__symbol">{trade.symbol}</strong>
				<div className="trader-journal-calendar-card__head-meta">
					{trade.journalType === 'live' ? (
						<CalendarIconButton
							icon="pencil"
							label={tr('modal.editLiveTrade')}
							onClick={openEditModal}
							stopPropagation
							variant="plain"
						/>
					) : null}
					{trade.status ? (
						<span
							className={[
								'trader-journal-calendar-card__status',
								`trader-journal-calendar-card__status--${trade.status}`,
							].join(' ')}
						>
							{trade.status === 'open' ? tr('option.open') : tr('option.closed')}
						</span>
					) : null}
					<span className="trader-journal-calendar-card__time">{formatTradeTime(trade.createdAt)}</span>
				</div>
			</div>
			<div className="trader-journal-calendar-card__body">
				<span className="trader-journal-calendar-card__meta">
					{[side, trade.setup, trade.timeframe].filter(Boolean).join(' · ') || trade.file.basename}
				</span>
				<span
					className={[
						'trader-journal-calendar-card__result',
						trade.resultKey ? `trader-journal-calendar-card__result--${trade.resultKey}` : '',
					].join(' ')}
				>
					{[result, trade.rr].filter(Boolean).join(' / ') || '-'}
				</span>
			</div>
			{trade.notes ? <div className="trader-journal-calendar-card__notes">{trade.notes}</div> : null}
		</div>
	);
}

function scrollActiveMarkdownViewToTrade(plugin: TraderJournalPlugin, trade: JournalCalendarTrade): void {
	if (trade.headingLine === null) {
		return;
	}

	window.setTimeout(() => {
		const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || markdownView.file?.path !== trade.filePath) {
			return;
		}

		const position = { line: trade.headingLine ?? 0, ch: 0 };
		markdownView.editor.setCursor(position);
		markdownView.editor.scrollIntoView({ from: position, to: position }, true);
	}, 50);
}

function getCalendarDates(monthKey: string): CalendarDateCell[] {
	const { year, month } = parseMonthKey(monthKey);
	const monthStart = new Date(year, month, 1);
	const startOffset = (monthStart.getDay() + 6) % 7;
	const startDate = new Date(year, month, 1 - startOffset);
	const dates: CalendarDateCell[] = [];

	for (let index = 0; index < 42; index += 1) {
		const date = new Date(startDate);
		date.setDate(startDate.getDate() + index);
		dates.push({
			date: formatDateKey(date),
			dayNumber: date.getDate(),
			inMonth: date.getMonth() === month,
		});
	}

	return dates;
}

function getMonthDates(monthKey: string): CalendarDateCell[] {
	const { year, month } = parseMonthKey(monthKey);
	const monthStart = new Date(year, month, 1);
	const nextMonthStart = new Date(year, month + 1, 1);
	const dates: CalendarDateCell[] = [];

	for (let date = new Date(monthStart); date < nextMonthStart; date.setDate(date.getDate() + 1)) {
		dates.push({
			date: formatDateKey(date),
			dayNumber: date.getDate(),
			inMonth: true,
		});
	}

	return dates;
}

function createEmptyDay(date: string): JournalCalendarDay {
	return {
		date,
		backtestCount: 0,
		liveCount: 0,
		trades: [],
	};
}

function filterSnapshotByJournalType(
	snapshot: JournalCalendarSnapshot,
	journalType: TradeCalendarFilter,
): JournalCalendarSnapshot {
	const daysByDate: Record<string, JournalCalendarDay> = {};

	for (const day of Object.values(snapshot.daysByDate)) {
		const trades = day.trades.filter((trade) => trade.journalType === journalType);
		if (trades.length === 0) {
			continue;
		}

		daysByDate[day.date] = {
			date: day.date,
			backtestCount: journalType === 'backtest' ? trades.length : 0,
			liveCount: journalType === 'live' ? trades.length : 0,
			trades,
		};
	}

	const dayDates = Object.keys(daysByDate).sort();
	const tradeCount = Object.values(daysByDate).reduce((total, day) => total + day.trades.length, 0);

	return {
		daysByDate,
		dayDates,
		tradeCount,
	};
}

function addMonths(monthKey: string, offset: number): string {
	const { year, month } = parseMonthKey(monthKey);
	const date = new Date(year, month + offset, 1);
	return getMonthKey(formatDateKey(date));
}

function getMonthKey(dateKey: string): string {
	return dateKey.slice(0, 7);
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
	const [yearPart, monthPart] = monthKey.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);

	return {
		year: Number.isFinite(year) ? year : new Date().getFullYear(),
		month: Number.isFinite(month) ? month - 1 : new Date().getMonth(),
	};
}

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function parseDateKey(dateKey: string): Date | null {
	const [yearPart, monthPart, dayPart] = dateKey.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);

	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}

	return new Date(year, month - 1, day);
}

function formatMonthLabel(monthKey: string, locale: string | undefined): string {
	const { year, month } = parseMonthKey(monthKey);
	const monthLabel = new Date(year, month, 1).toLocaleString(locale, {
		month: 'long',
		year: 'numeric',
	});
	return capitalizeFirstLetter(monthLabel);
}

function capitalizeFirstLetter(value: string): string {
	const firstLetter = value.slice(0, 1);
	return firstLetter ? `${firstLetter.toLocaleUpperCase()}${value.slice(1)}` : value;
}

function formatTradeTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return stringifyValue(value);
	}

	return date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
}

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}
