import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { normalizeSettings, TraderJournalSettings } from './settings';
import { TraderJournalSettingTab } from './ui/SettingsTab';
import { openTraderJournalCalendar, registerTraderJournalCalendarView } from './ui/TradeCalendarView';
import { registerAutoStatsRebuild } from './trades/autoRebuild';
import { registerTradeBlockProcessor } from './trades/tradeBlockProcessor';

export default class TraderJournalPlugin extends Plugin {
	settings!: TraderJournalSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('calendar-days', 'Open trade calendar', () => {
			void openTraderJournalCalendar(this);
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Trader journal');

		registerTraderJournalCalendarView(this);
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
