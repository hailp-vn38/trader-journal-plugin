import type { EventRef, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, MarkdownView, Notice, setIcon, TFile } from 'obsidian';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { TradePlanModal } from './TradePlanModal';
import { TraderJournalModal } from './TraderJournalModal';
import {
	CALENDAR_DISPLAY_MODE_CHANGE_EVENT,
	ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT,
	LANGUAGE_CHANGE_EVENT,
} from '../settings';
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
import {
	JournalPlanIndex,
	type JournalCalendarPlan,
	type JournalCalendarPlanDay,
	type JournalPlanSnapshot,
} from '../plans/planIndex';
import { formatResult, formatSide, stringifyValue } from '../trades/format';
import type { TradeJournalType } from '../trades/types';
import {
	filterEconomicCalendarEvents,
	formatEconomicEventTime,
	groupEconomicEventsByDate,
} from '../economicCalendar/calendar';
import type { EconomicCalendarEvent, EconomicImpact } from '../economicCalendar/types';

export const TRADER_JOURNAL_CALENDAR_VIEW_TYPE = 'trader-journal-calendar';
export const TRADER_JOURNAL_CALENDAR_ICON = 'calendar-clock';

const FILE_UPDATE_DEBOUNCE_MS = 250;

const EMPTY_SNAPSHOT: JournalCalendarSnapshot = {
	daysByDate: {},
	dayDates: [],
	tradeCount: 0,
};

