import type { App } from 'obsidian';
import { Modal, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent, SyntheticEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { getTranslator } from '../i18n';
import type { Translator } from '../i18n';
import { formatDuration, normalizeTradeImages, stringifyValue } from '../trades/format';
import {
	calculateHoldingTime,
	createTradeId,
	saveTradeToDailyNote,
	updateTradeInJournalFile,
} from '../trades/storage';
import {
	linkTradeToPlan,
	listTradePlanOptions,
	unlinkTradeFromPlan,
} from '../plans/storage';
import type { TradePlanOption } from '../plans/types';
import type { LiveTradeStatus, TradeEntry, TradeImage, TradeJournalType, TradeResult, TradeSide } from '../trades/types';

const SIDE_OPTIONS: TradeSide[] = ['long', 'short'];
const RESULT_OPTIONS: TradeResult[] = ['loss', 'win', 'breakeven'];

interface TraderJournalModalContentProps {
	plugin: TraderJournalPlugin;
	journalType: TradeJournalType;
	initialTrade?: TradeEntry;
	targetFilePath?: string;
	closeModal: () => void;
}

interface TradeFormState {
	symbol: string;
	planId: string;
	status: LiveTradeStatus;
	side: TradeSide;
	setup: string;
	timeframe: string;
	result: TradeResult;
	rr: string;
	tags: string;
	entryPrice: string;
	stopLoss: string;
	exitPrice: string;
	takeProfit: string;
	images: TradeImage[];
	notes: string;
	openedAt: string;
	closedAt: string;
}

function TraderJournalModalContent({
	plugin,
	journalType,
	initialTrade,
	targetFilePath,
	closeModal,
}: TraderJournalModalContentProps) {
	const [form, setForm] = useState<TradeFormState>(() => createInitialForm(plugin, journalType, initialTrade));
	const [imageInput, setImageInput] = useState('');
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isPastingImage, setIsPastingImage] = useState(false);
	const [planOptions, setPlanOptions] = useState<TradePlanOption[]>([]);
	const createdAttachmentPathsRef = useRef<Set<string>>(new Set());
	const savedTradeRef = useRef(false);

	const holdingTime = useMemo(() => calculateHoldingTime(form.openedAt, form.closedAt), [form.openedAt, form.closedAt]);
	const liveRr = useMemo(
		() => calculateLiveRr(form.side, form.entryPrice, form.stopLoss, form.exitPrice),
		[form.entryPrice, form.exitPrice, form.side, form.stopLoss],
	);
	const isLiveJournal = journalType === 'live';
	const isEditing = Boolean(initialTrade && targetFilePath);
	const isLiveTradeClosed = !isLiveJournal || form.status === 'closed';
	const tr = getTranslator(plugin.settings.language);

	useEffect(
		() => () => {
			if (!savedTradeRef.current) {
				cleanupCreatedAttachments(plugin, createdAttachmentPathsRef.current);
			}
		},
		[plugin],
	);

	useEffect(() => {
		if (!isLiveJournal) {
			return;
		}

		let disposed = false;
		const symbol = normalizeSymbol(form.symbol);
		const date = getDateTimeDatePart(form.openedAt) || getTodayDateInput();
		void listTradePlanOptions(plugin, {
			symbol,
			date,
			includePlanId: form.planId,
		})
			.then((options) => {
				if (!disposed) {
					setPlanOptions(options);
				}
			})
			.catch((loadError: unknown) => {
				console.error('Trader Journal failed to load trade plan options', loadError);
				if (!disposed) {
					setPlanOptions([]);
				}
			});

		return () => {
			disposed = true;
		};
	}, [form.openedAt, form.planId, form.symbol, isLiveJournal, plugin]);

	function updateField<K extends keyof TradeFormState>(field: K, value: TradeFormState[K]) {
		setForm((currentForm) => ({
			...currentForm,
			[field]: value,
		}));
	}

	function updateOpenedAt(openedAt: string) {
		setForm((currentForm) => ({
			...currentForm,
			openedAt,
			closedAt:
				journalType === 'backtest'
					? syncClosedAtDate(openedAt, currentForm.openedAt, currentForm.closedAt)
					: currentForm.closedAt,
		}));
	}

	function updateLiveStatus(status: LiveTradeStatus) {
		setForm((currentForm) => ({
			...currentForm,
			status,
			closedAt:
				status === 'closed' && !currentForm.closedAt ? getCurrentDateTimeLocalInput() : currentForm.closedAt,
		}));
	}

	const addImages = (images: TradeImage[]) => {
		setForm((currentForm) => {
			const existingImageValues = new Set(currentForm.images.map((image) => image.value).filter(Boolean));
			const nextImages = images.filter((image) => image.value && !existingImageValues.has(image.value));

			return {
				...currentForm,
				images: [...currentForm.images, ...nextImages],
			};
		});
	};

	const addImage = () => {
		const image = createTradeImage(imageInput);
		if (!image) {
			return;
		}

		if (form.images.some((item) => item.value === image.value)) {
			setImageInput('');
			return;
		}

		addImages([image]);
		setImageInput('');
	};

	const removeImage = (index: number) => {
		const image = form.images[index];
		if (image?.type === 'file' && image.value && createdAttachmentPathsRef.current.has(image.value)) {
			createdAttachmentPathsRef.current.delete(image.value);
			void deleteCreatedAttachment(plugin, image.value).catch((deleteError: unknown) => {
				console.error('Trader Journal failed to remove pasted image', deleteError);
			});
		}

		updateField(
			'images',
			form.images.filter((_, itemIndex) => itemIndex !== index),
		);
	};

	const handleImageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		addImage();
	};

	const handleImagePaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
		const imageFiles = getClipboardImageFiles(event.clipboardData);
		if (imageFiles.length === 0) {
			return;
		}

		event.preventDefault();
		void savePastedImages(imageFiles);
	};

	const savePastedImages = async (imageFiles: File[]) => {
		try {
			setIsPastingImage(true);
			setError('');
			const savedImages = await Promise.all(
				imageFiles.map((imageFile) => savePastedImage(plugin, imageFile, form.symbol, journalType)),
			);
			for (const image of savedImages) {
				if (image.type === 'file' && image.value) {
					createdAttachmentPathsRef.current.add(image.value);
				}
			}
			addImages(savedImages);
			setImageInput('');
		} catch (pasteError) {
			setError(pasteError instanceof Error ? pasteError.message : tr('error.pasteImage'));
		} finally {
			setIsPastingImage(false);
		}
	};

	const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving || isPastingImage) {
			return;
		}

		void saveTrade();
	};

	const saveTrade = async () => {
		const validationError = validateForm(form, journalType, tr);
		if (validationError) {
			setError(validationError);
			return;
		}

		const symbol = normalizeSymbol(form.symbol);
		const journalDate = getTodayDateInput();
		const openedAt = toLocalIsoString(form.openedAt);
		const closedAt = isLiveTradeClosed ? toLocalIsoString(form.closedAt) : '';
		const rr = isLiveJournal ? (isLiveTradeClosed ? (liveRr ?? 0) : 0) : Number(form.rr);
		const pendingImage = createTradeImage(imageInput);
		const images =
			pendingImage && !form.images.some((image) => image.value === pendingImage.value)
				? [...form.images, pendingImage]
				: form.images;
		const trade: TradeEntry = {
			schemaVersion: 1,
			id: stringifyValue(initialTrade?.id) || createTradeId(symbol, openedAt, journalDate),
			date: stringifyValue(initialTrade?.date) || getCurrentLocalIsoString(),
			journal_type: journalType,
			symbol,
			side: form.side,
			setup: form.setup.trim(),
			timeframe: form.timeframe,
			rr,
			images,
			notes: form.notes.trim(),
			opened_at: openedAt,
		};
		if (isLiveJournal && form.planId) {
			trade.plan_id = form.planId;
		}
		if (!isLiveJournal) {
			trade.result = form.result;
			trade.closed_at = closedAt;
			trade.holding_time = calculateHoldingTime(openedAt, closedAt);
			trade.tags = parseTags(form.tags);
		} else {
			trade.status = form.status;
			if (isLiveTradeClosed) {
				trade.result = form.result;
				trade.closed_at = closedAt;
				trade.exit_price = Number(form.exitPrice);
				trade.holding_time = calculateHoldingTime(openedAt, closedAt);
			}
			trade.entry_price = Number(form.entryPrice);
			trade.stop_loss = Number(form.stopLoss);
			trade.take_profit = Number(form.takeProfit);
		}

		try {
			setIsSaving(true);
			setError('');
			const file =
				isEditing && targetFilePath
					? await updateTradeInJournalFile(plugin, targetFilePath, trade)
					: await saveTradeToDailyNote(plugin, journalDate, trade);
			if (isLiveJournal) {
				await syncTradePlanLink(plugin, initialTrade, trade, file.path);
			}
			savedTradeRef.current = true;
			createdAttachmentPathsRef.current.clear();
			new Notice(tr(isEditing ? 'notice.updatedTrade' : 'notice.savedTrade', { path: file.path }));
			closeModal();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : tr('error.couldNotSaveTrade'));
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<h2>
				{isEditing
					? tr(isLiveJournal ? 'modal.editLiveTrade' : 'modal.editBacktestTrade')
					: isLiveJournal
						? tr('modal.addLiveTrade')
						: tr('modal.addBacktestTrade')}
			</h2>

			{error ? <div className="trader-journal-form__error">{error}</div> : null}

			<div className="trader-journal-form__grid">
				<label className="trader-journal-field">
					<span>{tr('detail.symbol')}</span>
					<select
						value={form.symbol}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('symbol', event.target.value)}
						required
					>
						<option value="">{tr('placeholder.selectSymbol')}</option>
						{plugin.settings.symbols.map((symbol) => (
							<option value={symbol} key={symbol}>
								{symbol}
							</option>
						))}
					</select>
				</label>

				{isLiveJournal ? (
					<label className="trader-journal-field">
						<span>{tr('detail.status')}</span>
						<select
							value={form.status}
							onChange={(event: ChangeEvent<HTMLSelectElement>) =>
								updateLiveStatus(event.target.value as LiveTradeStatus)
							}
						>
							<option value="open">{tr('option.open')}</option>
							<option value="closed">{tr('option.closed')}</option>
						</select>
					</label>
				) : null}

				{isLiveJournal ? (
					<label className="trader-journal-field">
						<span>{tr('detail.plan')}</span>
						<select
							value={form.planId}
							onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('planId', event.target.value)}
						>
							<option value="">{tr('placeholder.noPlan')}</option>
							{planOptions.map((plan) => (
								<option value={plan.id} key={plan.id}>
									{formatPlanOptionLabel(plan)}
								</option>
							))}
						</select>
					</label>
				) : null}

				<label className="trader-journal-field">
					<span>{tr('detail.side')}</span>
					<select
						value={form.side}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('side', event.target.value as TradeSide)}
					>
						{SIDE_OPTIONS.map((option) => (
							<option value={option} key={option}>
								{tr(option === 'long' ? 'option.long' : 'option.short')}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>{tr('detail.timeframe')}</span>
					<select
						value={form.timeframe}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('timeframe', event.target.value)}
						required
					>
						<option value="">{tr('placeholder.selectTimeframe')}</option>
						{plugin.settings.timeframes.map((timeframe) => (
							<option value={timeframe} key={timeframe}>
								{timeframe}
							</option>
						))}
					</select>
				</label>

				{isLiveJournal && !isLiveTradeClosed ? null : (
					<label className="trader-journal-field">
						<span>{tr('detail.result')}</span>
						<select
							value={form.result}
							onChange={(event: ChangeEvent<HTMLSelectElement>) =>
								updateField('result', event.target.value as TradeResult)
							}
						>
							{RESULT_OPTIONS.map((option) => (
								<option value={option} key={option}>
									{tr(getResultOptionKey(option))}
								</option>
							))}
						</select>
					</label>
				)}

				<label className="trader-journal-field">
					<span>{isLiveJournal ? tr('detail.entryPrice') : tr('detail.rr')}</span>
					{isLiveJournal ? (
						<input
							type="number"
							step="0.01"
							value={form.entryPrice}
							placeholder="100"
							onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('entryPrice', event.target.value)}
							required
						/>
					) : (
						<input
							type="number"
							step="0.01"
							value={form.rr}
							placeholder="2"
							onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('rr', event.target.value)}
							required
						/>
					)}
				</label>

				{isLiveJournal ? (
					<>
						<label className="trader-journal-field">
							<span>{tr('detail.stopLoss')}</span>
							<input
								type="number"
								step="0.01"
								value={form.stopLoss}
								placeholder="99"
								onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('stopLoss', event.target.value)}
								required
							/>
						</label>

							{isLiveTradeClosed ? (
								<label className="trader-journal-field">
									<span>{tr('detail.exitPrice')}</span>
									<input
										type="number"
										step="0.01"
										value={form.exitPrice}
										placeholder="102"
										onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('exitPrice', event.target.value)}
										required
									/>
								</label>
							) : null}

						<label className="trader-journal-field">
							<span>{tr('detail.takeProfit')}</span>
							<input
								type="number"
								step="0.01"
								value={form.takeProfit}
								placeholder="104"
								onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('takeProfit', event.target.value)}
								required
							/>
						</label>
					</>
				) : null}

				<label className="trader-journal-field">
					<span>{tr('detail.openedAt')}</span>
					<input
						type="datetime-local"
						value={form.openedAt}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateOpenedAt(event.target.value)}
						required
					/>
				</label>

				{isLiveJournal && !isLiveTradeClosed ? null : (
					<label className="trader-journal-field">
						<span>{tr('detail.closedAt')}</span>
						<input
							type="datetime-local"
							value={form.closedAt}
							onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('closedAt', event.target.value)}
							required
						/>
					</label>
				)}

				<div className="trader-journal-field trader-journal-field--readonly">
					<span>{tr('detail.holdingTime')}</span>
					<strong>{formatDuration(holdingTime) || '-'}</strong>
				</div>

				{isLiveJournal ? (
					<div className="trader-journal-field trader-journal-field--readonly">
						<span>RR</span>
						<strong>{!isLiveTradeClosed || liveRr === null ? '-' : `${formatComputedRr(liveRr)}R`}</strong>
					</div>
				) : null}
			</div>

			<label className="trader-journal-field">
				<span>{tr('detail.setup')}</span>
				<input
					type="text"
					value={form.setup}
					placeholder={tr('placeholder.openingRangeBreakout')}
					onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('setup', event.target.value)}
					required
				/>
			</label>

			{isLiveJournal ? null : (
				<label className="trader-journal-field">
					<span>{tr('detail.tags')}</span>
					<input
						type="text"
						value={form.tags}
						placeholder={tr('placeholder.tags')}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('tags', event.target.value)}
					/>
				</label>
			)}

			<div className="trader-journal-field trader-journal-field--images">
				<span>{tr('detail.images')}</span>
				<input
					type="text"
					value={imageInput}
					placeholder={isPastingImage ? tr('placeholder.savingImage') : tr('placeholder.image')}
					onChange={(event: ChangeEvent<HTMLInputElement>) => setImageInput(event.target.value)}
					onKeyDown={handleImageInputKeyDown}
					onPaste={handleImagePaste}
					disabled={isPastingImage}
				/>
				{form.images.length > 0 ? (
					<div className="trader-journal-image-preview-row">
						{form.images.map((image, index) => (
							<div className="trader-journal-image-preview" key={`${image.value}-${index}`}>
								<button
									type="button"
									className="trader-journal-image-preview__remove"
									aria-label={tr('image.remove', { index: index + 1 })}
									onClick={() => removeImage(index)}
								>
									X
								</button>
								<ImagePreview plugin={plugin} image={image} />
							</div>
						))}
					</div>
				) : null}
			</div>

			<label className="trader-journal-field">
				<span>{tr('detail.notes')}</span>
				<textarea
					value={form.notes}
					rows={4}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('notes', event.target.value)}
				/>
			</label>

			<div className="trader-journal-form__actions">
				<button type="button" onClick={closeModal} disabled={isSaving || isPastingImage}>
					{tr('action.cancel')}
				</button>
				<button type="submit" className="mod-cta" disabled={isSaving || isPastingImage}>
					{isSaving ? tr('action.saving') : isEditing ? tr('action.updateTrade') : tr('action.saveTrade')}
				</button>
			</div>
		</form>
	);
}

