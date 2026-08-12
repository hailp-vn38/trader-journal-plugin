import { MarkdownRenderChild } from 'obsidian';
import type { Events, MarkdownPostProcessorContext } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { IMAGE_MODAL_SETTING_CHANGE_EVENT } from '../settings';

export function registerImageModalInteraction(
	plugin: TraderJournalPlugin,
	imageEl: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	ariaLabel: string,
	openModal: () => void,
): void {
	const applySetting = () => {
		const enabled = plugin.settings.openImageModalOnClick;
		imageEl.classList.toggle('trader-journal-trade-image-button--interactive', enabled);

		if (enabled) {
			imageEl.setAttribute('role', 'button');
			imageEl.setAttribute('tabindex', '0');
			imageEl.setAttribute('aria-label', ariaLabel);
			return;
		}

		imageEl.removeAttribute('role');
		imageEl.removeAttribute('tabindex');
		imageEl.removeAttribute('aria-label');
	};

	applySetting();
	const child = new MarkdownRenderChild(imageEl);
	child.registerDomEvent(imageEl, 'click', () => {
		if (plugin.settings.openImageModalOnClick) {
			openModal();
		}
	});
	child.registerDomEvent(imageEl, 'keydown', (event) => {
		if (
			!plugin.settings.openImageModalOnClick ||
			(event.key !== 'Enter' && event.key !== ' ')
		) {
			return;
		}

		event.preventDefault();
		openModal();
	});
	const eventRef = (plugin.app.workspace as Events).on(
		IMAGE_MODAL_SETTING_CHANGE_EVENT,
		(..._data: unknown[]) => applySetting(),
	);
	child.register(() => plugin.app.workspace.offref(eventRef));
	ctx.addChild(child);
}