const EMPTY_PLAN_SNAPSHOT: JournalPlanSnapshot = {
	daysByDate: {},
	dayDates: [],
	planCount: 0,
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
	const [today, setToday] = useState(() => formatDateKey(new Date()));
	const [snapshot, setSnapshot] = useState<JournalCalendarSnapshot>(EMPTY_SNAPSHOT);
	const [planSnapshot, setPlanSnapshot] = useState<JournalPlanSnapshot>(EMPTY_PLAN_SNAPSHOT);
	const [selectedDate, setSelectedDate] = useState(today);
	const [visibleMonth, setVisibleMonth] = useState(getMonthKey(today));
	const [journalTypeFilter, setJournalTypeFilter] = useState<TradeCalendarFilter>('live');
	const [calendarDisplayMode, setCalendarDisplayMode] = useState<CalendarDisplayMode>(
		plugin.settings.calendarDisplayMode,
	);
	const [language, setLanguage] = useState<TraderJournalLanguage>(plugin.settings.language);
	const [economicEvents, setEconomicEvents] = useState<EconomicCalendarEvent[]>([]);
	const [isEconomicCalendarLoading, setIsEconomicCalendarLoading] = useState(false);
	const [economicCalendarError, setEconomicCalendarError] = useState(false);
	const [economicSettingsVersion, setEconomicSettingsVersion] = useState(0);
	const [isEconomicCalendarExpanded, setIsEconomicCalendarExpanded] = useState(false);
	const [economicCalendarNow, setEconomicCalendarNow] = useState(() => Date.now());
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
		const tradeIndex = new JournalCalendarIndex(plugin);
		const planIndex = new JournalPlanIndex(plugin);
		const fileUpdateTimers = new Map<string, number>();
		let disposed = false;

		const applyTradeSnapshot = (nextSnapshot: JournalCalendarSnapshot) => {
			if (!disposed) {
				setSnapshot(nextSnapshot);
			}
		};

		const applyPlanSnapshot = (nextSnapshot: JournalPlanSnapshot) => {
			if (!disposed) {
				setPlanSnapshot(nextSnapshot);
			}
		};

		const rebuild = async () => {
			try {
				setIsLoading(true);
				const [nextTradeSnapshot, nextPlanSnapshot] = await Promise.all([
					tradeIndex.rebuild(),
					planIndex.rebuild(),
				]);
				applyTradeSnapshot(nextTradeSnapshot);
				applyPlanSnapshot(nextPlanSnapshot);
			} finally {
				if (!disposed) {
					setIsLoading(false);
				}
			}
		};

		const updateFile = async (file: TFile) => {
			const [nextTradeSnapshot, nextPlanSnapshot] = await Promise.all([
				tradeIndex.updateFile(file),
				planIndex.updateFile(file),
			]);
			applyTradeSnapshot(nextTradeSnapshot);
			applyPlanSnapshot(nextPlanSnapshot);
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
				applyTradeSnapshot(tradeIndex.removePath(file.path));
				applyPlanSnapshot(planIndex.removePath(file.path));
			}),
			plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				applyTradeSnapshot(tradeIndex.removePath(oldPath));
				applyPlanSnapshot(planIndex.removePath(oldPath));
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
		let timer: number | null = null;

		const scheduleTodayRefresh = () => {
			timer = window.setTimeout(() => {
				setToday(formatDateKey(new Date()));
				scheduleTodayRefresh();
			}, getNextLocalMidnightDelay());
		};

		scheduleTodayRefresh();

		return () => {
			if (timer !== null) {
				window.clearTimeout(timer);
			}
		};
	}, []);

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

	useEffect(() => {
		const handleEconomicCalendarSettingsChange = () => {
			setEconomicSettingsVersion((version) => version + 1);
		};

		window.addEventListener(
			ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT,
			handleEconomicCalendarSettingsChange,
		);

		return () => {
			window.removeEventListener(
				ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT,
				handleEconomicCalendarSettingsChange,
			);
		};
	}, []);

	useEffect(() => {
		let disposed = false;
		if (!plugin.settings.economicCalendarEnabled) {
			setEconomicEvents([]);
			setEconomicCalendarError(false);
			setIsEconomicCalendarLoading(false);
			return;
		}

		setIsEconomicCalendarLoading(true);
		setEconomicCalendarError(false);
		void plugin.economicCalendarService
			.loadThisWeek()
			.then((economicSnapshot) => {
				if (!disposed) {
					setEconomicEvents(economicSnapshot.events);
				}
			})
			.catch((error: unknown) => {
				console.error('Trader Journal failed to load economic calendar', error);
				if (!disposed) {
					setEconomicEvents([]);
					setEconomicCalendarError(true);
				}
			})
			.finally(() => {
				if (!disposed) {
					setIsEconomicCalendarLoading(false);
				}
			});

		return () => {
			disposed = true;
		};
	}, [economicSettingsVersion, plugin]);

	const filteredSnapshot = useMemo(
		() => filterSnapshotByJournalType(snapshot, journalTypeFilter),
		[snapshot, journalTypeFilter],
	);
	const plansById = useMemo(() => createPlansById(planSnapshot), [planSnapshot]);
	const economicEventsByDate = useMemo(() => {
		if (journalTypeFilter !== 'live' || !plugin.settings.economicCalendarEnabled) {
			return {};
		}

		const filteredEvents = filterEconomicCalendarEvents(
			economicEvents,
			plugin.settings.economicCalendarCountries,
			plugin.settings.economicCalendarImpacts,
			economicCalendarNow,
			plugin.settings.economicCalendarShowAll,
		);
		return groupEconomicEventsByDate(filteredEvents, plugin.settings.economicCalendarTimeZone);
	}, [economicCalendarNow, economicEvents, economicSettingsVersion, journalTypeFilter, plugin]);

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
		const targetDate = getAutoSelectedDate(journalTypeFilter, filteredSnapshot, planSnapshot, today);
		if (targetDate && targetDate !== selectedDate) {
			setSelectedDate(targetDate);
			setVisibleMonth(getMonthKey(targetDate));
		}
	}, [filteredSnapshot, isLoading, journalTypeFilter, planSnapshot, selectedDate, today]);

	const calendarDates = useMemo(() => getCalendarDates(visibleMonth), [visibleMonth]);
	const horizontalCalendarDates = useMemo(() => getMonthDates(visibleMonth), [visibleMonth]);
	const selectedDay = filteredSnapshot.daysByDate[selectedDate] ?? createEmptyDay(selectedDate);
	const selectedPlanDay =
		journalTypeFilter === 'live'
			? planSnapshot.daysByDate[selectedDate] ?? createEmptyPlanDay(selectedDate)
			: createEmptyPlanDay(selectedDate);
	const selectedEconomicEvents = economicEventsByDate[selectedDate] ?? [];

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
		const nextToday = formatDateKey(new Date());
		setEconomicCalendarNow(Date.now());
		setMonthStartScrollTarget(null);
		setToday(nextToday);
		setSelectedDate(nextToday);
		setVisibleMonth(getMonthKey(nextToday));
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

	const openCreatePlanModal = () => {
		new TradePlanModal(plugin.app, plugin).open();
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
							economicNewsCount={economicEventsByDate[calendarDate.date]?.length ?? 0}
							planDay={planSnapshot.daysByDate[calendarDate.date]}
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
								economicNewsCount={economicEventsByDate[calendarDate.date]?.length ?? 0}
								planDay={planSnapshot.daysByDate[calendarDate.date]}
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
						{journalTypeFilter === 'live' ? (
							<CalendarIconButton
								icon="clipboard-list"
								label={tr('calendar.addPlan')}
								onClick={openCreatePlanModal}
							/>
						) : null}
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
				) : (
					<>
						{journalTypeFilter === 'live' && plugin.settings.economicCalendarEnabled ? (
							<section className="trader-journal-calendar__section">
								<button
									type="button"
									className="trader-journal-calendar__collapsible-title"
									aria-expanded={isEconomicCalendarExpanded}
									aria-label={
										isEconomicCalendarExpanded
											? tr('calendar.collapseEconomicNews')
											: tr('calendar.expandEconomicNews')
									}
									onClick={() => setIsEconomicCalendarExpanded((expanded) => !expanded)}
								>
									<span className="trader-journal-calendar__section-title">
										{tr('calendar.economicNews')}
									</span>
									<span aria-hidden="true">{isEconomicCalendarExpanded ? '⌄' : '›'}</span>
								</button>
								{!isEconomicCalendarExpanded ? null : isEconomicCalendarLoading ? (
									<div className="trader-journal-calendar__empty">
										{tr('calendar.loadingEconomicNews')}
									</div>
								) : economicCalendarError ? (
									<div className="trader-journal-calendar__empty">
										{tr('calendar.economicNewsError')}
									</div>
								) : selectedEconomicEvents.length > 0 ? (
									<div className="trader-journal-calendar__trade-list">
										{selectedEconomicEvents.map((event, index) => (
											<EconomicCalendarCard
												event={event}
												language={language}
												timeZone={plugin.settings.economicCalendarTimeZone}
												key={`${event.date}-${event.country}-${event.title}-${index}`}
											/>
										))}
									</div>
								) : (
									<div className="trader-journal-calendar__empty">
										{tr('calendar.noEconomicNews')}
									</div>
								)}
							</section>
						) : null}

						{journalTypeFilter === 'live' && selectedPlanDay.plans.length > 0 ? (
							<section className="trader-journal-calendar__section">
								<div className="trader-journal-calendar__section-title">{tr('calendar.plans')}</div>
								<div className="trader-journal-calendar__trade-list">
									{selectedPlanDay.plans.map((plan) => (
										<PlanCalendarCard
											language={language}
											plugin={plugin}
											plan={plan}
											linkedTrades={selectedDay.trades.filter(
												(trade) => stringifyValue(trade.trade.plan_id) === plan.id,
											)}
											key={`${plan.filePath}-${plan.id}`}
										/>
									))}
								</div>
							</section>
						) : null}

						<section className="trader-journal-calendar__section">
							<div className="trader-journal-calendar__section-title">{tr('calendar.trades')}</div>
							{selectedDay.trades.length > 0 ? (
								<div className="trader-journal-calendar__trade-list">
									{selectedDay.trades.map((trade) => (
										<TradeCalendarCard
											language={language}
											plugin={plugin}
											planTitle={getPlanTitleForTrade(trade, plansById)}
											trade={trade}
											key={`${trade.filePath}-${trade.id}`}
										/>
									))}
								</div>
							) : (
								<div className="trader-journal-calendar__empty">{tr('calendar.noTrades')}</div>
							)}
						</section>
					</>
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
	economicNewsCount,
	planDay,
	isSelected,
	isToday,
	language,
	onSelect,
}: {
	calendarDate: CalendarDateCell;
	day: JournalCalendarDay | undefined;
	economicNewsCount: number;
	planDay: JournalCalendarPlanDay | undefined;
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
	if (planDay && getPlanCount(planDay) > 0) {
		labelParts.push(`${getPlanCount(planDay)} ${tr('calendar.plans').toLowerCase()}`);
	}
	if (economicNewsCount > 0) {
		labelParts.push(tr('calendar.economicNewsCount', { count: economicNewsCount }));
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
			<CalendarDotSummary day={day} planDay={planDay} hasEconomicNews={economicNewsCount > 0} />
			<span className="trader-journal-calendar-day__number">{calendarDate.dayNumber}</span>
		</button>
	);
}

