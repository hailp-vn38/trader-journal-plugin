import { MarkdownRenderChild, Modal, normalizePath, setIcon, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from '../ui/TraderJournalModal';
import { getTranslator } from '../i18n';
import {
	formatDateTime,
	formatDuration,
	formatPrice,
	formatResult,
	formatRr,
	formatSide,
	formatTags,
	getHoldingMinutes,
	KNOWN_TRADE_FIELDS,
	normalizeTradeImages,
	parseTradeJson,
	stringifyValue,
} from './format';
import { TRADE_CODE_BLOCK_LANGUAGE } from './types';
import type { NormalizedTradeImage, TradeEntry, TradeJournalType } from './types';

interface DetailItem {
	label: string;
	value: string;
}

export function registerTradeBlockProcessor(plugin: TraderJournalPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		TRADE_CODE_BLOCK_LANGUAGE,
		(source, el, ctx) => {
			renderTradeBlock(plugin, source, el, ctx);
		},
	);
}

function renderTradeBlock(
	plugin: TraderJournalPlugin,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const { trade, error } = parseTradeJson(source);
	const tr = getTranslator(plugin.settings.language);

	if (!trade) {
		renderTradeError(el, error ?? 'Invalid trade block.', tr('error.invalidTradeBlock'));
		return;
	}

	const cardEl = el.createDiv({ cls: 'trader-journal-trade-card' });
	renderHeader(plugin, cardEl, trade, ctx);
	renderDetails(plugin, cardEl, trade);
	renderTags(cardEl, trade);
	renderImages(plugin, cardEl, trade, ctx);
	renderNotes(plugin, cardEl, trade);
	renderExtraFields(plugin, cardEl, trade);
}

function renderTradeError(el: HTMLElement, message: string, title: string): void {
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
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const headerEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__header' });
	const titleEl = headerEl.createDiv({ cls: 'trader-journal-trade-card__title' });
	const tr = getTranslator(plugin.settings.language);

	const symbol = stringifyValue(trade.symbol) || tr('storage.trade');
	const side = formatSide(trade.side, plugin.settings.language);
	const result = formatResult(trade.result, plugin.settings.language);
	const rr = formatRr(trade.rr);

	titleEl.createDiv({
		cls: 'trader-journal-trade-card__symbol',
		text: symbol,
	});

	const subtitleParts = [side, stringifyValue(trade.setup), stringifyValue(trade.timeframe)].filter(Boolean);
	titleEl.createDiv({
		cls: 'trader-journal-trade-card__subtitle',
		text: subtitleParts.join(' / '),
	});

	const headerMetaEl = headerEl.createDiv({ cls: 'trader-journal-trade-card__header-meta' });
	renderEditButton(plugin, headerMetaEl, trade, ctx);

	const badgesEl = headerMetaEl.createDiv({ cls: 'trader-journal-trade-card__badges' });
	if (result) {
		renderBadge(badgesEl, result, getResultModifierClass(trade.result));
	}
	if (rr) {
		renderBadge(badgesEl, rr, 'trader-journal-trade-badge--rr');
	}
}

function renderEditButton(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	if (!stringifyValue(trade.id) || !canEditTrade(plugin, trade, ctx.sourcePath)) {
		return;
	}

	const buttonEl = parentEl.createEl('button', {
		cls: 'trader-journal-trade-card__edit-button',
		attr: {
			type: 'button',
			'aria-label': getTranslator(plugin.settings.language)('modal.editTrade'),
			title: getTranslator(plugin.settings.language)('modal.editTrade'),
		},
	});
	const iconEl = buttonEl.createSpan({ attr: { 'aria-hidden': 'true' } });
	setIcon(iconEl, 'pencil');

	const child = new MarkdownRenderChild(buttonEl);
	child.registerDomEvent(buttonEl, 'click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		new TraderJournalModal(
			plugin.app,
			plugin,
			getTradeJournalType(plugin, trade, ctx.sourcePath),
			trade,
			ctx.sourcePath,
		).open();
	});
	ctx.addChild(child);
}

function canEditTrade(plugin: TraderJournalPlugin, trade: TradeEntry, sourcePath: string): boolean {
	return getTradeJournalType(plugin, trade, sourcePath) !== 'live' || getLiveTradeStatus(trade) !== 'closed';
}

function getLiveTradeStatus(trade: TradeEntry): 'open' | 'closed' {
	if (trade.status === 'open' || trade.status === 'closed') {
		return trade.status;
	}

	return stringifyValue(trade.closed_at) ? 'closed' : 'open';
}

