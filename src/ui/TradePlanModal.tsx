import type { App } from 'obsidian';
import { Modal, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent, SyntheticEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { getTranslator } from '../i18n';
import type { Translator } from '../i18n';
import { normalizeTradeImages, stringifyValue } from '../trades/format';
import type { TradeImage } from '../trades/types';
import { normalizeLinkedTrades, normalizePlanEndDate, normalizePlanStatus, saveTradePlan } from '../plans/storage';
import type { TradePlanBias, TradePlanEntry, TradePlanStatus } from '../plans/types';
import { isSetupAvailableForSymbol, listTradeSetups } from '../setups/storage';
import type { TradeSetupDefinition } from '../setups/types';
import { TradeSetupModal } from './TradeSetupModal';

const PLAN_STATUS_OPTIONS: TradePlanStatus[] = ['open', 'closed', 'cancelled'];
const PLAN_BIAS_OPTIONS: TradePlanBias[] = ['neutral', 'long', 'short'];

interface TradePlanModalContentProps {
	plugin: TraderJournalPlugin;
	initialPlan?: TradePlanEntry;
	targetFilePath?: string;
	closeModal: () => void;
}

interface TradePlanFormState {
	symbol: string;
	title: string;
	status: TradePlanStatus;
	bias: TradePlanBias;
	setupId: string;
	setup: string;
	timeframes: string;
	startDate: string;
	endDate: string;
	entryPlan: string;
	invalidation: string;
	takeProfitPlan: string;
	riskNotes: string;
	images: TradeImage[];
	notes: string;
}

function TradePlanModalContent({
	plugin,
	initialPlan,
	targetFilePath,
	closeModal,
}: TradePlanModalContentProps) {
	const [form, setForm] = useState<TradePlanFormState>(() => createInitialPlanForm(plugin, initialPlan));
	const [imageInput, setImageInput] = useState('');
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isPastingImage, setIsPastingImage] = useState(false);
	const [setupOptions, setSetupOptions] = useState<TradeSetupDefinition[]>([]);
	const [isLoadingSetups, setIsLoadingSetups] = useState(true);
	const createdAttachmentPathsRef = useRef<Set<string>>(new Set());
	const savedPlanRef = useRef(false);
	const isEditing = Boolean(initialPlan && targetFilePath);
	const linkedTrades = normalizeLinkedTrades(initialPlan?.linked_trades);
	const tr = getTranslator(plugin.settings.language);

	useEffect(() => {
		let disposed = false;
		void listTradeSetups(plugin)
			.then((setups) => {
				if (!disposed) {
					setSetupOptions(
						setups.filter((setup) => setup.status === 'active' || setup.id === form.setupId),
					);
				}
			})
			.catch((loadError: unknown) => {
				console.error('Trader Journal failed to load trade setups', loadError);
			})
			.finally(() => {
				if (!disposed) {
					setIsLoadingSetups(false);
				}
			});

		return () => {
			disposed = true;
		};
	}, [form.setupId, plugin]);

	useEffect(
		() => () => {
			if (!savedPlanRef.current) {
				cleanupCreatedAttachments(plugin, createdAttachmentPathsRef.current);
			}
		},
		[plugin],
	);

	function updateField<K extends keyof TradePlanFormState>(field: K, value: TradePlanFormState[K]) {
		setForm((currentForm) => ({
			...currentForm,
			[field]: value,
		}));
	}

	function updateStatus(status: TradePlanStatus) {
		setForm((currentForm) => ({
			...currentForm,
			status,
			endDate: status !== 'open' && !currentForm.endDate ? getTodayDateInput() : currentForm.endDate,
		}));
	}

	function updateSymbol(symbol: string) {
		setForm((currentForm) => {
			const selectedSetup = setupOptions.find((setup) => setup.id === currentForm.setupId);
			const keepHistoricalSetup =
				isEditing &&
				symbol === normalizeSymbol(stringifyValue(initialPlan?.symbol)) &&
				currentForm.setupId === stringifyValue(initialPlan?.setup_id);
			if (!selectedSetup || isSetupAvailableForSymbol(selectedSetup, symbol) || keepHistoricalSetup) {
				return { ...currentForm, symbol };
			}

			return { ...currentForm, symbol, setupId: '', setup: '' };
		});
	}

	function selectSetup(setupId: string) {
		const setup = setupOptions.find((item) => item.id === setupId);
		if (!setup) {
			setForm((currentForm) => ({ ...currentForm, setupId: '', setup: '' }));
			return;
		}

		setForm((currentForm) => ({
			...currentForm,
			setupId: setup.id,
			setup: setup.name,
			timeframes: setup.timeframes.join(', '),
			entryPlan: setup.entryCriteria,
			invalidation: setup.invalidation,
			takeProfitPlan: setup.takeProfit,
			riskNotes: setup.riskRules,
		}));
	}

	function createSetup() {
		new TradeSetupModal(plugin.app, plugin, {
			onSaved: (setup) => {
				setSetupOptions((current) => [...current.filter((item) => item.id !== setup.id), setup]);
				setForm((currentForm) =>
					isSetupAvailableForSymbol(setup, currentForm.symbol)
						? {
							...currentForm,
							setupId: setup.id,
							setup: setup.name,
							timeframes: setup.timeframes.join(', '),
						}
						: currentForm,
				);
			},
			openAfterSave: false,
		}).open();
	}

	async function openLinkedTrade(filePath: string) {
		try {
			await plugin.app.workspace.openLinkText(filePath, targetFilePath ?? '', false);
		} catch (openError) {
			console.error('Trader Journal failed to open linked trade from plan modal', openError);
			new Notice(tr('calendar.openTradeNoteError'));
		}
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
		const image = createPlanImage(imageInput);
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
				console.error('Trader Journal failed to remove pasted plan image', deleteError);
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
				imageFiles.map((imageFile) => savePastedPlanImage(plugin, imageFile, form.symbol)),
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

		void savePlan();
	};

	const savePlan = async () => {
		const validationError = validatePlanForm(form, tr);
		if (validationError) {
			setError(validationError);
			return;
		}

		const status = normalizePlanStatus(form.status);
		const endDate = status === 'open' ? normalizePlanEndDate(form.endDate) : form.endDate || getTodayDateInput();
		const pendingImage = createPlanImage(imageInput);
		const images =
			pendingImage && !form.images.some((image) => image.value === pendingImage.value)
				? [...form.images, pendingImage]
				: form.images;
		const now = getCurrentLocalIsoString();
		const plan: TradePlanEntry = {
			schemaVersion: 1,
			id: stringifyValue(initialPlan?.id),
			journal_type: 'live',
			symbol: normalizeSymbol(form.symbol),
			title: form.title.trim(),
			status,
			start_date: form.startDate,
			end_date: endDate,
			bias: form.bias,
			setup_id: form.setupId,
			setup: form.setup.trim(),
			setup_updated_at: setupOptions.find((setup) => setup.id === form.setupId)?.updatedAt ?? '',
			timeframes: parseCsvList(form.timeframes),
			entry_plan: form.entryPlan.trim(),
			invalidation: form.invalidation.trim(),
			take_profit_plan: form.takeProfitPlan.trim(),
			risk_notes: form.riskNotes.trim(),
			images,
			notes: form.notes.trim(),
			linked_trades: linkedTrades,
			created_at: stringifyValue(initialPlan?.created_at) || now,
			updated_at: now,
		};

		try {
			setIsSaving(true);
			setError('');
			const file = await saveTradePlan(plugin, plan, targetFilePath);
			savedPlanRef.current = true;
			createdAttachmentPathsRef.current.clear();
			new Notice(tr(isEditing ? 'notice.updatedPlan' : 'notice.savedPlan', { path: file.path }));
			closeModal();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : tr('error.couldNotSavePlan'));
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<h2>{isEditing ? tr('modal.editTradePlan') : tr('modal.addTradePlan')}</h2>

			{error ? <div className="trader-journal-form__error">{error}</div> : null}

			<div className="trader-journal-form__grid">
				<label className="trader-journal-field">
					<span>{tr('detail.symbol')}</span>
					<select
						value={form.symbol}
					onChange={(event: ChangeEvent<HTMLSelectElement>) => updateSymbol(event.target.value)}
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

				<label className="trader-journal-field">
					<span>{tr('detail.status')}</span>
					<select
						value={form.status}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateStatus(event.target.value as TradePlanStatus)}
					>
						{PLAN_STATUS_OPTIONS.map((status) => (
							<option value={status} key={status}>
								{getPlanStatusLabel(tr, status)}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>{tr('detail.bias')}</span>
					<select
						value={form.bias}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField('bias', event.target.value as TradePlanBias)}
					>
						{PLAN_BIAS_OPTIONS.map((bias) => (
							<option value={bias} key={bias}>
								{getPlanBiasLabel(tr, bias)}
							</option>
						))}
					</select>
				</label>

				<label className="trader-journal-field">
					<span>{tr('detail.startDate')}</span>
					<input
						type="date"
						value={form.startDate}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('startDate', event.target.value)}
						required
					/>
				</label>

				<label className="trader-journal-field">
					<span>{tr('detail.endDate')}</span>
					<input
						type="date"
						value={form.endDate}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('endDate', event.target.value)}
					/>
				</label>

				<label className="trader-journal-field">
					<span>{tr('detail.timeframe')}</span>
					<input
						type="text"
						value={form.timeframes}
						placeholder="5m, 15m"
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('timeframes', event.target.value)}
					/>
				</label>
			</div>

			<label className="trader-journal-field">
				<span>{tr('detail.title')}</span>
				<input
					type="text"
					value={form.title}
					placeholder={tr('placeholder.planTitle')}
					onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('title', event.target.value)}
					required
				/>
			</label>

			<div className="trader-journal-field">
				<span>{tr('detail.setup')}</span>
				<div className="trader-journal-setup-select-row">
					<select
						value={form.setupId}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => selectSetup(event.target.value)}
						required
						disabled={isLoadingSetups}
					>
						<option value="">
							{isLoadingSetups ? tr('placeholder.loadingSetups') : tr('placeholder.selectSetup')}
						</option>
						{setupOptions
							.filter(
								(setup) =>
									isSetupAvailableForSymbol(setup, form.symbol) || setup.id === form.setupId,
							)
							.map((setup) => (
							<option value={setup.id} key={setup.id}>
								{setup.name}{setup.status === 'archived' ? ` (${tr('option.archived')})` : ''}
							</option>
							))}
					</select>
					<button type="button" onClick={createSetup}>
						{tr('action.createSetup')}
					</button>
				</div>
			</div>

			<label className="trader-journal-field">
				<span>{tr('detail.entryPlan')}</span>
				<textarea
					value={form.entryPlan}
					rows={3}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('entryPlan', event.target.value)}
				/>
			</label>

			<label className="trader-journal-field">
				<span>{tr('detail.invalidation')}</span>
				<textarea
					value={form.invalidation}
					rows={3}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('invalidation', event.target.value)}
				/>
			</label>

			<label className="trader-journal-field">
				<span>{tr('detail.takeProfitPlan')}</span>
				<textarea
					value={form.takeProfitPlan}
					rows={3}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('takeProfitPlan', event.target.value)}
				/>
			</label>

			<label className="trader-journal-field">
				<span>{tr('detail.riskNotes')}</span>
				<textarea
					value={form.riskNotes}
					rows={3}
					onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField('riskNotes', event.target.value)}
				/>
			</label>

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

			{linkedTrades.length > 0 ? (
				<section className="trader-journal-plan-linked-trades">
					<div className="trader-journal-plan-linked-trades__title">{tr('detail.linkedTrades')}</div>
					<ul>
						{linkedTrades.map((tradeRef) => (
							<li key={`${tradeRef.trade_id ?? ''}-${tradeRef.file_path ?? ''}`}>
								{tradeRef.file_path ? (
									<button
										type="button"
										className="trader-journal-plan-linked-trade-button"
										onClick={() => void openLinkedTrade(tradeRef.file_path ?? '')}
									>
										{tradeRef.label || tradeRef.trade_id || tradeRef.file_path}
									</button>
								) : (
									tradeRef.label || tradeRef.trade_id
								)}
							</li>
						))}
					</ul>
				</section>
			) : null}

			<div className="trader-journal-form__actions">
				<button type="button" onClick={closeModal} disabled={isSaving || isPastingImage}>
					{tr('action.cancel')}
				</button>
				<button type="submit" className="mod-cta" disabled={isSaving || isPastingImage}>
					{isSaving ? tr('action.saving') : isEditing ? tr('action.updatePlan') : tr('action.savePlan')}
				</button>
			</div>
		</form>
	);
}