export class TraderJournalModal extends Modal {
	private readonly plugin: TraderJournalPlugin;
	private readonly journalType: TradeJournalType;
	private readonly initialTrade: TradeEntry | undefined;
	private readonly targetFilePath: string | undefined;
	private root: Root | null = null;

	constructor(
		app: App,
		plugin: TraderJournalPlugin,
		journalType: TradeJournalType = 'backtest',
		initialTrade?: TradeEntry,
		targetFilePath?: string,
	) {
		super(app);
		this.plugin = plugin;
		this.journalType = journalType;
		this.initialTrade = initialTrade;
		this.targetFilePath = targetFilePath;
	}

	onOpen() {
		this.titleEl.empty();
		this.modalEl.addClass('trader-journal-modal-shell');
		this.contentEl.addClass('trader-journal-modal-content');
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TraderJournalModalContent
					plugin={this.plugin}
					journalType={this.journalType}
					initialTrade={this.initialTrade}
					targetFilePath={this.targetFilePath}
					closeModal={() => this.close()}
				/>
			</StrictMode>,
		);
	}

	onClose() {
		this.root?.unmount();
		this.root = null;
		this.modalEl.removeClass('trader-journal-modal-shell');
		this.contentEl.removeClass('trader-journal-modal-content');
		this.contentEl.empty();
	}
}

