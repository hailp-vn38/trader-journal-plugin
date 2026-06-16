import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { normalizeSettings, TraderJournalSettings } from './settings';
import { TraderJournalSettingTab } from './ui/SettingsTab';
import { TraderJournalModal } from './ui/TraderJournalModal';
import { registerAutoStatsRebuild } from './trades/autoRebuild';
import { registerTradeBlockProcessor } from './trades/tradeBlockProcessor';

export default class TraderJournalPlugin extends Plugin {
	settings!: TraderJournalSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('notebook-pen', 'Add backtest trade', () => {
			new TraderJournalModal(this.app, this).open();
		});
		this.addRibbonIcon('line-chart', 'Add live trade', () => {
			new TraderJournalModal(this.app, this, 'live').open();
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Trader journal');

		registerCommands(this);
		registerAutoStatsRebuild(this);
		registerTradeBlockProcessor(this);
		this.addSettingTab(new TraderJournalSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = normalizeSettings((await this.loadData()) as Partial<TraderJournalSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
