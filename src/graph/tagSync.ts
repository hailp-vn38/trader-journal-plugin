import type TraderJournalPlugin from '../main';
import { hasFrontmatterTag, mergeFrontmatterTags } from '../utils/frontmatterTags';

const GRAPH_NOTE_TYPES = new Set([
	'trader-journal-setup',
	'trader-journal-live-plan',
	'trader-journal-live-symbol-day',
	'trader-journal-symbol-day',
]);

export async function syncGraphTypeTags(plugin: TraderJournalPlugin): Promise<void> {
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const noteType = typeof frontmatter?.type === 'string' ? frontmatter.type.trim() : '';
		if (!GRAPH_NOTE_TYPES.has(noteType) || hasFrontmatterTag(frontmatter?.tags, noteType)) {
			continue;
		}

		try {
			await plugin.app.fileManager.processFrontMatter(file, (currentFrontmatter) => {
				const metadata = currentFrontmatter as Record<string, unknown>;
				metadata.tags = mergeFrontmatterTags(metadata.tags, [noteType]);
			});
		} catch (error) {
			console.error(`Trader Journal failed to add graph tag to ${file.path}`, error);
		}
	}
}