function createInitialForm(
	plugin: TraderJournalPlugin,
	journalType: TradeJournalType,
	initialTrade: TradeEntry | undefined,
): TradeFormState {
	const isLiveJournal = journalType === 'live';
	const status = getInitialLiveStatus(initialTrade);

	return {
		symbol: stringifyValue(initialTrade?.symbol) || plugin.settings.symbols[0] || '',
		planId: stringifyValue(initialTrade?.plan_id),
		status,
		side: initialTrade?.side === 'short' ? 'short' : 'long',
		setup: stringifyValue(initialTrade?.setup),
		timeframe: stringifyValue(initialTrade?.timeframe) || plugin.settings.timeframes[0] || '',
		result: initialTrade?.result ?? 'win',
		rr: stringifyValue(initialTrade?.rr),
		tags: stringifyValue(initialTrade?.tags),
		entryPrice: stringifyValue(initialTrade?.entry_price),
		stopLoss: stringifyValue(initialTrade?.stop_loss),
		exitPrice: stringifyValue(initialTrade?.exit_price),
		takeProfit: stringifyValue(initialTrade?.take_profit),
		images: normalizeTradeImages(initialTrade?.images),
		notes: stringifyValue(initialTrade?.notes),
		openedAt: toDateTimeLocalInput(initialTrade?.opened_at),
		closedAt: isLiveJournal && status === 'open' ? '' : toDateTimeLocalInput(initialTrade?.closed_at),
	};
}