export class TradePlanModal extends Modal {
	private readonly plugin: TraderJournalPlugin;
	private readonly initialPlan: TradePlanEntry | undefined;
	private readonly targetFilePath: string | undefined;
	private root: Root | null = null;

	constructor(
		app: App,
		plugin: TraderJournalPlugin,
		initialPlan?: TradePlanEntry,
		targetFilePath?: string,
	) {
		super(app);
		this.plugin = plugin;
		this.initialPlan = initialPlan;
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
				<TradePlanModalContent
					plugin={this.plugin}
					initialPlan={this.initialPlan}
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

function createInitialPlanForm(
	plugin: TraderJournalPlugin,
	initialPlan: TradePlanEntry | undefined,
): TradePlanFormState {
	return {
		symbol: normalizeSymbol(stringifyValue(initialPlan?.symbol)) || plugin.settings.symbols[0] || '',
		title: stringifyValue(initialPlan?.title),
		status: normalizePlanStatus(initialPlan?.status),
		bias: normalizePlanBias(initialPlan?.bias),
		setupId: stringifyValue(initialPlan?.setup_id),
		setup: stringifyValue(initialPlan?.setup),
		timeframes: formatCsvList(initialPlan?.timeframes),
		startDate: stringifyValue(initialPlan?.start_date) || getTodayDateInput(),
		endDate: normalizePlanEndDate(initialPlan?.end_date) ?? '',
		entryPlan: stringifyValue(initialPlan?.entry_plan),
		invalidation: stringifyValue(initialPlan?.invalidation),
		takeProfitPlan: stringifyValue(initialPlan?.take_profit_plan),
		riskNotes: stringifyValue(initialPlan?.risk_notes),
		images: normalizeTradeImages(initialPlan?.images),
		notes: stringifyValue(initialPlan?.notes),
	};
}

function validatePlanForm(form: TradePlanFormState, tr: Translator): string | null {
	if (!normalizeSymbol(form.symbol)) {
		return tr('error.symbolRequired');
	}

	if (!form.title.trim()) {
		return tr('error.planTitleRequired');
	}

	if (!form.setupId) {
		return tr('error.setupRequired');
	}

	if (!isDateKey(form.startDate)) {
		return tr('error.planStartDateRequired');
	}

	if (form.endDate && (!isDateKey(form.endDate) || form.endDate < form.startDate)) {
		return tr('error.planEndDateAfterStart');
	}

	return null;
}

function normalizePlanBias(value: unknown): TradePlanBias {
	return value === 'long' || value === 'short' || value === 'neutral' ? value : 'neutral';
}

function getPlanStatusLabel(tr: Translator, status: TradePlanStatus): string {
	if (status === 'closed') {
		return tr('option.closed');
	}

	if (status === 'cancelled') {
		return tr('option.cancelled');
	}

	return tr('option.open');
}

function getPlanBiasLabel(tr: Translator, bias: TradePlanBias): string {
	if (bias === 'long') {
		return tr('option.long');
	}

	if (bias === 'short') {
		return tr('option.short');
	}

	return tr('option.neutral');
}

function formatCsvList(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
	}

	return stringifyValue(value);
}

function parseCsvList(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function createPlanImage(value: string): TradeImage | null {
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

async function savePastedPlanImage(
	plugin: TraderJournalPlugin,
	imageFile: File,
	symbol: string,
): Promise<TradeImage> {
	const attachmentFolder = getAttachmentFolder(plugin);
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
			console.error('Trader Journal failed to clean up pasted plan image', deleteError);
		});
	}

	attachmentPaths.clear();
}

async function deleteCreatedAttachment(plugin: TraderJournalPlugin, attachmentPath: string): Promise<void> {
	const abstractFile = plugin.app.vault.getAbstractFileByPath(attachmentPath);
	if (abstractFile instanceof TFile) {
		await plugin.app.fileManager.trashFile(abstractFile);
	}
}

function getAttachmentFolder(plugin: TraderJournalPlugin): string {
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	return normalizePath(`${liveJournalFolder}/_attachments`);
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
	const symbolPart = sanitizeFileNamePart(normalizeSymbol(symbol) || 'plan-image');

	return `${symbolPart}-plan-${datePart}-${timePart}-${randomPart}`;
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
	return sanitized || 'plan-image';
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
	const liveJournalFolder = normalizePath(plugin.settings.liveJournalFolder).replace(/\/$/, '');
	const candidates = [
		normalizePath(rawPath.replace(/^\/+/, '')),
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

function isDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getTodayDateInput(): string {
	const now = new Date();
	return `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`;
}

function getCurrentLocalIsoString(): string {
	const date = new Date();
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
