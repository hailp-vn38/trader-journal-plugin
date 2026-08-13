import type { WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { getTranslator } from '../i18n';
import { Dashboard } from './Dashboard';

export const TRADER_JOURNAL_DASHBOARD_VIEW_TYPE = 'trader-journal-dashboard';
export const TRADER_JOURNAL_DASHBOARD_ICON = 'chart-no-axes-combined';

export function registerTraderJournalDashboardView(plugin: TraderJournalPlugin): void {
	plugin.registerView(
		TRADER_JOURNAL_DASHBOARD_VIEW_TYPE,
		(leaf) => new TraderJournalDashboardView(leaf, plugin),
	);
}

export async function openTraderJournalDashboard(plugin: TraderJournalPlugin): Promise<void> {
	let leaf = plugin.app.workspace.getLeavesOfType(TRADER_JOURNAL_DASHBOARD_VIEW_TYPE)[0];

	if (!leaf) {
		leaf = plugin.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: TRADER_JOURNAL_DASHBOARD_VIEW_TYPE,
			active: true,
		});
	}

	plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
}

class TraderJournalDashboardView extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: TraderJournalPlugin) {
		super(leaf);
		this.navigation = false;
		this.icon = TRADER_JOURNAL_DASHBOARD_ICON;
	}

	getViewType(): string {
		return TRADER_JOURNAL_DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return getTranslator(this.plugin.settings.language)('dashboard.title');
	}

	getIcon(): string {
		return TRADER_JOURNAL_DASHBOARD_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('trader-journal-dashboard-view');
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<Dashboard plugin={this.plugin} />
			</StrictMode>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.removeClass('trader-journal-dashboard-view');
		this.contentEl.empty();
	}
}
