import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

function TraderJournalModalContent() {
	return (
		<div className="trader-journal-modal">
			<h2>Trader journal</h2>
			<p>React is rendering this Obsidian modal.</p>
		</div>
	);
}

export class TraderJournalModal extends Modal {
	private root: Root | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		this.setTitle('Trader journal');
		this.contentEl.empty();
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<TraderJournalModalContent />
			</StrictMode>,
		);
	}

	onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
