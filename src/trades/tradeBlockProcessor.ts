import { MarkdownRenderChild, Modal, normalizePath, Notice, setIcon, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { TraderJournalModal } from '../ui/TraderJournalModal';
import { TradeReviewModal } from '../ui/TradeReviewModal';
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
import type {
	NormalizedTradeImage,
	TradeEntry,
	TradeJournalType,
	TradeReviewContext,
	TradeReviewEntryTiming,
	TradeReviewMistakeTag,
	TradeReviewPlanAdherence,
} from './types';
import { registerImageModalInteraction } from '../ui/imageModalInteraction';
import { getTradePlanById } from '../plans/storage';
import { isTradeReviewed, normalizeTradeReview } from './review';

interface DetailItem {
	label: string;
	value: string;
	modifierClass?: string;
	onSelect?: () => void;
	selectLabel?: string;
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
	renderDetails(plugin, cardEl, trade, ctx);
	renderTags(cardEl, trade);
	renderImages(plugin, cardEl, trade, ctx);
	renderNotes(plugin, cardEl, trade);
	renderReview(plugin, cardEl, trade);
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
	renderReviewButton(plugin, headerMetaEl, trade, ctx);

	const badgesEl = headerMetaEl.createDiv({ cls: 'trader-journal-trade-card__badges' });
	if (result) {
		renderBadge(badgesEl, result, getResultModifierClass(trade.result));
	}
	if (rr) {
		renderBadge(badgesEl, rr, 'trader-journal-trade-badge--rr');
	}
}

function renderReviewButton(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	if (
		!stringifyValue(trade.id) ||
		getTradeJournalType(plugin, trade, ctx.sourcePath) !== 'live' ||
		!stringifyValue(trade.closed_at)
	) {
		return;
	}

	const tr = getTranslator(plugin.settings.language);
	const buttonEl = parentEl.createEl('button', {
		cls: [
			'trader-journal-trade-card__edit-button',
			'trader-journal-trade-card__review-button',
			isTradeReviewed(trade) ? 'is-reviewed' : 'is-pending',
		].join(' '),
		attr: {
			type: 'button',
			'aria-label': tr('action.reviewTrade'),
			title: tr('action.reviewTrade'),
		},
	});
	const iconEl = buttonEl.createSpan({ attr: { 'aria-hidden': 'true' } });
	setIcon(iconEl, isTradeReviewed(trade) ? 'clipboard-check' : 'clipboard-pen');

	const child = new MarkdownRenderChild(buttonEl);
	child.registerDomEvent(buttonEl, 'click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		new TradeReviewModal(plugin.app, plugin, trade, ctx.sourcePath).open();
	});
	ctx.addChild(child);
}