function HorizontalCalendarDateButton({
	calendarDate,
	day,
	economicNewsCount,
	planDay,
	isSelected,
	isToday,
	language,
	onSelect,
}: {
	calendarDate: CalendarDateCell;
	day: JournalCalendarDay | undefined;
	economicNewsCount: number;
	planDay: JournalCalendarPlanDay | undefined;
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
	if (planDay && getPlanCount(planDay) > 0) {
		labelParts.push(`${getPlanCount(planDay)} ${tr('calendar.plans').toLowerCase()}`);
	}
	if (economicNewsCount > 0) {
		labelParts.push(tr('calendar.economicNewsCount', { count: economicNewsCount }));
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
			<CalendarDotSummary day={day} planDay={planDay} hasEconomicNews={economicNewsCount > 0} />
			<span className="trader-journal-horizontal-calendar-day__weekday">{weekdayLabel}</span>
			<span className="trader-journal-horizontal-calendar-day__number">{calendarDate.dayNumber}</span>
		</button>
	);
}

function CalendarDotSummary({
	day,
	hasEconomicNews,
	planDay,
}: {
	day: JournalCalendarDay | undefined;
	hasEconomicNews: boolean;
	planDay: JournalCalendarPlanDay | undefined;
}) {
	return (
		<div className="trader-journal-calendar-dots" aria-hidden="true">
			{day?.backtestCount ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--backtest" />
			) : null}
			{day?.liveCount ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--live" />
			) : null}
			{planDay?.openPlanCount ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--plan-open" />
			) : null}
			{planDay && planDay.closedPlanCount + planDay.cancelledPlanCount > 0 ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--plan-ended" />
			) : null}
			{hasEconomicNews ? (
				<span className="trader-journal-calendar-dot trader-journal-calendar-dot--economic-news" />
			) : null}
		</div>
	);
}

