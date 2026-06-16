import { Notice } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { rebuildDailyNoteStats } from '../trades/storage';
import { TraderJournalModal } from '../ui/TraderJournalModal';

export function registerCommands(plugin: TraderJournalPlugin) {
	plugin.addCommand({
		id: 'open-trader-journal',
		name: 'Add backtest trade',
		callback: () => {
			new TraderJournalModal(plugin.app, plugin).open();
		},
	});

	plugin.addCommand({
		id: 'add-live-trade',
		name: 'Add live trade',
		callback: () => {
			new TraderJournalModal(plugin.app, plugin, 'live').open();
		},
	});

	plugin.addCommand({
		id: 'recalculate-current-journal-stats',
		name: 'Recalculate current stats',
		callback: () => {
			void recalculateCurrentJournalStats(plugin);
		},
	});
}

async function recalculateCurrentJournalStats(plugin: TraderJournalPlugin): Promise<void> {
	const file = plugin.app.workspace.getActiveFile();
	if (!file) {
		new Notice('No active file.');
		return;
	}

	try {
		const result = await rebuildDailyNoteStats(plugin, file);
		if (result.skipped) {
			new Notice('Current file is not a trader journal note.');
			return;
		}

		const invalidBlockSuffix = result.stats.invalidTradeBlockCount === 1 ? '' : 's';
		const invalidBlockMessage =
			result.stats.invalidTradeBlockCount > 0
				? ` ${result.stats.invalidTradeBlockCount} invalid block${invalidBlockSuffix} skipped.`
				: '';
		new Notice(
			`Recalculated ${result.stats.tradeCount} trade${result.stats.tradeCount === 1 ? '' : 's'}.${invalidBlockMessage}`,
		);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : 'Could not recalculate stats.');
	}
}
