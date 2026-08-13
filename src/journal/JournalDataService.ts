import type { TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { JournalPlanIndex, type JournalPlanSnapshot } from '../plans/planIndex';
import { JournalCalendarIndex, type JournalCalendarSnapshot } from '../trades/journalIndex';

const FILE_UPDATE_DEBOUNCE_MS = 250;

export interface JournalDataSnapshot {
	trades: JournalCalendarSnapshot;
	plans: JournalPlanSnapshot;
	isLoading: boolean;
}

type JournalDataSubscriber = (snapshot: JournalDataSnapshot) => void;

const EMPTY_TRADE_SNAPSHOT: JournalCalendarSnapshot = {
	daysByDate: {},
	dayDates: [],
	tradeCount: 0,
};

const EMPTY_PLAN_SNAPSHOT: JournalPlanSnapshot = {
	daysByDate: {},
	dayDates: [],
	planCount: 0,
	plans: [],
};

export class JournalDataService {
	private readonly tradeIndex: JournalCalendarIndex;
	private readonly planIndex: JournalPlanIndex;
	private readonly subscribers = new Set<JournalDataSubscriber>();
	private readonly fileUpdateTimers = new Map<string, number>();
	private snapshot: JournalDataSnapshot = {
		trades: EMPTY_TRADE_SNAPSHOT,
		plans: EMPTY_PLAN_SNAPSHOT,
		isLoading: true,
	};
	private updateQueue: Promise<void> = Promise.resolve();
	private started = false;
	private disposed = false;

	constructor(private readonly plugin: TraderJournalPlugin) {
		this.tradeIndex = new JournalCalendarIndex(plugin);
		this.planIndex = new JournalPlanIndex(plugin);
		plugin.register(() => this.dispose());
	}

	getSnapshot(): JournalDataSnapshot {
		return this.snapshot;
	}

	subscribe(subscriber: JournalDataSubscriber): () => void {
		this.subscribers.add(subscriber);
		subscriber(this.snapshot);
		this.start();

		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	refresh(): Promise<void> {
		this.start();
		return this.enqueue(async () => this.rebuild());
	}

	refreshIfStarted(): void {
		if (this.started && !this.disposed) {
			void this.enqueue(async () => this.rebuild());
		}
	}

	private start(): void {
		if (this.started || this.disposed) {
			return;
		}

		this.started = true;
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.scheduleFileUpdate(file);
				}
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.scheduleFileUpdate(file);
				}
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
				this.snapshot = {
					...this.snapshot,
					trades: this.tradeIndex.removePath(file.path),
					plans: this.planIndex.removePath(file.path),
				};
				this.notify();
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				this.snapshot = {
					...this.snapshot,
					trades: this.tradeIndex.removePath(oldPath),
					plans: this.planIndex.removePath(oldPath),
				};
				this.notify();
				if (file instanceof TFile) {
					this.scheduleFileUpdate(file);
				}
			}),
		);

		void this.enqueue(async () => this.rebuild());
	}

	private scheduleFileUpdate(file: TFile): void {
		const existingTimer = this.fileUpdateTimers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			this.fileUpdateTimers.delete(file.path);
			void this.enqueue(async () => this.updateFile(file));
		}, FILE_UPDATE_DEBOUNCE_MS);
		this.fileUpdateTimers.set(file.path, timer);
	}

	private async rebuild(): Promise<void> {
		this.snapshot = { ...this.snapshot, isLoading: true };
		this.notify();

		try {
			const [trades, plans] = await Promise.all([
				this.tradeIndex.rebuild(),
				this.planIndex.rebuild(),
			]);
			this.snapshot = { trades, plans, isLoading: false };
		} catch (error) {
			console.error('Trader Journal failed to build journal index', error);
			this.snapshot = { ...this.snapshot, isLoading: false };
		}
		this.notify();
	}

	private async updateFile(file: TFile): Promise<void> {
		try {
			const [trades, plans] = await Promise.all([
				this.tradeIndex.updateFile(file),
				this.planIndex.updateFile(file),
			]);
			this.snapshot = { trades, plans, isLoading: false };
			this.notify();
		} catch (error) {
			console.error('Trader Journal failed to update journal index', error);
		}
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.updateQueue = this.updateQueue.catch(() => undefined).then(task);
		return this.updateQueue;
	}

	private notify(): void {
		for (const subscriber of this.subscribers) {
			subscriber(this.snapshot);
		}
	}

	private dispose(): void {
		this.disposed = true;
		for (const timer of this.fileUpdateTimers.values()) {
			window.clearTimeout(timer);
		}
		this.fileUpdateTimers.clear();
		this.subscribers.clear();
	}
}