const ECONOMIC_IMPACT_TRANSLATION_KEYS: Record<
	EconomicImpact,
	'impact.high' | 'impact.medium' | 'impact.low' | 'impact.holiday'
> = {
	High: 'impact.high',
	Medium: 'impact.medium',
	Low: 'impact.low',
	Holiday: 'impact.holiday',
};

function EconomicCalendarCard({
	event,
	language,
	timeZone,
}: {
	event: EconomicCalendarEvent;
	language: TraderJournalLanguage;
	timeZone: string;
}) {
	const tr = getTranslator(language);
	const locale = getLocale(language);
	const forecast = event.forecast || tr('calendar.notAvailable');
	const previous = event.previous || tr('calendar.notAvailable');

	return (
		<div
			className={[
				'trader-journal-economic-card',
				`trader-journal-economic-card--${event.impact.toLowerCase()}`,
			].join(' ')}
		>
			<div className="trader-journal-economic-card__head">
				<strong className="trader-journal-economic-card__country">{event.country}</strong>
				<span className="trader-journal-economic-card__time">
					{formatEconomicEventTime(event, timeZone, locale)}
				</span>
			</div>
			<div className="trader-journal-economic-card__title">{event.title}</div>
			<div className="trader-journal-economic-card__meta">
				<span className="trader-journal-economic-card__impact">
					{tr(ECONOMIC_IMPACT_TRANSLATION_KEYS[event.impact])}
				</span>
				<span>{tr('calendar.forecast', { value: forecast })}</span>
				<span>{tr('calendar.previous', { value: previous })}</span>
			</div>
		</div>
	);
}

