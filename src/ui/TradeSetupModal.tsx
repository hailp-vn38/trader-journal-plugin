import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { StrictMode, useState } from 'react';
import type { ChangeEvent, SyntheticEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { getTranslator } from '../i18n';
import type TraderJournalPlugin from '../main';
import { createTradeSetup, updateTradeSetup } from '../setups/storage';
import type { TradeSetupDefinition, TradeSetupStatus } from '../setups/types';

interface TradeSetupModalProps {
	plugin: TraderJournalPlugin;
	closeModal: () => void;
	initialSetup?: TradeSetupDefinition;
	onSaved?: (setup: TradeSetupDefinition) => void;
	openAfterSave: boolean;
}

interface TradeSetupModalOptions {
	initialSetup?: TradeSetupDefinition;
	onSaved?: (setup: TradeSetupDefinition) => void;
	openAfterSave?: boolean;
}

function TradeSetupModalContent({
	plugin,
	closeModal,
	initialSetup,
	onSaved,
	openAfterSave,
}: TradeSetupModalProps) {
	const [name, setName] = useState(initialSetup?.name ?? '');
	const [status, setStatus] = useState<TradeSetupStatus>(initialSetup?.status ?? 'active');
	const [symbols, setSymbols] = useState<string[]>(initialSetup?.symbols ?? []);
	const [timeframes, setTimeframes] = useState(
		initialSetup?.timeframes.join(', ') ?? plugin.settings.timeframes.join(', '),
	);
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const tr = getTranslator(plugin.settings.language);
	const isEditing = Boolean(initialSetup);

	const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving) {
			return;
		}
		void saveSetup();
	};

	const saveSetup = async () => {
		if (!name.trim()) {
			setError(tr('error.setupNameRequired'));
			return;
		}

		try {
			setIsSaving(true);
			setError('');
			const setupData = {
				name,
				status,
				symbols,
				timeframes: parseCsvList(timeframes),
			};
			const setup = initialSetup
				? await updateTradeSetup(plugin, initialSetup, setupData)
				: await createTradeSetup(plugin, setupData);
			new Notice(tr(isEditing ? 'notice.updatedSetup' : 'notice.savedSetup', { path: setup.filePath }));
			onSaved?.(setup);
			closeModal();
			if (openAfterSave) {
				await plugin.app.workspace.openLinkText(setup.filePath, '', false);
			}
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : tr('error.couldNotSaveSetup'));
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<h2>{tr(isEditing ? 'modal.editTradeSetup' : 'modal.addTradeSetup')}</h2>
			<p>{tr(isEditing ? 'setup.editDescription' : 'setup.createDescription')}</p>
			{error ? <div className="trader-journal-form__error">{error}</div> : null}

			<label className="trader-journal-field">
				<span>{tr('detail.setupName')}</span>
				<input
					type="text"
					value={name}
					placeholder={tr('placeholder.openingRangeBreakout')}
					onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
					required
					autoFocus
				/>
			</label>

			<fieldset className="trader-journal-field trader-journal-setup-symbols">
				<legend>{tr('detail.symbols')}</legend>
				<div className="trader-journal-setup-symbols__options">
					<label>
						<input
							type="checkbox"
							checked={symbols.length === 0}
							onChange={() => setSymbols([])}
						/>
						<span>{tr('dashboard.allSymbols')}</span>
					</label>
					{plugin.settings.symbols.map((symbol) => (
						<label key={symbol}>
							<input
								type="checkbox"
								checked={symbols.includes(symbol)}
								onChange={(event) =>
									setSymbols((current) =>
										event.target.checked
											? [...current, symbol]
											: current.filter((item) => item !== symbol),
									)
								}
							/>
							<span>{symbol}</span>
						</label>
					))}
				</div>
				<small>{tr('setup.symbolsDescription')}</small>
			</fieldset>

			<label className="trader-journal-field">
				<span>{tr('detail.status')}</span>
				<select
					value={status}
					onChange={(event: ChangeEvent<HTMLSelectElement>) =>
						setStatus(event.target.value as TradeSetupStatus)
					}
				>
					<option value="active">{tr('option.active')}</option>
					<option value="archived">{tr('option.archived')}</option>
				</select>
			</label>

			<label className="trader-journal-field">
				<span>{tr('detail.timeframes')}</span>
				<input
					type="text"
					value={timeframes}
					placeholder="1m, 5m"
					onChange={(event: ChangeEvent<HTMLInputElement>) => setTimeframes(event.target.value)}
				/>
			</label>

			<div className="trader-journal-form__actions">
				<button type="button" onClick={closeModal} disabled={isSaving}>
					{tr('action.cancel')}
				</button>
				<button type="submit" className="mod-cta" disabled={isSaving}>
					{isSaving
						? tr('action.saving')
						: tr(isEditing ? 'action.updateSetup' : 'action.createSetup')}
				</button>
			</div>
		</form>
	);
}

export class TradeSetupModal extends Modal {
	private root: Root | null = null;
	private readonly options: TradeSetupModalOptions;

	constructor(
		app: App,
		private readonly plugin: TraderJournalPlugin,
		options: TradeSetupModalOptions = {},
	) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.titleEl.empty();
		this.modalEl.addClass('trader-journal-modal-shell');
		this.contentEl.addClass('trader-journal-modal-content');
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TradeSetupModalContent
					plugin={this.plugin}
					closeModal={() => this.close()}
					initialSetup={this.options.initialSetup}
					onSaved={this.options.onSaved}
					openAfterSave={this.options.openAfterSave ?? true}
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

function parseCsvList(value: string): string[] {
	return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}
