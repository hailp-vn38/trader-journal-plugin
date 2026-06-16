import { MarkdownRenderChild, Modal, normalizePath, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TraderJournalPlugin from '../main';
import {
	formatDateTime,
	formatDuration,
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
import type { NormalizedTradeImage, TradeEntry } from './types';

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

	if (!trade) {
		renderTradeError(el, error ?? 'Invalid trade block.');
		return;
	}

	const cardEl = el.createDiv({ cls: 'trader-journal-trade-card' });
	renderHeader(cardEl, trade);
	renderDetails(cardEl, trade);
	renderTags(cardEl, trade);
	renderImages(plugin, cardEl, trade, ctx);
	renderNotes(cardEl, trade);
	renderExtraFields(cardEl, trade);
}

function renderTradeError(el: HTMLElement, message: string): void {
	const errorEl = el.createDiv({ cls: 'trader-journal-trade-error' });
	errorEl.createDiv({
		cls: 'trader-journal-trade-error__title',
		text: 'Invalid Trader Journal trade block',
	});
	errorEl.createEl('code', { text: message });
}

function renderHeader(parentEl: HTMLElement, trade: TradeEntry): void {
	const headerEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__header' });
	const titleEl = headerEl.createDiv({ cls: 'trader-journal-trade-card__title' });

	const symbol = stringifyValue(trade.symbol) || 'Trade';
	const side = formatSide(trade.side);
	const result = formatResult(trade.result);
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

	const badgesEl = headerEl.createDiv({ cls: 'trader-journal-trade-card__badges' });
	if (result) {
		renderBadge(badgesEl, result, getResultModifierClass(trade.result));
	}
	if (rr) {
		renderBadge(badgesEl, rr, 'trader-journal-trade-badge--rr');
	}
}

function renderDetails(parentEl: HTMLElement, trade: TradeEntry): void {
	const holdingTime = formatDuration(getHoldingMinutes(trade));
	const detailItems: DetailItem[] = [
		{ label: 'Side', value: formatSide(trade.side) },
		{ label: 'Setup', value: stringifyValue(trade.setup) },
		{ label: 'Timeframe', value: stringifyValue(trade.timeframe) },
		{ label: 'Result', value: formatResult(trade.result) },
		{ label: 'RR', value: formatRr(trade.rr) },
		{ label: 'Opened at', value: formatDateTime(trade.opened_at) },
		{ label: 'Closed at', value: formatDateTime(trade.closed_at) },
		{ label: 'Holding time', value: holdingTime },
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
		text: 'Images',
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

	if (image.type === 'url' && !plugin.settings.allowRemoteImages) {
		figureEl.createDiv({
			cls: 'trader-journal-trade-image__missing',
			text: 'Remote image previews are disabled',
		});
		return;
	}

	if (source) {
		const imageButtonEl = figureEl.createDiv({
			cls: 'trader-journal-trade-image-button',
			attr: {
				role: 'button',
				tabindex: '0',
				'aria-label': `Open ${label || `trade image ${index + 1}`}`,
			},
		});
		imageButtonEl.createEl('img', {
			attr: {
				src: source,
				alt: label || `Trade image ${index + 1}`,
				loading: 'lazy',
			},
		});

		const child = new MarkdownRenderChild(imageButtonEl);
		child.registerDomEvent(imageButtonEl, 'click', () => {
			new TradeImageModal(plugin, source, label || `Trade image ${index + 1}`).open();
		});
		child.registerDomEvent(imageButtonEl, 'keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}

			event.preventDefault();
			new TradeImageModal(plugin, source, label || `Trade image ${index + 1}`).open();
		});
		ctx.addChild(child);
	} else {
		figureEl.createDiv({
			cls: 'trader-journal-trade-image__missing',
			text: 'Image file not found',
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

function renderNotes(parentEl: HTMLElement, trade: TradeEntry): void {
	const notes = stringifyValue(trade.notes);
	if (!notes) {
		return;
	}

	const sectionEl = parentEl.createDiv({ cls: 'trader-journal-trade-card__section' });
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: 'Notes',
	});
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__notes',
		text: notes,
	});
}

function renderExtraFields(parentEl: HTMLElement, trade: TradeEntry): void {
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
		text: 'Additional data',
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
