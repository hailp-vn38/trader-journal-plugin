import type { EventRef, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, setIcon, TFile } from 'obsidian';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { KeyboardEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from './TraderJournalModal';
import {
	JournalCalendarIndex,
	type JournalCalendarDay,
	type JournalCalendarSnapshot,
	type JournalCalendarTrade,
} from '../trades/journalIndex';
import { stringifyValue } from '../trades/format';
import type { TradeJournalType } from '../trades/types';

export const TRADER_JOURNAL_CALENDAR_VIEW_TYPE = 'trader-journal-calendar';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
		new Notice('Could not open trade calendar.');
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
		this.icon = 'calendar-days';
	}

	getViewType(): string {
		return TRADER_JOURNAL_CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Trade calendar';
	}

	getIcon(): string {
		return 'calendar-days';
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
	const [isLoading, setIsLoading] = useState(true);
	const initialSelectionAppliedRef = useRef(false);
	const previousFilterRef = useRef<TradeCalendarFilter>(journalTypeFilter);

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
	const selectedDay = filteredSnapshot.daysByDate[selectedDate] ?? createEmptyDay(selectedDate);

	const selectDate = (date: string) => {
		setSelectedDate(date);
		setVisibleMonth(getMonthKey(date));
	};

	const goToToday = () => {
		setSelectedDate(today);
		setVisibleMonth(getMonthKey(today));
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
					aria-label="Previous month"
					onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
				>
					‹
				</button>
				<div className="trader-journal-calendar__month">{formatMonthLabel(visibleMonth)}</div>
				<button
					type="button"
					className="trader-journal-calendar__nav-button"
					aria-label="Next month"
					onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
				>
					›
				</button>
				<button type="button" className="trader-journal-calendar__today-button" onClick={goToToday}>
					Today
				</button>
			</header>

			<div className="trader-journal-calendar__weekday-row">
				{WEEKDAY_LABELS.map((weekday) => (
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
						onSelect={selectDate}
					/>
				))}
			</div>

			<section className="trader-journal-calendar__day-panel">
				<div className="trader-journal-calendar__day-header">
					<div className="trader-journal-calendar__day-count">
						{selectedDay.trades.length} trade{selectedDay.trades.length === 1 ? '' : 's'}
					</div>
					<div className="trader-journal-calendar__actions">
						<CalendarIconButton
							icon="plus"
							label={`Add ${journalTypeFilter} trade`}
							onClick={openCreateTradeModal}
						/>
						<select
							className="trader-journal-calendar__filter"
							value={journalTypeFilter}
							aria-label="Filter trade type"
							onChange={(event) => setJournalTypeFilter(event.target.value as TradeCalendarFilter)}
						>
							<option value="live">Live</option>
							<option value="backtest">Backtest</option>
						</select>
					</div>
				</div>

				{isLoading ? (
					<div className="trader-journal-calendar__empty">Loading trades...</div>
				) : selectedDay.trades.length > 0 ? (
					<div className="trader-journal-calendar__trade-list">
						{selectedDay.trades.map((trade) => (
							<TradeCalendarCard plugin={plugin} trade={trade} key={`${trade.filePath}-${trade.id}`} />
						))}
					</div>
				) : (
					<div className="trader-journal-calendar__empty">No trades for this date.</div>
				)}
			</section>
		</div>
	);
}

function CalendarIconButton({
	icon,
	label,
	onClick,
}: {
	icon: string;
	label: string;
	onClick: () => void;
}) {
	const iconElRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!iconElRef.current) {
			return;
		}

		iconElRef.current.replaceChildren();
		setIcon(iconElRef.current, icon);
	}, [icon]);

	return (
		<button
			type="button"
			className="trader-journal-calendar__icon-button"
			aria-label={label}
			title={label}
			onClick={onClick}
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
	onSelect,
}: {
	calendarDate: CalendarDateCell;
	day: JournalCalendarDay | undefined;
	isSelected: boolean;
	isToday: boolean;
	onSelect: (date: string) => void;
}) {
	const labelParts = [calendarDate.date];
	if (day?.backtestCount) {
		labelParts.push(`${day.backtestCount} backtest`);
	}
	if (day?.liveCount) {
		labelParts.push(`${day.liveCount} live`);
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
			onClick={() => onSelect(calendarDate.date)}
		>
			<CalendarDotSummary day={day} />
			<span className="trader-journal-calendar-day__number">{calendarDate.dayNumber}</span>
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

function TradeCalendarCard({ plugin, trade }: { plugin: TraderJournalPlugin; trade: JournalCalendarTrade }) {
	const openTradeFile = () => {
		void plugin.app.workspace.openLinkText(trade.filePath, '', false).catch((error: unknown) => {
			console.error('Trader Journal failed to open trade note', error);
			new Notice('Could not open trade note.');
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		openTradeFile();
	};

	return (
		<div
			className={[
				'trader-journal-calendar-card',
				`trader-journal-calendar-card--${trade.journalType}`,
			].join(' ')}
			role="button"
			tabIndex={0}
			onClick={openTradeFile}
			onKeyDown={handleKeyDown}
		>
			<div className="trader-journal-calendar-card__head">
				<strong className="trader-journal-calendar-card__symbol">{trade.symbol}</strong>
				<span className="trader-journal-calendar-card__time">{formatTradeTime(trade.createdAt)}</span>
			</div>
			<div className="trader-journal-calendar-card__body">
				<span className="trader-journal-calendar-card__meta">
					{[trade.side, trade.setup, trade.timeframe].filter(Boolean).join(' · ') || trade.file.basename}
				</span>
				<span className="trader-journal-calendar-card__result">
					{[trade.result, trade.rr].filter(Boolean).join(' / ') || '-'}
				</span>
			</div>
			{trade.notes ? <div className="trader-journal-calendar-card__notes">{trade.notes}</div> : null}
		</div>
	);
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

function formatMonthLabel(monthKey: string): string {
	const { year, month } = parseMonthKey(monthKey);
	return new Date(year, month, 1).toLocaleString(undefined, {
		month: 'long',
		year: 'numeric',
	});
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