function PlanCalendarCard({
	language,
	linkedTrades,
	plugin,
	plan,
}: {
	language: TraderJournalLanguage;
	linkedTrades: JournalCalendarTrade[];
	plugin: TraderJournalPlugin;
	plan: JournalCalendarPlan;
}) {
	const tr = getTranslator(language);
	const openPlanFile = async () => {
		try {
			await plugin.app.workspace.openLinkText(plan.filePath, '', false);
		} catch (error) {
			console.error('Trader Journal failed to open plan note', error);
			new Notice(tr('calendar.openPlanNoteError'));
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) {
			return;
		}

		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		void openPlanFile();
	};

	const openEditModal = () => {
		new TradePlanModal(plugin.app, plugin, plan.plan, plan.filePath).open();
	};

	return (
		<div
			className={[
				'trader-journal-calendar-card',
				'trader-journal-calendar-card--plan',
				`trader-journal-calendar-card--plan-${plan.status}`,
			].join(' ')}
			role="button"
			tabIndex={0}
			onClick={() => void openPlanFile()}
			onKeyDown={handleKeyDown}
		>
			<div className="trader-journal-calendar-card__head">
				<strong className="trader-journal-calendar-card__symbol">{plan.symbol}</strong>
				<div className="trader-journal-calendar-card__head-meta">
					<CalendarIconButton
						icon="pencil"
						label={tr('modal.editTradePlan')}
						onClick={openEditModal}
						stopPropagation
						variant="plain"
					/>
					<span
						className={[
							'trader-journal-calendar-card__status',
							`trader-journal-calendar-card__status--plan-${plan.status}`,
						].join(' ')}
					>
						{getPlanStatusLabel(tr, plan.status)}
					</span>
				</div>
			</div>
			<div className="trader-journal-calendar-card__body">
				<span className="trader-journal-calendar-card__meta">
					{[plan.title, plan.setup, plan.timeframes.join(', ')].filter(Boolean).join(' · ')}
				</span>
				<span className="trader-journal-calendar-card__result">{formatPlanDateRange(plan)}</span>
			</div>
			{plan.notes ? <div className="trader-journal-calendar-card__notes">{plan.notes}</div> : null}
			<div className="trader-journal-calendar-card__plan-meta">
				{[
					plan.imageCount ? tr('calendar.imageCount', { count: plan.imageCount }) : '',
					plan.linkedTradeCount ? tr('calendar.linkedTradeCount', { count: plan.linkedTradeCount }) : '',
				]
					.filter(Boolean)
					.join(' · ')}
			</div>
			{linkedTrades.length > 0 ? (
				<div className="trader-journal-calendar-card__linked-trades">
					{linkedTrades.map((trade) => (
						<span key={`${trade.filePath}-${trade.id}`}>
							{[formatTradeTime(trade.createdAt), trade.side, trade.setup, trade.rr].filter(Boolean).join(' / ')}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function TradeCalendarCard({
	language,
	planTitle,
	plugin,
	trade,
}: {
	language: TraderJournalLanguage;
	planTitle: string;
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
		if (event.target !== event.currentTarget) {
			return;
		}

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
					{trade.journalType === 'live' && trade.status !== 'closed' ? (
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
			{planTitle ? (
				<div className="trader-journal-calendar-card__plan">
					{tr('detail.plan')}: {planTitle}
				</div>
			) : null}
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

function createEmptyPlanDay(date: string): JournalCalendarPlanDay {
	return {
		date,
		openPlanCount: 0,
		closedPlanCount: 0,
		cancelledPlanCount: 0,
		plans: [],
	};
}

function createPlansById(snapshot: JournalPlanSnapshot): Map<string, JournalCalendarPlan> {
	const plansById = new Map<string, JournalCalendarPlan>();

	for (const day of Object.values(snapshot.daysByDate)) {
		for (const plan of day.plans) {
			if (!plansById.has(plan.id)) {
				plansById.set(plan.id, plan);
			}
		}
	}

	return plansById;
}

function getAutoSelectedDate(
	journalTypeFilter: TradeCalendarFilter,
	tradeSnapshot: JournalCalendarSnapshot,
	planSnapshot: JournalPlanSnapshot,
	today: string,
): string {
	if (journalTypeFilter === 'live') {
		if (hasLiveCalendarDataOnDate(tradeSnapshot, planSnapshot, today)) {
			return today;
		}

		return getLatestLiveCalendarDate(tradeSnapshot, planSnapshot);
	}

	return tradeSnapshot.dayDates[tradeSnapshot.dayDates.length - 1] ?? '';
}

function hasLiveCalendarDataOnDate(
	tradeSnapshot: JournalCalendarSnapshot,
	planSnapshot: JournalPlanSnapshot,
	date: string,
): boolean {
	return Boolean(tradeSnapshot.daysByDate[date]?.trades.length || planSnapshot.daysByDate[date]?.openPlanCount);
}

function getLatestLiveCalendarDate(
	tradeSnapshot: JournalCalendarSnapshot,
	planSnapshot: JournalPlanSnapshot,
): string {
	const dates = new Set([...tradeSnapshot.dayDates, ...planSnapshot.dayDates]);
	const sortedDates = [...dates].sort();
	return sortedDates[sortedDates.length - 1] ?? '';
}

function getPlanTitleForTrade(
	trade: JournalCalendarTrade,
	plansById: Map<string, JournalCalendarPlan>,
): string {
	const planId = stringifyValue(trade.trade.plan_id);
	return planId ? plansById.get(planId)?.title ?? planId : '';
}

function getPlanCount(planDay: JournalCalendarPlanDay): number {
	return planDay.openPlanCount + planDay.closedPlanCount + planDay.cancelledPlanCount;
}

function getPlanStatusLabel(tr: ReturnType<typeof getTranslator>, status: JournalCalendarPlan['status']): string {
	if (status === 'closed') {
		return tr('option.closed');
	}

	if (status === 'cancelled') {
		return tr('option.cancelled');
	}

	return tr('option.open');
}

function formatPlanDateRange(plan: JournalCalendarPlan): string {
	return [plan.startDate, plan.endDate].filter(Boolean).join(' - ');
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

function getNextLocalMidnightDelay(): number {
	const now = new Date();
	const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return Math.max(nextMidnight.getTime() - now.getTime() + 1000, 1000);
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