function getInitialLiveStatus(initialTrade: TradeEntry | undefined): LiveTradeStatus {
	if (initialTrade?.status === 'open' || initialTrade?.status === 'closed') {
		return initialTrade.status;
	}

	return stringifyValue(initialTrade?.closed_at) ? 'closed' : 'open';
}

async function syncTradePlanLink(
	plugin: TraderJournalPlugin,
	initialTrade: TradeEntry | undefined,
	trade: TradeEntry,
	filePath: string,
): Promise<void> {
	const previousPlanId = stringifyValue(initialTrade?.plan_id);
	const nextPlanId = stringifyValue(trade.plan_id);
	const tradeId = stringifyValue(trade.id);

	if (previousPlanId && previousPlanId !== nextPlanId) {
		await unlinkTradeFromPlan(plugin, previousPlanId, tradeId);
	}

	if (!nextPlanId) {
		return;
	}

	await linkTradeToPlan(plugin, nextPlanId, {
		trade_id: tradeId,
		file_path: filePath,
		label: createTradePlanLinkLabel(trade),
	});
}

function createTradePlanLinkLabel(trade: TradeEntry): string {
	const openedAt = stringifyValue(trade.opened_at);
	const time = openedAt ? openedAt.slice(11, 16) : '';
	return [stringifyValue(trade.symbol), time, stringifyValue(trade.side), stringifyValue(trade.setup)]
		.filter(Boolean)
		.join(' / ');
}

