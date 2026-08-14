import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { StrictMode, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { getTranslator } from '../i18n';
import { updateTradeInJournalFile } from '../trades/storage';
import type { TradeEntry } from '../trades/types';
import {
	TradeReviewFields,
	buildTradeReview,
	createTradeReviewFormState,
	isTradeReviewFormEmpty,
} from './TradeReviewFields';

interface TradeReviewModalContentProps {
	plugin: TraderJournalPlugin;
	trade: TradeEntry;
	filePath: string;
	closeModal: () => void;
}

function TradeReviewModalContent({ plugin, trade, filePath, closeModal }: TradeReviewModalContentProps) {
	const [review, setReview] = useState(() => createTradeReviewFormState(trade.review));
	const [error, setError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const tr = getTranslator(plugin.settings.language);

	const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving) {
			return;
		}
		if (isTradeReviewFormEmpty(review)) {
			setError(tr('error.reviewRequired'));
			return;
		}

		void saveReview();
	};

	const saveReview = async () => {
		const nextReview = buildTradeReview(review, getCurrentLocalIsoString());
		if (!nextReview) {
			return;
		}

		try {
			setIsSaving(true);
			setError('');
			const file = await updateTradeInJournalFile(plugin, filePath, { ...trade, review: nextReview });
			new Notice(tr('notice.savedReview', { path: file.path }));
			closeModal();
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : tr('error.couldNotSaveReview'));
			setIsSaving(false);
		}
	};

	return (
		<form className="trader-journal-modal trader-journal-form" onSubmit={handleSubmit}>
			<div className="trader-journal-form__body">
			<h2>{tr('modal.reviewTrade')}</h2>
			{error ? <div className="trader-journal-form__error">{error}</div> : null}
			<TradeReviewFields value={review} onChange={setReview} tr={tr} compact />
			</div>
			<div className="trader-journal-form__actions">
				<button type="button" onClick={closeModal} disabled={isSaving}>{tr('action.cancel')}</button>
				<button type="submit" className="mod-cta" disabled={isSaving}>
					{isSaving ? tr('action.saving') : tr('action.saveReview')}
				</button>
			</div>
		</form>
	);
}

export class TradeReviewModal extends Modal {
	private root: Root | null = null;

	constructor(
		app: App,
		private readonly plugin: TraderJournalPlugin,
		private readonly trade: TradeEntry,
		private readonly filePath: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.empty();
		this.modalEl.addClass('trader-journal-modal-shell');
		this.contentEl.addClass('trader-journal-modal-content');
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TradeReviewModalContent
					plugin={this.plugin}
					trade={this.trade}
					filePath={this.filePath}
					closeModal={() => this.close()}
				/>
			</StrictMode>,
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.modalEl.removeClass('trader-journal-modal-shell');
		this.contentEl.removeClass('trader-journal-modal-content');
		this.contentEl.empty();
	}
}

function getCurrentLocalIsoString(): string {
	const now = new Date();
	const timezoneOffsetMinutes = -now.getTimezoneOffset();
	const offsetSign = timezoneOffsetMinutes >= 0 ? '+' : '-';
	const absoluteOffset = Math.abs(timezoneOffsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
	const offsetMinutes = String(absoluteOffset % 60).padStart(2, '0');
	const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
	return `${localTime}${offsetSign}${offsetHours}:${offsetMinutes}`;
}
