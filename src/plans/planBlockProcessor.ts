import { MarkdownRenderChild, Modal, normalizePath, Notice, setIcon, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { getTranslator } from '../i18n';
import { normalizeTradeImages, stringifyValue } from '../trades/format';
import type { NormalizedTradeImage } from '../trades/types';
import { TradePlanModal } from '../ui/TradePlanModal';
import { registerImageModalInteraction } from '../ui/imageModalInteraction';
import { PLAN_CODE_BLOCK_LANGUAGE } from './types';
import type { TradePlanEntry, TradePlanStatus } from './types';
import { normalizeLinkedTrades, normalizePlanEndDate, normalizePlanStatus, parsePlanJson } from './storage';

interface DetailItem {
	label: string;
	value: string;
}

export function registerPlanBlockProcessor(plugin: TraderJournalPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		PLAN_CODE_BLOCK_LANGUAGE,
		(source, el, ctx) => {
			renderPlanBlock(plugin, source, el, ctx);
		},
	);
}

function renderPlanBlock(
	plugin: TraderJournalPlugin,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const { plan, error } = parsePlanJson(source);
	const tr = getTranslator(plugin.settings.language);

	if (!plan) {
		renderPlanError(el, error ?? 'Invalid plan block.', tr('error.invalidPlanBlock'));
		return;
	}

	const cardEl = el.createDiv({ cls: 'trader-journal-plan-card' });
	renderHeader(plugin, cardEl, plan, ctx);
	renderDetails(plugin, cardEl, plan);
	renderTextSections(plugin, cardEl, plan);
	renderImages(plugin, cardEl, plan, ctx);
	renderLinkedTrades(plugin, cardEl, plan, ctx);
}

function renderPlanError(el: HTMLElement, message: string, title: string): void {
	const errorEl = el.createDiv({ cls: 'trader-journal-trade-error' });
	errorEl.createDiv({
		cls: 'trader-journal-trade-error__title',
		text: title,
	});
	errorEl.createEl('code', { text: message });
}

function renderHeader(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	plan: TradePlanEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const tr = getTranslator(plugin.settings.language);
	const headerEl = parentEl.createDiv({ cls: 'trader-journal-plan-card__header' });
	const titleEl = headerEl.createDiv({ cls: 'trader-journal-plan-card__title' });
	const title = stringifyValue(plan.title) || tr('storage.plan');
	const symbol = stringifyValue(plan.symbol);

	titleEl.createDiv({
		cls: 'trader-journal-plan-card__name',
		text: title,
	});
	titleEl.createDiv({
		cls: 'trader-journal-plan-card__subtitle',
		text: [symbol, stringifyValue(plan.setup)].filter(Boolean).join(' / '),
	});

	const headerMetaEl = headerEl.createDiv({ cls: 'trader-journal-plan-card__header-meta' });
	renderEditButton(plugin, headerMetaEl, plan, ctx);
	renderPlanBadge(headerMetaEl, getPlanStatusLabel(plugin, normalizePlanStatus(plan.status)), normalizePlanStatus(plan.status));
}

function renderEditButton(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	plan: TradePlanEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	if (!stringifyValue(plan.id)) {
		return;
	}

	const buttonEl = parentEl.createEl('button', {
		cls: 'trader-journal-trade-card__edit-button',
		attr: {
			type: 'button',
			'aria-label': getTranslator(plugin.settings.language)('modal.editTradePlan'),
			title: getTranslator(plugin.settings.language)('modal.editTradePlan'),
		},
	});
	const iconEl = buttonEl.createSpan({ attr: { 'aria-hidden': 'true' } });
	setIcon(iconEl, 'pencil');

	const child = new MarkdownRenderChild(buttonEl);
	child.registerDomEvent(buttonEl, 'click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		new TradePlanModal(plugin.app, plugin, plan, ctx.sourcePath).open();
	});
	ctx.addChild(child);
}

function renderDetails(plugin: TraderJournalPlugin, parentEl: HTMLElement, plan: TradePlanEntry): void {
	const tr = getTranslator(plugin.settings.language);
	const endDate = normalizePlanEndDate(plan.end_date);
	const detailItems: DetailItem[] = [
		{ label: tr('detail.status'), value: getPlanStatusLabel(plugin, normalizePlanStatus(plan.status)) },
		{ label: tr('detail.bias'), value: getPlanBiasLabel(plugin, plan.bias) },
		{ label: tr('detail.dateRange'), value: [stringifyValue(plan.start_date), endDate].filter(Boolean).join(' - ') },
		{ label: tr('detail.setup'), value: stringifyValue(plan.setup) },
		{ label: tr('detail.timeframe'), value: formatTimeframes(plan.timeframes) },
	].filter((item) => item.value);

	if (detailItems.length === 0) {
		return;
	}

	renderDetailGrid(parentEl, detailItems);
}

