import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from '../ui/TraderJournalModal';

export function registerCommands(plugin: TraderJournalPlugin) {
	plugin.addCommand({
		id: 'open-trader-journal',
		name: 'Add backtest trade',
		callback: () => {
			new TraderJournalModal(plugin.app, plugin).open();
		},
	});
}