function formatPlanOptionLabel(plan: TradePlanOption): string {
	const endDate = plan.endDate ? ` - ${plan.endDate}` : '';
	return `${plan.symbol} / ${plan.title} / ${plan.startDate}${endDate}`;
}

function validateForm(form: TradeFormState, journalType: TradeJournalType, tr: Translator): string | null {
	if (!normalizeSymbol(form.symbol)) {
		return tr('error.symbolRequired');
	}

	if (!form.timeframe) {
		return tr('error.timeframeRequired');
	}

	if (!form.setup.trim()) {
		return tr('error.setupRequired');
	}

	const rr = Number(form.rr);
	if (journalType === 'backtest' && !Number.isFinite(rr)) {
		return tr('error.rrNumber');
	}

	if (journalType === 'live') {
		const isClosed = form.status === 'closed';
		const entryPrice = parseRequiredNumber(form.entryPrice);
		const stopLoss = parseRequiredNumber(form.stopLoss);
		const takeProfit = parseRequiredNumber(form.takeProfit);

		if (entryPrice === null) {
			return tr('error.entryPriceNumber');
		}

		if (stopLoss === null) {
			return tr('error.stopLossNumber');
		}

		if (takeProfit === null) {
			return tr('error.takeProfitNumber');
		}

		if (form.side === 'long' && stopLoss >= entryPrice) {
			return tr('error.longStopBelow');
		}

		if (form.side === 'long' && takeProfit <= entryPrice) {
			return tr('error.longTakeAbove');
		}

		if (form.side === 'short' && stopLoss <= entryPrice) {
			return tr('error.shortStopAbove');
		}

		if (form.side === 'short' && takeProfit >= entryPrice) {
			return tr('error.shortTakeBelow');
		}

		if (isClosed) {
			const exitPrice = parseRequiredNumber(form.exitPrice);
			if (exitPrice === null) {
				return tr('error.exitPriceNumber');
			}

			if (calculateLiveRr(form.side, form.entryPrice, form.stopLoss, form.exitPrice) === null) {
				return tr('error.liveRrRisk');
			}
		}
	}

	if (!form.openedAt || (journalType === 'backtest' && !form.closedAt)) {
		return tr('error.openedClosedRequired');
	}

	if (journalType === 'live' && form.status === 'closed' && !form.closedAt) {
		return tr('error.closedRequired');
	}

	if (form.closedAt && calculateHoldingTime(form.openedAt, form.closedAt) === null) {
		return tr('error.closedAfterOpened');
	}

	return null;
}

