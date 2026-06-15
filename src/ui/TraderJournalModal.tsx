import type { App } from 'obsidian';
import { Modal, Notice, TFile, normalizePath } from 'obsidian';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent, KeyboardEvent, SyntheticEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol } from '../settings';
import { formatDuration } from '../trades/format';
import {
	calculateHoldingTime,
	createTradeId,
	saveTradeToDailyNote,
} from '../trades/storage';
import type { TradeEntry, TradeImage, TradeResult, TradeSide } from '../trades/types';

const SIDE_OPTIONS: Array<{ value: TradeSide; label: string }> = [
	{ value: 'long', label: 'Long' },
	{ value: 'short', label: 'Short' },
];

const RESULT_OPTIONS: Array<{ value: TradeResult; label: string }> = [
	{ value: 'loss', label: 'Thua' },
	{ value: 'win', label: 'WIN' },
	{ value: 'breakeven', label: 'Hoà vốn' },
];

interface TraderJournalModalContentProps {
	plugin: TraderJournalPlugin;
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
	images: TradeImage[];
	notes: string;
	openedAt: string;
	closedAt: string;
}

function TraderJournalModalContent({ plugin, closeModal }: TraderJournalModalContentProps) {
	const [form, setForm] = useState<TradeFormState>(() => ({
		symbol: plugin.settings.symbols[0] ?? '',
		side: 'long',
		setup: '',
		timeframe: plugin.settings.timeframes[0] ?? '',
		result: 'win',
		rr: '',
		tags: '',
		images: [],
		notes: '',
		openedAt: '',
		closedAt: '',
	}));
	const [imageInput, setImageInput] = useState('');
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);

	const holdingTime = useMemo(() => calculateHoldingTime(form.openedAt, form.closedAt), [form.openedAt, form.closedAt]);

	function updateField<K extends keyof TradeFormState>(field: K, value: TradeFormState[K]) {
		setForm((currentForm) => ({
			...currentForm,
			[field]: value,
		}));
	}

	const addImage = () => {
		const image = createTradeImage(imageInput);
		if (!image) {
			return;
		}

		if (form.images.some((item) => item.value === image.value)) {
			setImageInput('');
			return;
		}

		updateField('images', [...form.images, image]);
		setImageInput('');
	};

	const removeImage = (index: number) => {
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

	const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving) {
			return;
		}

		void saveTrade();
	};

	const saveTrade = async () => {
		const validationError = validateForm(form);
		if (validationError) {
			setError(validationError);
			return;
		}

		const symbol = normalizeSymbol(form.symbol);
		const journalDate = getTodayDateInput();
		const openedAt = toLocalIsoString(form.openedAt);
		const closedAt = toLocalIsoString(form.closedAt);
		const pendingImage = createTradeImage(imageInput);
		const images =
			pendingImage && !form.images.some((image) => image.value === pendingImage.value)
				? [...form.images, pendingImage]
				: form.images;
		const trade: TradeEntry = {
			schemaVersion: 1,
			id: createTradeId(symbol, openedAt, journalDate),
			symbol,
			side: form.side,
			setup: form.setup.trim(),
			timeframe: form.timeframe,
			result: form.result,
			rr: Number(form.rr),
			tags: parseTags(form.tags),
			images,
			notes: form.notes.trim(),
			opened_at: openedAt,
			closed_at: closedAt,
			holding_time: calculateHoldingTime(openedAt, closedAt),
		};

		try {
			setIsSaving(true);
			setError('');
			const file = await saveTradeToDailyNote(plugin, journalDate, trade);
			new Notice(`Saved trade to ${file.path}`);
			closeModal();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'Could not save trade.');
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<h2>Add backtest trade</h2>

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
					<span>RR</span>
					<input
						type="number"
						step="0.01"
						value={form.rr}
						placeholder="2"
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('rr', event.target.value)}
						required
					/>
				</label>

				<label className="trader-journal-field">
					<span>Opened at</span>
					<input
						type="datetime-local"
						value={form.openedAt}
						onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('openedAt', event.target.value)}
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

			<label className="trader-journal-field">
				<span>Tags</span>
				<input
					type="text"
					value={form.tags}
					placeholder="breakout, trend"
					onChange={(event: ChangeEvent<HTMLInputElement>) => updateField('tags', event.target.value)}
				/>
			</label>

			<div className="trader-journal-field trader-journal-field--images">
				<span>Images</span>
				<input
					type="text"
					value={imageInput}
					placeholder="Paste image link or file path, then press Enter"
					onChange={(event: ChangeEvent<HTMLInputElement>) => setImageInput(event.target.value)}
					onKeyDown={handleImageInputKeyDown}
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
				<button type="button" onClick={closeModal} disabled={isSaving}>
					Cancel
				</button>
				<button type="submit" className="mod-cta" disabled={isSaving}>
					{isSaving ? 'Saving...' : 'Save trade'}
				</button>
			</div>
		</form>
	);
}

export class TraderJournalModal extends Modal {
	private readonly plugin: TraderJournalPlugin;
	private root: Root | null = null;

	constructor(app: App, plugin: TraderJournalPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.setTitle('Trader journal');
		this.modalEl.addClass('trader-journal-modal-shell');
		this.contentEl.addClass('trader-journal-modal-content');
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TraderJournalModalContent plugin={this.plugin} closeModal={() => this.close()} />
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

function validateForm(form: TradeFormState): string | null {
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
	if (!Number.isFinite(rr)) {
		return 'RR must be a number.';
	}

	if (!form.openedAt || !form.closedAt) {
		return 'Opened at and closed at are required.';
	}

	if (calculateHoldingTime(form.openedAt, form.closedAt) === null) {
		return 'Closed at must be after opened at.';
	}

	return null;
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

function ImagePreview({ plugin, image }: { plugin: TraderJournalPlugin; image: TradeImage }) {
	const value = image.value ?? '';
	const source = resolveImagePreviewSource(plugin, image);

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
			<div className="trader-journal-image-preview__missing">No preview</div>
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
		return value;
	}

	const file = findVaultImage(plugin, value);
	return file ? plugin.app.vault.getResourcePath(file) : null;
}

function findVaultImage(plugin: TraderJournalPlugin, rawPath: string): TFile | null {
	const journalFolder = normalizePath(plugin.settings.journalFolder).replace(/\/$/, '');
	const candidates = [
		normalizePath(rawPath.replace(/^\/+/, '')),
		normalizePath(`${journalFolder}/_attachments/${rawPath}`),
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