function renderTextSections(plugin: TraderJournalPlugin, parentEl: HTMLElement, plan: TradePlanEntry): void {
	const tr = getTranslator(plugin.settings.language);
	const sections = [
		{ title: tr('detail.entryPlan'), value: stringifyValue(plan.entry_plan) },
		{ title: tr('detail.invalidation'), value: stringifyValue(plan.invalidation) },
		{ title: tr('detail.takeProfitPlan'), value: stringifyValue(plan.take_profit_plan) },
		{ title: tr('detail.riskNotes'), value: stringifyValue(plan.risk_notes) },
		{ title: tr('detail.notes'), value: stringifyValue(plan.notes) },
	];

	for (const section of sections) {
		if (!section.value) {
			continue;
		}

		const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
		sectionEl.createDiv({
			cls: 'trader-journal-trade-card__section-title',
			text: section.title,
		});
		sectionEl.createDiv({
			cls: 'trader-journal-trade-card__notes',
			text: section.value,
		});
	}
}

function renderImages(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	plan: TradePlanEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const images = normalizeTradeImages(plan.images);
	if (images.length === 0) {
		return;
	}

	const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: getTranslator(plugin.settings.language)('detail.images'),
	});

	const imageGridEl = sectionEl.createDiv({ cls: 'trader-journal-trade-images' });
	images.forEach((image, index) => {
		renderImage(plugin, imageGridEl, image, ctx, index);
	});
}

function renderImage(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	image: NormalizedTradeImage,
	ctx: MarkdownPostProcessorContext,
	index: number,
): void {
	const figureEl = parentEl.createEl('figure', { cls: 'trader-journal-trade-image' });
	const source = resolveImageSource(plugin, image, ctx.sourcePath);
	const label = image.label ?? image.value;
	const tr = getTranslator(plugin.settings.language);

	if (image.type === 'url' && !plugin.settings.allowRemoteImages) {
		figureEl.createDiv({
			cls: 'trader-journal-trade-image__missing',
			text: tr('image.remotePreviewDisabled'),
		});
		return;
	}

	if (!source) {
		figureEl.createDiv({
			cls: 'trader-journal-trade-image__missing',
			text: tr('image.fileNotFound'),
		});
		return;
	}

	const imageButtonEl = figureEl.createDiv({
		cls: 'trader-journal-trade-image-button',
	});
	imageButtonEl.createEl('img', {
		attr: {
			src: source,
			alt: label || tr('image.tradeImage', { index: index + 1 }),
			loading: 'lazy',
		},
	});

	const imageLabel = label || tr('image.tradeImage', { index: index + 1 });
	registerImageModalInteraction(
		plugin,
		imageButtonEl,
		ctx,
		tr('image.open', { label: imageLabel }),
		() => new PlanImageModal(plugin, source, imageLabel).open(),
	);
}

function renderLinkedTrades(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	plan: TradePlanEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const linkedTrades = normalizeLinkedTrades(plan.linked_trades);
	if (linkedTrades.length === 0) {
		return;
	}

	const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: getTranslator(plugin.settings.language)('detail.linkedTrades'),
	});

	const listEl = sectionEl.createEl('ul', { cls: 'trader-journal-plan-linked-trades__list' });
	for (const tradeRef of linkedTrades) {
		const itemEl = listEl.createEl('li');
		const label = tradeRef.label || tradeRef.trade_id || tradeRef.file_path || '';
		const filePath = stringifyValue(tradeRef.file_path);
		if (!filePath) {
			itemEl.setText(label);
			continue;
		}

		const buttonEl = itemEl.createEl('button', {
			cls: 'trader-journal-plan-linked-trade-button',
			text: label,
			attr: {
				type: 'button',
				title: label,
			},
		});
		const child = new MarkdownRenderChild(buttonEl);
		child.registerDomEvent(buttonEl, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void openLinkedTrade(plugin, filePath, ctx.sourcePath);
		});
		ctx.addChild(child);
	}
}

