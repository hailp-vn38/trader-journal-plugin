import { TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { isPathInFolder } from '../journal/pathScope';
import { isPotentialJournalFile, rebuildDailyNoteStats } from './storage';

const REBUILD_DEBOUNCE_MS = 800;

export function registerAutoStatsRebuild(plugin: TraderJournalPlugin): void {
	const timers = new Map<string, number>();
	const latestFiles = new Map<string, TFile>();
	const runningByPath = new Map<string, Promise<void>>();
	const dirtyPaths = new Set<string>();

	const runRebuildLoop = async (path: string): Promise<void> => {
		do {
			dirtyPaths.delete(path);
			const file = latestFiles.get(path);
			if (!file || !isPotentialJournalFile(plugin, file)) {
				return;
			}

			try {
				await rebuildDailyNoteStats(plugin, file);
			} catch (error) {
				console.error('Trader Journal failed to rebuild stats', error);
			}
		} while (dirtyPaths.has(path));
	};

	const startRebuild = (path: string): void => {
		if (runningByPath.has(path)) {
			dirtyPaths.add(path);
			return;
		}

		const task = runRebuildLoop(path).finally(() => {
			runningByPath.delete(path);
			if (!timers.has(path) && !dirtyPaths.has(path)) {
				latestFiles.delete(path);
			}
		});
		runningByPath.set(path, task);
	};

	const cancelPending = (path: string, includeDescendants: boolean): void => {
		for (const [pendingPath, timer] of timers) {
			if (pendingPath !== path && !(includeDescendants && isPathInFolder(pendingPath, path))) {
				continue;
			}

			window.clearTimeout(timer);
			timers.delete(pendingPath);
			dirtyPaths.delete(pendingPath);
			latestFiles.delete(pendingPath);
		}
	};

	const schedule = (file: TFile): void => {
		if (!isPotentialJournalFile(plugin, file)) {
			return;
		}

		latestFiles.set(file.path, file);
		const existingTimer = timers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			timers.delete(file.path);
			startRebuild(file.path);
		}, REBUILD_DEBOUNCE_MS);
		timers.set(file.path, timer);
	};

	plugin.registerEvent(
		plugin.app.vault.on('modify', (file) => {
			if (file instanceof TFile) {
				schedule(file);
			}
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on('delete', (file) => {
			cancelPending(file.path, file instanceof TFolder);
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on('rename', (file, oldPath) => {
			cancelPending(oldPath, file instanceof TFolder);
			if (file instanceof TFile) {
				schedule(file);
			}
		}),
	);

	plugin.register(() => {
		for (const timer of timers.values()) {
			window.clearTimeout(timer);
		}

		timers.clear();
		dirtyPaths.clear();
		latestFiles.clear();
	});
}