function getResultOptionKey(result: TradeResult): 'option.loss' | 'option.win' | 'option.breakeven' {
	if (result === 'win') {
		return 'option.win';
	}

	if (result === 'breakeven') {
		return 'option.breakeven';
	}

	return 'option.loss';
}

function calculateLiveRr(side: TradeSide, entryPrice: string, stopLoss: string, exitPrice: string): number | null {
	const entry = parseRequiredNumber(entryPrice);
	const stop = parseRequiredNumber(stopLoss);
	const exit = parseRequiredNumber(exitPrice);
	if (entry === null || stop === null || exit === null) {
		return null;
	}

	const risk = side === 'short' ? stop - entry : entry - stop;
	if (risk <= 0) {
		return null;
	}

	const realizedMove = side === 'short' ? entry - exit : exit - entry;
	return roundNumber(realizedMove / risk);
}

function parseRequiredNumber(value: string): number | null {
	if (!value.trim()) {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatComputedRr(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function roundNumber(value: number): number {
	return Number(value.toFixed(2));
}

function syncClosedAtDate(openedAt: string, previousOpenedAt: string, closedAt: string): string {
	const openedDate = getDateTimeDatePart(openedAt);
	const openedTime = getDateTimeTimePart(openedAt);
	if (!openedDate || !openedTime) {
		return closedAt;
	}

	const previousOpenedDate = getDateTimeDatePart(previousOpenedAt);
	const closedDate = getDateTimeDatePart(closedAt);
	const closedTime = getDateTimeTimePart(closedAt);
	const hasManualDifferentClosedDate = Boolean(previousOpenedDate && closedDate && closedDate !== previousOpenedDate);
	if (hasManualDifferentClosedDate) {
		return closedAt;
	}

	return `${openedDate}T${closedTime || openedTime}`;
}

function getDateTimeDatePart(value: string): string {
	const [date] = value.split('T');
	return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function getDateTimeTimePart(value: string): string {
	const timeSeparatorIndex = value.indexOf('T');
	return timeSeparatorIndex === -1 ? '' : value.slice(timeSeparatorIndex + 1);
}

function parseTags(value: string): string[] {
	return value
		.split(',')
		.map((tag) => tag.trim().replace(/^#/, ''))
		.filter(Boolean);
}

function createTradeImage(value: string): TradeImage | null {
	const imageValue = cleanImageValue(value);
	if (!imageValue) {
		return null;
	}

	return {
		type: /^https?:\/\//i.test(imageValue) ? 'url' : 'file',
		value: imageValue,
	};
}

function getClipboardImageFiles(clipboardData: DataTransfer): File[] {
	const itemImageFiles = Array.from(clipboardData.items)
		.filter((item) => item.kind === 'file')
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null && isImageFile(file));

	if (itemImageFiles.length > 0) {
		return dedupeImageFiles(itemImageFiles);
	}

	return dedupeImageFiles(Array.from(clipboardData.files).filter(isImageFile));
}

function dedupeImageFiles(imageFiles: File[]): File[] {
	const seenKeys = new Set<string>();

	return imageFiles.filter((file) => {
		const key = `${file.name}-${file.type}-${file.size}`;
		if (seenKeys.has(key)) {
			return false;
		}

		seenKeys.add(key);
		return true;
	});
}

function isImageFile(file: File): boolean {
	return file.type.startsWith('image/');
}

async function savePastedImage(
	plugin: TraderJournalPlugin,
	imageFile: File,
	symbol: string,
	journalType: TradeJournalType,
): Promise<TradeImage> {
	const attachmentFolder = getAttachmentFolder(plugin, journalType);
	await ensureVaultFolder(plugin, attachmentFolder);

	const attachmentPath = getUniqueAttachmentPath(plugin, attachmentFolder, imageFile, symbol);
	await plugin.app.vault.createBinary(attachmentPath, await imageFile.arrayBuffer());

	return {
		type: 'file',
		value: attachmentPath,
	};
}

function cleanupCreatedAttachments(plugin: TraderJournalPlugin, attachmentPaths: Set<string>): void {
	for (const attachmentPath of attachmentPaths) {
		void deleteCreatedAttachment(plugin, attachmentPath).catch((deleteError: unknown) => {
			console.error('Trader Journal failed to clean up pasted image', deleteError);
		});
	}

	attachmentPaths.clear();
}

async function deleteCreatedAttachment(plugin: TraderJournalPlugin, attachmentPath: string): Promise<void> {
	const abstractFile = plugin.app.vault.getAbstractFileByPath(attachmentPath);
	if (abstractFile instanceof TFile) {
		// eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- FileManager.trashFile requires Obsidian 1.6.6; this plugin supports 1.4.4.
		await plugin.app.vault.trash(abstractFile, true);
	}
}

function getAttachmentFolder(plugin: TraderJournalPlugin, journalType: TradeJournalType): string {
	const journalFolder = normalizePath(
		journalType === 'live' ? plugin.settings.liveJournalFolder : plugin.settings.journalFolder,
	).replace(/\/$/, '');
	return normalizePath(`${journalFolder}/_attachments`);
}

async function ensureVaultFolder(plugin: TraderJournalPlugin, folderPath: string): Promise<void> {
	let currentPath = '';

	for (const segment of normalizePath(folderPath).split('/')) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		const abstractFile = plugin.app.vault.getAbstractFileByPath(currentPath);

		if (abstractFile instanceof TFolder) {
			continue;
		}

		if (abstractFile instanceof TFile) {
			throw new Error(`${currentPath} is a file, not a folder.`);
		}

		await plugin.app.vault.createFolder(currentPath);
	}
}

function getUniqueAttachmentPath(
	plugin: TraderJournalPlugin,
	attachmentFolder: string,
	imageFile: File,
	symbol: string,
): string {
	const baseName = createAttachmentBaseName(symbol);
	const extension = getImageFileExtension(imageFile);
	let candidatePath = normalizePath(`${attachmentFolder}/${baseName}.${extension}`);
	let suffix = 2;

	while (plugin.app.vault.getAbstractFileByPath(candidatePath)) {
		candidatePath = normalizePath(`${attachmentFolder}/${baseName}-${suffix}.${extension}`);
		suffix += 1;
	}

	return candidatePath;
}

function createAttachmentBaseName(symbol: string): string {
	const now = new Date();
	const datePart = [
		now.getFullYear(),
		padDatePart(now.getMonth() + 1),
		padDatePart(now.getDate()),
	].join('');
	const timePart = [
		padDatePart(now.getHours()),
		padDatePart(now.getMinutes()),
		padDatePart(now.getSeconds()),
	].join('');
	const randomPart = Math.random().toString(36).slice(2, 8);
	const symbolPart = sanitizeFileNamePart(normalizeSymbol(symbol) || 'image');

	return `${symbolPart}-${datePart}-${timePart}-${randomPart}`;
}

function getImageFileExtension(file: File): string {
	const extensionFromName = file.name.split('.').pop()?.toLowerCase();
	if (extensionFromName && /^[a-z0-9]+$/.test(extensionFromName)) {
		return extensionFromName === 'jpeg' ? 'jpg' : extensionFromName;
	}

	const extensionByMimeType: Record<string, string> = {
		'image/apng': 'apng',
		'image/avif': 'avif',
		'image/bmp': 'bmp',
		'image/gif': 'gif',
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/svg+xml': 'svg',
		'image/tiff': 'tif',
		'image/webp': 'webp',
	};

	return extensionByMimeType[file.type] ?? 'png';
}

function sanitizeFileNamePart(value: string): string {
	const sanitized = value.trim().replace(/[\\/#^[\]|?*:]/g, '-').replace(/\s+/g, '-');
	return sanitized || 'image';
}

function ImagePreview({ plugin, image }: { plugin: TraderJournalPlugin; image: TradeImage }) {
	const value = image.value ?? '';
	const source = resolveImagePreviewSource(plugin, image);
	const isRemoteImage = image.type === 'url' || /^https?:\/\//i.test(value);
	const tr = getTranslator(plugin.settings.language);

	if (source) {
		return (
			<>
				<img src={source} alt={value} />
				<span>{value}</span>
			</>
		);
	}

	return (
		<>
			<div className="trader-journal-image-preview__missing">
				{isRemoteImage && !plugin.settings.allowRemoteImages ? tr('image.remoteDisabled') : tr('image.noPreview')}
			</div>
			<span>{value}</span>
		</>
	);
}

function resolveImagePreviewSource(plugin: TraderJournalPlugin, image: TradeImage): string | null {
	const value = cleanImageValue(image.value ?? '');
	if (!value) {
		return null;
	}

	if (image.type === 'url' || /^https?:\/\//i.test(value)) {
		return plugin.settings.allowRemoteImages ? value : null;
	}

	const file = findVaultImage(plugin, value);
	return file ? plugin.app.vault.getResourcePath(file) : null;
}

function findVaultImage(plugin: TraderJournalPlugin, rawPath: string): TFile | null {
	const journalFolder = normalizePath(plugin.settings.journalFolder).replace(/\/$/, '');
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	const candidates = [
		normalizePath(rawPath.replace(/^\/+/, '')),
		normalizePath(`${journalFolder}/_attachments/${rawPath}`),
		normalizePath(`${liveJournalFolder}/_attachments/${rawPath}`),
	];

	for (const candidate of [...new Set(candidates.filter(Boolean))]) {
		const abstractFile = plugin.app.vault.getAbstractFileByPath(candidate);
		if (abstractFile instanceof TFile) {
			return abstractFile;
		}
	}

	return null;
}

function cleanImageValue(value: string): string {
	const trimmed = value.trim();
	const wikiMatch = trimmed.match(/^!?\[\[([^\]]+)\]\]$/);

	if (wikiMatch?.[1]) {
		return wikiMatch[1].split('|')[0]?.trim() ?? '';
	}

	const markdownImageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
	if (markdownImageMatch?.[1]) {
		return markdownImageMatch[1].trim();
	}

	return trimmed;
}

function getTodayDateInput(): string {
	const now = new Date();
	return `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`;
}

function getCurrentDateTimeLocalInput(): string {
	return formatDateTimeLocalInput(new Date());
}

function toDateTimeLocalInput(value: unknown): string {
	const raw = stringifyValue(value);
	if (!raw) {
		return '';
	}

	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? '' : formatDateTimeLocalInput(date);
}

function formatDateTimeLocalInput(date: Date): string {
	return [
		`${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
		`T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`,
	].join('');
}

function toLocalIsoString(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}

	return formatLocalIsoString(date);
}

function getCurrentLocalIsoString(): string {
	return formatLocalIsoString(new Date());
}

function formatLocalIsoString(date: Date): string {
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const absoluteOffsetMinutes = Math.abs(offsetMinutes);
	const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
	const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

	return [
		`${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
		`T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`,
		`${sign}${padDatePart(offsetHours)}:${padDatePart(offsetRemainderMinutes)}`,
	].join('');
}

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}
