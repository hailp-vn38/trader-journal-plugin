import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from '../ui/TraderJournalModal';

export function registerCommands(plugin: TraderJournalPlugin) {
	plugin.addCommand({
		id: 'open-trader-journal',
		name: 'Open trader journal',
		callback: () => {
			new TraderJournalModal(plugin.app).open();
		},
	});
}