function renderEditButton(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	if (!stringifyValue(trade.id)) {
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

function renderDetails(
	plugin: TraderJournalPlugin,
	parentEl: HTMLElement,
	trade: TradeEntry,
	ctx: MarkdownPostProcessorContext,
): void {
	const holdingTime = formatDuration(getHoldingMinutes(trade));
	const tr = getTranslator(plugin.settings.language);
	const isLiveTrade = getTradeJournalType(plugin, trade, ctx.sourcePath) === 'live';
	const status = stringifyValue(trade.closed_at) ? 'closed' : 'open';
	const planId = stringifyValue(trade.plan_id);
	const detailItems: DetailItem[] = [
		{
			label: tr('detail.plan'),
			value: planId,
			modifierClass: isLiveTrade ? 'trader-journal-trade-detail--plan' : undefined,
			onSelect: isLiveTrade && planId ? () => void openLinkedPlan(plugin, planId, ctx.sourcePath) : undefined,
			selectLabel: planId ? tr('plan.openLinked', { plan: planId }) : undefined,
		},
		...(isLiveTrade
			? [{
				label: tr('detail.status'),
				value: tr(status === 'closed' ? 'option.closed' : 'option.open'),
				modifierClass: `trader-journal-trade-detail--status-${status}`,
			}]
			: []),
		{
			label: tr('detail.side'),
			value: formatSide(trade.side, plugin.settings.language),
			modifierClass: isLiveTrade
				? `trader-journal-trade-detail--side-${trade.side === 'short' ? 'short' : 'long'}`
				: undefined,
		},
		{ label: tr('detail.setup'), value: stringifyValue(trade.setup) },
		{ label: tr('detail.timeframe'), value: stringifyValue(trade.timeframe) },
		{
			label: tr('detail.result'),
			value: formatResult(trade.result, plugin.settings.language),
			modifierClass: isLiveTrade ? getResultDetailClass(trade.result) : undefined,
		},
		{
			label: tr('detail.rr'),
			value: formatRr(trade.rr),
			modifierClass: isLiveTrade ? getRrDetailClass(trade.rr) : undefined,
		},
		{
			label: tr('detail.entryPrice'),
			value: formatPrice(trade.entry_price),
			modifierClass: isLiveTrade ? 'trader-journal-trade-detail--entry' : undefined,
		},
		{
			label: tr('detail.stopLoss'),
			value: formatPrice(trade.stop_loss),
			modifierClass: isLiveTrade ? 'trader-journal-trade-detail--stop-loss' : undefined,
		},
		{
			label: tr('detail.exitPrice'),
			value: formatPrice(trade.exit_price),
			modifierClass: isLiveTrade ? 'trader-journal-trade-detail--exit' : undefined,
		},
		{
			label: tr('detail.takeProfit'),
			value: formatPrice(trade.take_profit),
			modifierClass: isLiveTrade ? 'trader-journal-trade-detail--take-profit' : undefined,
		},
		{ label: tr('detail.openedAt'), value: formatDateTime(trade.opened_at) },
		{ label: tr('detail.closedAt'), value: formatDateTime(trade.closed_at) },
		{ label: tr('detail.holdingTime'), value: holdingTime },
	].filter((item) => item.value);

	if (detailItems.length === 0) {
		return;
	}

	renderDetailGrid(parentEl, detailItems, ctx);
}

async function openLinkedPlan(plugin: TraderJournalPlugin, planId: string, sourcePath: string): Promise<void> {
	const tr = getTranslator(plugin.settings.language);
	try {
		const entry = await getTradePlanById(plugin, planId);
		if (!entry) {
			new Notice(tr('plan.linkedNotFound'));
			return;
		}

		await plugin.app.workspace.openLinkText(entry.filePath, sourcePath, false);
	} catch (error) {
		console.error('Trader Journal failed to open linked trade plan', error);
		new Notice(tr('calendar.openPlanNoteError'));
	}
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
			() => new TradeImageModal(plugin, source, imageLabel).open(),
		);
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

function renderReview(plugin: TraderJournalPlugin, parentEl: HTMLElement, trade: TradeEntry): void {
	const review = normalizeTradeReview(trade.review);
	if (!review) {
		return;
	}

	const tr = getTranslator(plugin.settings.language);
	const sectionEl = parentEl.createDiv({
		cls: 'trader-journal-trade-card__section trader-journal-trade-review',
	});
	sectionEl.createDiv({
		cls: 'trader-journal-trade-card__section-title',
		text: tr('review.title'),
	});
	const detailItems: DetailItem[] = [
		review.context ? { label: tr('review.context'), value: tr(getReviewContextKey(review.context)) } : null,
		review.entry_timing
			? { label: tr('review.entryTiming'), value: tr(getReviewEntryTimingKey(review.entry_timing)) }
			: null,
		review.plan_adherence
			? { label: tr('review.planAdherence'), value: tr(getReviewPlanAdherenceKey(review.plan_adherence)) }
			: null,
		{ label: tr('review.reviewedAt'), value: formatDateTime(review.reviewed_at) },
	].filter((item): item is DetailItem => Boolean(item?.value));
	renderDetailGrid(sectionEl, detailItems);

	if (review.mistake_tags?.length) {
		const mistakesEl = sectionEl.createDiv({ cls: 'trader-journal-trade-review__mistakes' });
		mistakesEl.createDiv({ cls: 'trader-journal-trade-review__label', text: tr('review.mistakes') });
		const chipsEl = mistakesEl.createDiv({ cls: 'trader-journal-trade-review__chips' });
		for (const mistake of review.mistake_tags) {
			chipsEl.createSpan({ text: tr(getReviewMistakeKey(mistake)) });
		}
	}

	renderReviewText(sectionEl, tr('review.whatWentWell'), review.what_went_well);
	renderReviewText(sectionEl, tr('review.lesson'), review.lesson);
	renderReviewText(sectionEl, tr('review.nextAction'), review.next_action);
}

function renderReviewText(parentEl: HTMLElement, label: string, value: string | undefined): void {
	if (!value) {
		return;
	}
	const itemEl = parentEl.createDiv({ cls: 'trader-journal-trade-review__text' });
	itemEl.createDiv({ cls: 'trader-journal-trade-review__label', text: label });
	itemEl.createDiv({ cls: 'trader-journal-trade-card__notes', text: value });
}

function getReviewContextKey(value: TradeReviewContext) {
	return `review.context.${value}` as const;
}

function getReviewEntryTimingKey(value: TradeReviewEntryTiming) {
	return `review.entryTiming.${value}` as const;
}

function getReviewPlanAdherenceKey(value: TradeReviewPlanAdherence) {
	return `review.planAdherence.${value}` as const;
}

function getReviewMistakeKey(value: TradeReviewMistakeTag) {
	return `review.mistake.${value}` as const;
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

function renderDetailGrid(
	parentEl: HTMLElement,
	detailItems: DetailItem[],
	ctx?: MarkdownPostProcessorContext,
): void {
	const gridEl = parentEl.createDiv({ cls: 'trader-journal-trade-details' });
	for (const item of detailItems) {
		const itemEl = gridEl.createDiv({
			cls: ['trader-journal-trade-detail', item.modifierClass].filter(Boolean).join(' '),
		});
		itemEl.createDiv({
			cls: 'trader-journal-trade-detail__label',
			text: item.label,
		});
		if (item.onSelect && ctx) {
			const buttonEl = itemEl.createEl('button', {
				cls: 'trader-journal-trade-detail__value trader-journal-trade-detail__link',
				text: item.value,
				attr: {
					type: 'button',
					'aria-label': item.selectLabel ?? item.value,
					title: item.value,
				},
			});
			const child = new MarkdownRenderChild(buttonEl);
			child.registerDomEvent(buttonEl, 'click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				item.onSelect?.();
			});
			ctx.addChild(child);
		} else {
			itemEl.createDiv({
				cls: 'trader-journal-trade-detail__value',
				text: item.value,
			});
		}
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

function getResultDetailClass(value: unknown): string {
	const result = stringifyValue(value).toLowerCase();
	return result === 'win' || result === 'loss' || result === 'breakeven'
		? `trader-journal-trade-detail--result-${result}`
		: '';
}

function getRrDetailClass(value: unknown): string {
	const rr = Number(value);
	if (!Number.isFinite(rr)) {
		return '';
	}

	return `trader-journal-trade-detail--rr-${rr > 0 ? 'positive' : rr < 0 ? 'negative' : 'neutral'}`;
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