function renderDetails(plugin: TraderJournalPlugin, parentEl: HTMLElement, trade: TradeEntry): void {
	const holdingTime = formatDuration(getHoldingMinutes(trade));
	const tr = getTranslator(plugin.settings.language);
	const detailItems: DetailItem[] = [
		{ label: tr('detail.side'), value: formatSide(trade.side, plugin.settings.language) },
		{ label: tr('detail.setup'), value: stringifyValue(trade.setup) },
		{ label: tr('detail.timeframe'), value: stringifyValue(trade.timeframe) },
		{ label: tr('detail.result'), value: formatResult(trade.result, plugin.settings.language) },
		{ label: tr('detail.rr'), value: formatRr(trade.rr) },
		{ label: tr('detail.entryPrice'), value: formatPrice(trade.entry_price) },
		{ label: tr('detail.stopLoss'), value: formatPrice(trade.stop_loss) },
		{ label: tr('detail.exitPrice'), value: formatPrice(trade.exit_price) },
		{ label: tr('detail.takeProfit'), value: formatPrice(trade.take_profit) },
		{ label: tr('detail.openedAt'), value: formatDateTime(trade.opened_at) },
		{ label: tr('detail.closedAt'), value: formatDateTime(trade.closed_at) },
		{ label: tr('detail.holdingTime'), value: holdingTime },
	].filter((item) => item.value);

	if (detailItems.length === 0) {
		return;
	}

	renderDetailGrid(parentEl, detailItems);
}

function renderTags(parentEl: HTMLElement, trade: TradeEntry): void {
	const tags = formatTags(trade.tags);
	if (tags.length === 0) {
		return;
	}

	const tagsEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__tags' });
	for (const tag of tags) {
		tagsEl.createSpan({
			cls: 'trader-journal-trade-tag',
			text: tag.startsWith('#') ? tag : `#${tag}`,
		});
	}
}

function renderImages(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const images = normalizeTradeImages(trade.images);
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

	if (source) {
		const imageButtonEl = figureEl.createDiv({
			cls: 'trader-journal-trade-image-button',
			attr: {
				role: 'button',
				tabindex: '0',
				'aria-label': tr('image.open', {
					label: label || tr('image.tradeImage', { index: index + 1 }),
				}),
			},
		});
		imageButtonEl.createEl('img', {
			attr: {
				src: source,
				alt: label || tr('image.tradeImage', { index: index + 1 }),
				loading: 'lazy',
			},
		});

		const child = new MarkdownRenderChild(imageButtonEl);
		child.registerDomEvent(imageButtonEl, 'click', () => {
			new TradeImageModal(plugin, source, label || tr('image.tradeImage', { index: index + 1 })).open();
		});
		child.registerDomEvent(imageButtonEl, 'keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}

			event.preventDefault();
			new TradeImageModal(plugin, source, label || tr('image.tradeImage', { index: index + 1 })).open();
		});
		ctx.addChild(child);
	} else {
		figureEl.createDiv({
			cls: 'trader-journal-trade-image__missing',
			text: tr('image.fileNotFound'),
		});
	}
}

class TradeImageModal extends Modal {
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

function renderNotes(plugin: TraderJournalPlugin, parentEl: HTMLElement, trade: TradeEntry): void {
	const notes = stringifyValue(trade.notes);
	if (!notes) {
		return;
	}

	const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: getTranslator(plugin.settings.language)('detail.notes'),
	});
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__notes',
		text: notes,
	});
}

function renderExtraFields(plugin: TraderJournalPlugin, parentEl: HTMLElement, trade: TradeEntry): void {
	const detailItems = Object.entries(trade)
		.filter(([key]) => !KNOWN_TRADE_FIELDS.has(key))
		.map(([key, value]) => ({
			label: key,
			value: stringifyValue(value),
		}))
		.filter((item) => item.value);

	if (detailItems.length === 0) {
		return;
	}

	const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: getTranslator(plugin.settings.language)('detail.additionalData'),
	});
	renderDetailGrid(sectionEl, detailItems);
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

function renderBadge(parentEl: HTMLElement, text: string, modifierClass: string): void {
	parentEl.createSpan({
		cls: ['trader-journal-trade-badge', modifierClass],
		text,
	});
}

function getResultModifierClass(value: unknown): string {
	const raw = stringifyValue(value).toLowerCase();
	const modifier = raw === 'win' || raw === 'loss' || raw === 'breakeven' ? raw : 'unknown';
	return `trader-journal-trade-badge--${modifier}`;
}

function getTradeJournalType(
	plugin: TraderJournalPlugin,
	trade: TradeEntry,
	sourcePath: string,
): TradeJournalType {
	if (trade.journal_type === 'live' || trade.journal_type === 'backtest') {
		return trade.journal_type;
	}

	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	return liveJournalFolder && sourcePath.startsWith(`${liveJournalFolder}/`) ? 'live' : 'backtest';
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
	const candidatePaths = getImageCandidatePaths(rawPath, sourcePath);

	for (const candidatePath of candidatePaths) {
		const abstractFile = plugin.app.vault.getAbstractFileByPath(candidatePath);
		if (abstractFile instanceof TFile) {
			return abstractFile;
		}
	}

	return null;
}

function getImageCandidatePaths(rawPath: string, sourcePath: string): string[] {
	const pathWithoutHash = rawPath.split('#')[0]?.trim() ?? '';
	const normalizedPath = normalizeVaultPath(pathWithoutHash);
	const sourceDir = getSourceDir(sourcePath);
	const candidates = [normalizedPath];

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
