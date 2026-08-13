import type { TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import {
	readTradePlanFile,
	scanTradePlanEntries,
	type TradePlanFileEntry,
} from '../plans/storage';
import { readTradeSetupFile, scanTradeSetups } from '../setups/storage';
import type { TradeSetupDefinition } from '../setups/types';
import { stringifyValue } from '../trades/format';
import { classifyTraderJournalPath, isPathInFolder } from './pathScope';

const FILE_UPDATE_DEBOUNCE_MS = 100;

export class ReferenceDataService {
	private readonly planEntriesByPath = new Map<string, TradePlanFileEntry>();
	private readonly plansById = new Map<string, TradePlanFileEntry>();
	private readonly setupsByPath = new Map<string, TradeSetupDefinition>();
	private readonly setupsById = new Map<string, TradeSetupDefinition>();
	private readonly fileUpdateTimers = new Map<string, number>();
	private updateQueue: Promise<void> = Promise.resolve();
	private startPromise: Promise<void> | null = null;
	private started = false;
	private initialized = false;
	private disposed = false;

	constructor(private readonly plugin: TraderJournalPlugin) {
		plugin.register(() => this.dispose());
	}

	async listSetups(): Promise<TradeSetupDefinition[]> {
		await this.ensureStarted();
		return [...this.setupsByPath.values()].sort((first, second) => first.name.localeCompare(second.name));
	}

	async getSetupById(id: string): Promise<TradeSetupDefinition | null> {
		await this.ensureStarted();
		return this.setupsById.get(stringifyValue(id)) ?? null;
	}

	async listPlans(): Promise<TradePlanFileEntry[]> {
		await this.ensureStarted();
		return [...this.planEntriesByPath.values()].sort((first, second) =>
			first.filePath.localeCompare(second.filePath),
		);
	}

	async getPlanById(id: string): Promise<TradePlanFileEntry | null> {
		await this.ensureStarted();
		return this.plansById.get(stringifyValue(id)) ?? null;
	}

	async refresh(): Promise<void> {
		this.startListeners();
		await this.enqueue(async () => this.rebuild());
	}

	refreshIfStarted(): Promise<void> {
		if (this.started && !this.disposed) {
			return this.enqueue(async () => this.rebuild());
		}
		return Promise.resolve();
	}

	async refreshFile(file: TFile): Promise<void> {
		await this.ensureStarted();
		await this.enqueue(async () => this.updateFile(file));
	}

	private ensureStarted(): Promise<void> {
		if (this.disposed || this.initialized) {
			return Promise.resolve();
		}
		if (this.startPromise) {
			return this.startPromise;
		}

		this.startListeners();
		this.startPromise = this.enqueue(async () => this.rebuild()).finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}

	private startListeners(): void {
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
				const kind = classifyTraderJournalPath(this.plugin, file.path);
				if (kind !== 'plan' && kind !== 'setup') {
					return;
				}

				this.cancelPendingUpdates(file.path, file instanceof TFolder);
				void this.enqueue(async () => {
					if (file instanceof TFolder) {
						this.removePathPrefix(file.path);
					} else {
						this.removePath(file.path);
					}
				});
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				const oldKind = classifyTraderJournalPath(this.plugin, oldPath);
				const newKind = classifyTraderJournalPath(this.plugin, file.path);
				const wasIndexed = oldKind === 'plan' || oldKind === 'setup';
				const isIndexed = newKind === 'plan' || newKind === 'setup';
				if (!wasIndexed && !isIndexed) {
					return;
				}

				this.cancelPendingUpdates(oldPath, file instanceof TFolder);
				if (file instanceof TFolder) {
					void this.enqueue(async () => this.rebuild());
					return;
				}

				void this.enqueue(async () => {
					this.removePath(oldPath);
					if (file instanceof TFile && isIndexed) {
						await this.updateFile(file);
					}
				});
			}),
		);
	}

	private scheduleFileUpdate(file: TFile): void {
		const kind = classifyTraderJournalPath(this.plugin, file.path);
		if (file.extension !== 'md' || (kind !== 'plan' && kind !== 'setup')) {
			return;
		}

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
		const [plans, setups] = await Promise.all([
			scanTradePlanEntries(this.plugin),
			scanTradeSetups(this.plugin),
		]);
		this.planEntriesByPath.clear();
		this.setupsByPath.clear();
		for (const entry of plans) {
			this.planEntriesByPath.set(entry.filePath, entry);
		}
		for (const setup of setups) {
			this.setupsByPath.set(setup.filePath, setup);
		}
		this.rebuildIdMaps();
		this.initialized = true;
	}

	private async updateFile(file: TFile): Promise<void> {
		const kind = classifyTraderJournalPath(this.plugin, file.path);
		if (kind === 'plan') {
			const entry = await readTradePlanFile(this.plugin, file);
			if (entry) {
				this.planEntriesByPath.set(file.path, entry);
			} else {
				this.planEntriesByPath.delete(file.path);
			}
		} else if (kind === 'setup') {
			const setup = await readTradeSetupFile(this.plugin, file);
			if (setup) {
				this.setupsByPath.set(file.path, setup);
			} else {
				this.setupsByPath.delete(file.path);
			}
		} else {
			return;
		}

		this.rebuildIdMaps();
	}

	private removePath(path: string): void {
		const planChanged = this.planEntriesByPath.delete(path);
		const setupChanged = this.setupsByPath.delete(path);
		if (planChanged || setupChanged) {
			this.rebuildIdMaps();
		}
	}

	private removePathPrefix(pathPrefix: string): void {
		let changed = false;
		for (const path of this.planEntriesByPath.keys()) {
			if (isPathInFolder(path, pathPrefix)) {
				this.planEntriesByPath.delete(path);
				changed = true;
			}
		}
		for (const path of this.setupsByPath.keys()) {
			if (isPathInFolder(path, pathPrefix)) {
				this.setupsByPath.delete(path);
				changed = true;
			}
		}
		if (changed) {
			this.rebuildIdMaps();
		}
	}

	private rebuildIdMaps(): void {
		this.plansById.clear();
		this.setupsById.clear();
		const plans = [...this.planEntriesByPath.values()].sort((first, second) =>
			first.filePath.localeCompare(second.filePath),
		);
		for (const entry of plans) {
			const id = stringifyValue(entry.plan.id);
			if (id && !this.plansById.has(id)) {
				this.plansById.set(id, entry);
			}
		}
		const setups = [...this.setupsByPath.values()].sort((first, second) =>
			first.filePath.localeCompare(second.filePath),
		);
		for (const setup of setups) {
			if (setup.id && !this.setupsById.has(setup.id)) {
				this.setupsById.set(setup.id, setup);
			}
		}
	}

	private cancelPendingUpdates(path: string, includeDescendants: boolean): void {
		for (const [pendingPath, timer] of this.fileUpdateTimers) {
			if (pendingPath !== path && !(includeDescendants && isPathInFolder(pendingPath, path))) {
				continue;
			}
			window.clearTimeout(timer);
			this.fileUpdateTimers.delete(pendingPath);
		}
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.updateQueue = this.updateQueue.catch(() => undefined).then(task);
		return this.updateQueue;
	}

	private dispose(): void {
		this.disposed = true;
		for (const timer of this.fileUpdateTimers.values()) {
			window.clearTimeout(timer);
		}
		this.fileUpdateTimers.clear();
	}
}
