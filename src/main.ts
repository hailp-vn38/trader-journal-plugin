import { Notice, Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { DEFAULT_SETTINGS, TraderJournalSettings } from './settings';
import { TraderJournalSettingTab } from './ui/SettingsTab';
import { TraderJournalModal } from './ui/TraderJournalModal';

export default class TraderJournalPlugin extends Plugin {
	settings!: TraderJournalSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('notebook-pen', 'Open trader journal', () => {
			new TraderJournalModal(this.app).open();
			new Notice('Opened trader journal');
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Trader journal');

		registerCommands(this);
		this.addSettingTab(new TraderJournalSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TraderJournalSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
