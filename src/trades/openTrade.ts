import { MarkdownView } from 'obsidian';
import type TraderJournalPlugin from '../main';
import type { JournalCalendarTrade } from './journalIndex';

export async function openJournalTrade(
	plugin: TraderJournalPlugin,
	trade: JournalCalendarTrade,
): Promise<void> {
	await plugin.app.workspace.openLinkText(trade.filePath, '', false);
	if (trade.headingLine === null) {
		return;
	}

	window.setTimeout(() => {
		const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || markdownView.file?.path !== trade.filePath) {
			return;
		}

		const position = { line: trade.headingLine ?? 0, ch: 0 };
		markdownView.editor.setCursor(position);
		markdownView.editor.scrollIntoView({ from: position, to: position }, true);
	}, 50);
}
