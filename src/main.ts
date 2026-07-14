import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { normalizeSettings, TraderJournalSettings } from './settings';
import { TraderJournalSettingTab } from './ui/SettingsTab';
import {
	openTraderJournalCalendar,
	registerTraderJournalCalendarView,
	TRADER_JOURNAL_CALENDAR_ICON,
} from './ui/TradeCalendarView';
import { registerAutoStatsRebuild } from './trades/autoRebuild';
import { registerTradeBlockProcessor } from './trades/tradeBlockProcessor';
import { registerPlanBlockProcessor } from './plans/planBlockProcessor';
import { getTranslator } from './i18n';
import { EconomicCalendarService } from './economicCalendar/api';
import type { EconomicCalendarCache } from './economicCalendar/types';

interface TraderJournalPluginData {
	settings: TraderJournalSettings;
	economicCalendarCache: EconomicCalendarCache | null;
	economicCalendarLastRequestAt: string | null;
}

export default class TraderJournalPlugin extends Plugin {
	settings!: TraderJournalSettings;
	economicCalendarCache: EconomicCalendarCache | null = null;
	economicCalendarLastRequestAt: string | null = null;
	economicCalendarService!: EconomicCalendarService;
	private saveQueue: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();
		this.economicCalendarService = new EconomicCalendarService(this);
		const tr = getTranslator(this.settings.language);

		this.addRibbonIcon(TRADER_JOURNAL_CALENDAR_ICON, tr('command.openTradeCalendar'), () => {
			void openTraderJournalCalendar(this);
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Trader journal');

		registerTraderJournalCalendarView(this);
		registerCommands(this);
		registerAutoStatsRebuild(this);
		registerTradeBlockProcessor(this);
		registerPlanBlockProcessor(this);
		this.addSettingTab(new TraderJournalSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const data = (await this.loadData()) as unknown;
		if (isPluginData(data)) {
			this.settings = normalizeSettings(data.settings);
			this.economicCalendarCache = normalizeEconomicCalendarCache(data.economicCalendarCache);
			this.economicCalendarLastRequestAt = normalizeIsoDate(data.economicCalendarLastRequestAt);
			return;
		}

		this.settings = normalizeSettings(data as Partial<TraderJournalSettings> | null | undefined);
		this.economicCalendarCache = null;
		this.economicCalendarLastRequestAt = null;
	}

	async saveSettings() {
		await this.persistData();
	}

	async saveEconomicCalendarCache(cache: EconomicCalendarCache): Promise<void> {
		this.economicCalendarCache = cache;
		await this.persistData();
	}

	async markEconomicCalendarRequestAttempt(at: string): Promise<void> {
		this.economicCalendarLastRequestAt = at;
		await this.persistData();
	}

	private async persistData(): Promise<void> {
		this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
			const data: TraderJournalPluginData = {
				settings: this.settings,
				economicCalendarCache: this.economicCalendarCache,
				economicCalendarLastRequestAt: this.economicCalendarLastRequestAt,
			};
			await this.saveData(data);
		});
		await this.saveQueue;
	}
}

function isPluginData(value: unknown): value is Partial<TraderJournalPluginData> & { settings: unknown } {
	return isRecord(value) && 'settings' in value;
}

function normalizeEconomicCalendarCache(value: unknown): EconomicCalendarCache | null {
	if (!isRecord(value) || typeof value.weekKey !== 'string' || typeof value.fetchedAt !== 'string') {
		return null;
	}
	if (!Array.isArray(value.events)) {
		return null;
	}

	return value as unknown as EconomicCalendarCache;
}

function normalizeIsoDate(value: unknown): string | null {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