async function openLinkedTrade(
	plugin: TraderJournalPlugin,
	filePath: string,
	sourcePath: string,
): Promise<void> {
	try {
		await plugin.app.workspace.openLinkText(filePath, sourcePath, false);
	} catch (error) {
		console.error('Trader Journal failed to open linked trade', error);
		new Notice(getTranslator(plugin.settings.language)('calendar.openTradeNoteError'));
	}
}

class PlanImageModal extends Modal {
	private readonly source: string;
	private readonly label: string;

	constructor(plugin: TraderJournalPlugin, source: string, label: string) {
		super(plugin.app);
		this.source = source;
		this.label = label;
	}

	onOpen(): void {
		this.modalEl.addClass('trader-journal-image-modal-shell');
		this.titleEl.setText(this.label);
		this.contentEl.addClass('trader-journal-image-modal-content');
		this.contentEl.empty();

		const frameEl = this.contentEl.createDiv({ cls: 'trader-journal-image-modal-frame' });
		frameEl.createEl('img', {
			attr: {
				src: this.source,
				alt: this.label,
			},
		});
	}

	onClose(): void {
		this.modalEl.removeClass('trader-journal-image-modal-shell');
		this.contentEl.removeClass('trader-journal-image-modal-content');
		this.contentEl.empty();
	}
}

function renderDetailGrid(parentEl: HTMLElement, detailItems: DetailItem[]): void {
	const gridEl = parentEl.createDiv({ cls: 'trader-journal-trade-details' });
	for (const item of detailItems) {
		const itemEl = gridEl.createDiv({ cls: 'trader-journal-trade-detail' });
		itemEl.createDiv({
			cls: 'trader-journal-trade-detail__label',
			text: item.label,
		});
		itemEl.createDiv({
			cls: 'trader-journal-trade-detail__value',
			text: item.value,
		});
	}
}

function renderPlanBadge(parentEl: HTMLElement, text: string, status: TradePlanStatus): void {
	parentEl.createSpan({
		cls: ['trader-journal-plan-badge', `trader-journal-plan-badge--${status}`],
		text,
	});
}

function getPlanStatusLabel(plugin: TraderJournalPlugin, status: TradePlanStatus): string {
	const tr = getTranslator(plugin.settings.language);
	if (status === 'closed') {
		return tr('option.closed');
	}

	if (status === 'cancelled') {
		return tr('option.cancelled');
	}

	return tr('option.open');
}

function getPlanBiasLabel(plugin: TraderJournalPlugin, value: unknown): string {
	const tr = getTranslator(plugin.settings.language);
	if (value === 'long') {
		return tr('option.long');
	}

	if (value === 'short') {
		return tr('option.short');
	}

	if (value === 'neutral') {
		return tr('option.neutral');
	}

	return '';
}

function formatTimeframes(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
	}

	return stringifyValue(value);
}

function resolveImageSource(
	plugin: TraderJournalPlugin,
	image: NormalizedTradeImage,
	sourcePath: string,
): string | null {
	if (image.type === 'url') {
		return plugin.settings.allowRemoteImages ? image.value : null;
	}

	const file = findVaultFile(plugin, image.value, sourcePath);
	return file ? plugin.app.vault.getResourcePath(file) : null;
}

function findVaultFile(
	plugin: TraderJournalPlugin,
	rawPath: string,
	sourcePath: string,
): TFile | null {
	const candidatePaths = getImageCandidatePaths(rawPath, sourcePath, plugin);

	for (const candidatePath of candidatePaths) {
		const abstractFile = plugin.app.vault.getAbstractFileByPath(candidatePath);
		if (abstractFile instanceof TFile) {
			return abstractFile;
		}
	}

	return null;
}

function getImageCandidatePaths(
	rawPath: string,
	sourcePath: string,
	plugin: TraderJournalPlugin,
): string[] {
	const pathWithoutHash = rawPath.split('#')[0]?.trim() ?? '';
	const normalizedPath = normalizeVaultPath(pathWithoutHash);
	const sourceDir = getSourceDir(sourcePath);
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	const candidates = [
		normalizedPath,
		normalizePath(`${liveJournalFolder}/_attachments/${normalizedPath}`),
	];

	if (sourceDir && normalizedPath) {
		candidates.push(normalizePath(`${sourceDir}/${normalizedPath}`));
	}

	return [...new Set(candidates.filter(Boolean))];
}

function normalizeVaultPath(path: string): string {
	return normalizePath(path.replace(/^\/+/, ''));
}

function getSourceDir(sourcePath: string): string {
	const parts = sourcePath.split('/');
	parts.pop();
	return parts.join('/');
}
