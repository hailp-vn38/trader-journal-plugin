import { TFile } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { isPotentialJournalFile, rebuildDailyNoteStats } from './storage';

const REBUILD_DEBOUNCE_MS = 800;

export function registerAutoStatsRebuild(plugin: TraderJournalPlugin): void {
	const timers = new Map<string, number>();

	plugin.registerEvent(
		plugin.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile) || !isPotentialJournalFile(plugin, file)) {
				return;
			}

			const existingTimer = timers.get(file.path);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
			}

			const timer = window.setTimeout(() => {
				timers.delete(file.path);
				void rebuildDailyNoteStats(plugin, file).catch((error: unknown) => {
					console.error('Trader Journal failed to rebuild stats', error);
				});
			}, REBUILD_DEBOUNCE_MS);

			timers.set(file.path, timer);
		}),
	);

	plugin.register(() => {
		for (const timer of timers.values()) {
			window.clearTimeout(timer);
		}

		timers.clear();
	});
}
