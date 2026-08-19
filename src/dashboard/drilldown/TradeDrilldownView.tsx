import type { ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type TraderJournalPlugin from '../../main';
import { TRADE_REVIEW_MISTAKE_TAGS, TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS } from '../../trades/review';
import { getTranslator } from '../../i18n';
import { TradeDrilldown } from './TradeDrilldown';
import type { TradeDrilldownCriterion, TradeDrilldownQuery } from './types';

export const TRADE_DRILLDOWN_VIEW_TYPE = 'trader-journal-trade-drilldown';
const TRADE_DRILLDOWN_ICON = 'list-filter';
const DEFAULT_QUERY: TradeDrilldownQuery = {
	criterion: { kind: 'review-status', value: 'all-closed' },
	filters: { journalType: 'live', period: '30d', symbol: '' },
};

export function registerTradeDrilldownView(plugin: TraderJournalPlugin): void {
	plugin.registerView(
		TRADE_DRILLDOWN_VIEW_TYPE,
		(leaf) => new TradeDrilldownView(leaf, plugin),
	);
}

export async function openTradeDrilldown(
	plugin: TraderJournalPlugin,
	query: TradeDrilldownQuery,
): Promise<void> {
	let leaf = plugin.app.workspace.getLeavesOfType(TRADE_DRILLDOWN_VIEW_TYPE)[0];
	if (!leaf) {
		leaf = plugin.app.workspace.getLeaf('tab');
	}
	await leaf.setViewState({
		type: TRADE_DRILLDOWN_VIEW_TYPE,
		active: true,
		state: { query },
	});

	plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
}

class TradeDrilldownView extends ItemView {
	private root: Root | null = null;
	private query = DEFAULT_QUERY;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: TraderJournalPlugin) {
		super(leaf);
		this.navigation = false;
		this.icon = TRADE_DRILLDOWN_ICON;
	}

	getViewType(): string {
		return TRADE_DRILLDOWN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return getTranslator(this.plugin.settings.language)('drilldown.displayText');
	}

	getIcon(): string {
		return TRADE_DRILLDOWN_ICON;
	}

	getState(): Record<string, unknown> {
		return { query: this.query };
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		this.query = readQuery(state) ?? DEFAULT_QUERY;
		this.renderView();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('trader-journal-drilldown-view');
		this.root = createRoot(this.contentEl);
		this.renderView();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.removeClass('trader-journal-drilldown-view');
		this.contentEl.empty();
	}

	private renderView(): void {
		this.root?.render(
			<StrictMode>
				<TradeDrilldown plugin={this.plugin} query={this.query} />
			</StrictMode>,
		);
	}
}

function readQuery(state: unknown): TradeDrilldownQuery | null {
	if (!isRecord(state) || !isRecord(state.query)) {
		return null;
	}
	const { criterion, filters } = state.query;
	if (!isRecord(criterion) || !isCriterion(criterion) || !isRecord(filters)) {
		return null;
	}
	const periods = ['today', 'yesterday', '7d', '30d', 'month', 'custom', 'all'] as const;
	if (!periods.includes(filters.period as typeof periods[number]) || typeof filters.symbol !== 'string') {
		return null;
	}
	const dateFrom = readDate(filters.dateFrom);
	const dateTo = readDate(filters.dateTo);
	return {
		criterion,
		filters: {
			journalType: 'live',
			period: filters.period as typeof periods[number],
			symbol: filters.symbol,
			...(dateFrom ? { dateFrom } : {}),
			...(dateTo ? { dateTo } : {}),
		},
	};
}

function readDate(value: unknown): string | null {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isCriterion(value: Record<string, unknown>): value is TradeDrilldownCriterion {
	if (value.kind === 'review-status') {
		return value.value === 'reviewed' || value.value === 'unreviewed' || value.value === 'all-closed';
	}
	if (value.kind === 'mistake') {
		return TRADE_REVIEW_MISTAKE_TAGS.includes(value.value as never);
	}
	return value.kind === 'plan-adherence'
		&& TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS.includes(value.value as never);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
