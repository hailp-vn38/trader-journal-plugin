import type { App } from 'obsidian';
import { Modal, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent, SyntheticEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { formatDuration } from '../trades/format';
import {
	calculateHoldingTime,
	createTradeId,
	saveTradeToDailyNote,
} from '../trades/storage';
import type { TradeEntry, TradeImage, TradeJournalType, TradeResult, TradeSide } from '../trades/types';

const SIDE_OPTIONS: Array<{ value: TradeSide; label: string }> = [
	{ value: 'long', label: 'Long' },
	{ value: 'short', label: 'Short' },
];

const RESULT_OPTIONS: Array<{ value: TradeResult; label: string }> = [
	{ value: 'loss', label: 'Loss' },
	{ value: 'win', label: 'Win' },
	{ value: 'breakeven', label: 'Breakeven' },
];

interface TraderJournalModalContentProps {
	plugin: TraderJournalPlugin;
	journalType: TradeJournalType;
	closeModal: () => void;
}

interface TradeFormState {
	symbol: string;
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

function TraderJournalModalContent({ plugin, journalType, closeModal }: TraderJournalModalContentProps) {
	const [form, setForm] = useState<TradeFormState>(() => ({
		symbol: plugin.settings.symbols[0] ?? '',
		side: 'long',
		setup: '',
		timeframe: plugin.settings.timeframes[0] ?? '',
		result: 'win',
		rr: '',
		tags: '',
		entryPrice: '',
		stopLoss: '',
		exitPrice: '',
		takeProfit: '',
		images: [],
		notes: '',
		openedAt: '',
		closedAt: '',
	}));
	const [imageInput, setImageInput] = useState('');
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isPastingImage, setIsPastingImage] = useState(false);
	const createdAttachmentPathsRef = useRef<Set<string>>(new Set());
	const savedTradeRef = useRef(false);

	const holdingTime = useMemo(() => calculateHoldingTime(form.openedAt, form.closedAt), [form.openedAt, form.closedAt]);
	const liveRr = useMemo(
		() => calculateLiveRr(form.side, form.entryPrice, form.stopLoss, form.exitPrice),
		[form.entryPrice, form.exitPrice, form.side, form.stopLoss],
	);
	const isLiveJournal = journalType === 'live';

	useEffect(
		() => () => {
			if (!savedTradeRef.current) {
				cleanupCreatedAttachments(plugin, createdAttachmentPathsRef.current);
			}
		},
		[plugin],
	);

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
			closedAt: syncClosedAtDate(openedAt, currentForm.openedAt, currentForm.closedAt),
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
			setError(pasteError instanceof Error ? pasteError.message : 'Could not paste image.');
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
		const validationError = validateForm(form, journalType);
		if (validationError) {
			setError(validationError);
			return;
		}

		const symbol = normalizeSymbol(form.symbol);
		const journalDate = getTodayDateInput();
		const openedAt = toLocalIsoString(form.openedAt);
		const closedAt = toLocalIsoString(form.closedAt);
		const rr = isLiveJournal ? (liveRr ?? 0) : Number(form.rr);
		const pendingImage = createTradeImage(imageInput);
		const images =
			pendingImage && !form.images.some((image) => image.value === pendingImage.value)
				? [...form.images, pendingImage]
				: form.images;
		const trade: TradeEntry = {
			schemaVersion: 1,
			id: createTradeId(symbol, openedAt, journalDate),
			journal_type: journalType,
			symbol,
			side: form.side,
			setup: form.setup.trim(),
			timeframe: form.timeframe,
			result: form.result,
			rr,
			images,
			notes: form.notes.trim(),
			opened_at: openedAt,
			closed_at: closedAt,
			holding_time: calculateHoldingTime(openedAt, closedAt),
		};
		if (!isLiveJournal) {
			trade.tags = parseTags(form.tags);
		} else {
			trade.entry_price = Number(form.entryPrice);
			trade.stop_loss = Number(form.stopLoss);
			trade.exit_price = Number(form.exitPrice);
			trade.take_profit = Number(form.takeProfit);
		}

		try {
			setIsSaving(true);
			setError('');
			const file = await saveTradeToDailyNote(plugin, journalDate, trade);
			savedTradeRef.current = true;
			createdAttachmentPathsRef.current.clear();
			new Notice(`Saved trade to ${file.path}`);
			closeModal();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'Could not save trade.');
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<h2>{isLiveJournal ? 'Add live trade' : 'Add backtest trade'}</h2>

			{error ? <div className="trader-journal-form__error">{error}</div> : null}

			<div className="trader-journal-form__grid">
				<label className="trader-journal-field">
					<span>Symbol</span>
					<select
						value={form.symbol}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('symbol', event.target.value)}
						required
					>
						<option value="">Select symbol</option>
						{plugin.settings.symbols.map((symbol) => (
							<option value={symbol} key={symbol}>
								{symbol}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>Side</span>
					<select
						value={form.side}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('side', event.target.value as TradeSide)}
					>
						{SIDE_OPTIONS.map((option) => (
							<option value={option.value} key={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>Timeframe</span>
					<select
						value={form.timeframe}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('timeframe', event.target.value)}
						required
					>
						<option value="">Select timeframe</option>
						{plugin.settings.timeframes.map((timeframe) => (
							<option value={timeframe} key={timeframe}>
								{timeframe}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>Result</span>
					<select
						value={form.result}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							updateField('result', event.target.value as TradeResult)
						}
					>
						{RESULT_OPTIONS.map((option) => (
							<option value={option.value} key={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>{isLiveJournal ? 'Entry price' : 'RR'}</span>
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
							<span>Stop loss</span>
							<input
								type="number"
								step="0.01"
								value={form.stopLoss}
								placeholder="99"
								onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('stopLoss', event.target.value)}
								required
							/>
						</label>

						<label className="trader-journal-field">
							<span>Exit price</span>
							<input
								type="number"
								step="0.01"
								value={form.exitPrice}
								placeholder="102"
								onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('exitPrice', event.target.value)}
								required
							/>
						</label>

						<label className="trader-journal-field">
							<span>Take profit</span>
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
					<span>Opened at</span>
					<input
						type="datetime-local"
						value={form.openedAt}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateOpenedAt(event.target.value)}
						required
					/>
				</label>

				<label className="trader-journal-field">
					<span>Closed at</span>
					<input
						type="datetime-local"
						value={form.closedAt}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('closedAt', event.target.value)}
						required
					/>
				</label>

				<div className="trader-journal-field trader-journal-field--readonly">
					<span>Holding time</span>
					<strong>{formatDuration(holdingTime) || '-'}</strong>
				</div>

				{isLiveJournal ? (
					<div className="trader-journal-field trader-journal-field--readonly">
						<span>RR</span>
						<strong>{liveRr === null ? '-' : `${formatComputedRr(liveRr)}R`}</strong>
					</div>
				) : null}
			</div>

			<label className="trader-journal-field">
				<span>Setup</span>
				<input
					type="text"
					value={form.setup}
					placeholder="Opening range breakout"
					onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('setup', event.target.value)}
					required
				/>
			</label>

			{isLiveJournal ? null : (
				<label className="trader-journal-field">
					<span>Tags</span>
					<input
						type="text"
						value={form.tags}
						placeholder="breakout, trend"
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('tags', event.target.value)}
					/>
				</label>
			)}

			<div className="trader-journal-field trader-journal-field--images">
				<span>Images</span>
				<input
					type="text"
					value={imageInput}
					placeholder={isPastingImage ? 'Saving pasted image...' : 'Paste image, link, or file path'}
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
									aria-label={`Remove image ${index + 1}`}
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
				<span>Notes</span>
				<textarea
					value={form.notes}
					rows={4}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('notes', event.target.value)}
				/>
			</label>

			<div className="trader-journal-form__actions">
				<button type="button" onClick={closeModal} disabled={isSaving || isPastingImage}>
					Cancel
				</button>
				<button type="submit" className="mod-cta" disabled={isSaving || isPastingImage}>
					{isSaving ? 'Saving...' : 'Save trade'}
				</button>
			</div>
		</form>
	);
}

export class TraderJournalModal extends Modal {
	private readonly plugin: TraderJournalPlugin;
	private readonly journalType: TradeJournalType;
	private root: Root | null = null;

	constructor(app: App, plugin: TraderJournalPlugin, journalType: TradeJournalType = 'backtest') {
		super(app);
		this.plugin = plugin;
		this.journalType = journalType;
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

function validateForm(form: TradeFormState, journalType: TradeJournalType): string | null {
	if (!normalizeSymbol(form.symbol)) {
		return 'Symbol is required.';
	}

	if (!form.timeframe) {
		return 'Timeframe is required.';
	}

	if (!form.setup.trim()) {
		return 'Setup is required.';
	}

	const rr = Number(form.rr);
	if (journalType === 'backtest' && !Number.isFinite(rr)) {
		return 'RR must be a number.';
	}

	if (journalType === 'live') {
		const entryPrice = parseRequiredNumber(form.entryPrice);
		const stopLoss = parseRequiredNumber(form.stopLoss);
		const exitPrice = parseRequiredNumber(form.exitPrice);
		const takeProfit = parseRequiredNumber(form.takeProfit);

		if (entryPrice === null) {
			return 'Entry price must be a number.';
		}

		if (stopLoss === null) {
			return 'Stop loss must be a number.';
		}

		if (exitPrice === null) {
			return 'Exit price must be a number.';
		}

		if (takeProfit === null) {
			return 'Take profit must be a number.';
		}

		if (form.side === 'long' && stopLoss >= entryPrice) {
			return 'Long stop loss must be below entry price.';
		}

		if (form.side === 'long' && takeProfit <= entryPrice) {
			return 'Long take profit must be above entry price.';
		}

		if (form.side === 'short' && stopLoss <= entryPrice) {
			return 'Short stop loss must be above entry price.';
		}

		if (form.side === 'short' && takeProfit >= entryPrice) {
			return 'Short take profit must be below entry price.';
		}

		if (calculateLiveRr(form.side, form.entryPrice, form.stopLoss, form.exitPrice) === null) {
			return 'Stop loss must be different from entry price.';
		}
	}

	if (!form.openedAt || !form.closedAt) {
		return 'Opened at and closed at are required.';
	}

	if (calculateHoldingTime(form.openedAt, form.closedAt) === null) {
		return 'Closed at must be after opened at.';
	}

	return null;
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
				{isRemoteImage && !plugin.settings.allowRemoteImages ? 'Remote preview disabled' : 'No preview'}
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

function toLocalIsoString(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}

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
