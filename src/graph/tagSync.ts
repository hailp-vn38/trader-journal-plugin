import { TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { classifyTraderJournalPath, normalizeScopePath } from '../journal/pathScope';
import { hasFrontmatterTag, mergeFrontmatterTags } from '../utils/frontmatterTags';

const GRAPH_TAG_MIGRATION_VERSION = 1;
const MIGRATION_BATCH_SIZE = 50;
const INCREMENTAL_SYNC_DEBOUNCE_MS = 200;

const GRAPH_NOTE_TYPES = new Set([
	'trader-journal-setup',
	'trader-journal-live-plan',
	'trader-journal-live-symbol-day',
	'trader-journal-symbol-day',
]);

export async function syncGraphTypeTags(plugin: TraderJournalPlugin): Promise<void> {
	registerIncrementalGraphTagSync(plugin);
	if (plugin.dataMigrationVersion >= GRAPH_TAG_MIGRATION_VERSION) {
		return;
	}

	let hasErrors = false;
	const files = collectScopedMarkdownFiles(plugin);
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		if (file && !(await ensureGraphTypeTag(plugin, file))) {
			hasErrors = true;
		}
		if ((index + 1) % MIGRATION_BATCH_SIZE === 0) {
			await yieldToEventLoop();
		}
	}

	if (!hasErrors) {
		await plugin.saveDataMigrationVersion(GRAPH_TAG_MIGRATION_VERSION);
	}
}

function registerIncrementalGraphTagSync(plugin: TraderJournalPlugin): void {
	const timers = new Map<string, number>();
	const schedule = (file: TFile): void => {
		if (!isGraphScopeFile(plugin, file)) {
			return;
		}

		const existingTimer = timers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const timer = window.setTimeout(() => {
			timers.delete(file.path);
			void ensureGraphTypeTag(plugin, file);
		}, INCREMENTAL_SYNC_DEBOUNCE_MS);
		timers.set(file.path, timer);
	};

	plugin.registerEvent(
		plugin.app.vault.on('create', (file) => {
			if (file instanceof TFile) {
				schedule(file);
			}
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on('rename', (file) => {
			if (file instanceof TFile) {
				schedule(file);
			}
		}),
	);
	plugin.registerEvent(plugin.app.metadataCache.on('changed', (file) => schedule(file)));
	plugin.register(() => {
		for (const timer of timers.values()) {
			window.clearTimeout(timer);
		}
		timers.clear();
	});
}

function collectScopedMarkdownFiles(plugin: TraderJournalPlugin): TFile[] {
	const filesByPath = new Map<string, TFile>();
	const visitedFolders = new Set<string>();
	for (const rootPath of getConfiguredRootPaths(plugin)) {
		const root = rootPath
			? plugin.app.vault.getAbstractFileByPath(rootPath)
			: plugin.app.vault.getRoot();
		if (root instanceof TFolder) {
			collectFolderFiles(plugin, root, filesByPath, visitedFolders);
		}
	}
	return [...filesByPath.values()].sort((first, second) => first.path.localeCompare(second.path));
}

function collectFolderFiles(
	plugin: TraderJournalPlugin,
	folder: TFolder,
	filesByPath: Map<string, TFile>,
	visitedFolders: Set<string>,
): void {
	if (visitedFolders.has(folder.path)) {
		return;
	}
	visitedFolders.add(folder.path);
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectFolderFiles(plugin, child, filesByPath, visitedFolders);
		} else if (child instanceof TFile && isGraphScopeFile(plugin, child)) {
			filesByPath.set(child.path, child);
		}
	}
}

function getConfiguredRootPaths(plugin: TraderJournalPlugin): string[] {
	return [
		plugin.settings.journalFolder,
		plugin.settings.liveJournalFolder,
		plugin.settings.planFolder,
		plugin.settings.setupFolder,
	]
		.map(normalizeScopePath)
		.filter((path, index, paths) => paths.indexOf(path) === index);
}

function isGraphScopeFile(plugin: TraderJournalPlugin, file: TFile): boolean {
	if (file.extension !== 'md') {
		return false;
	}
	const kind = classifyTraderJournalPath(plugin, file.path);
	return kind === 'journal' || kind === 'plan' || kind === 'setup';
}

async function ensureGraphTypeTag(plugin: TraderJournalPlugin, file: TFile): Promise<boolean> {
	const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	const noteType = typeof frontmatter?.type === 'string' ? frontmatter.type.trim() : '';
	if (!GRAPH_NOTE_TYPES.has(noteType) || hasFrontmatterTag(frontmatter?.tags, noteType)) {
		return true;
	}

	try {
		await plugin.app.fileManager.processFrontMatter(file, (currentFrontmatter) => {
			const metadata = currentFrontmatter as Record<string, unknown>;
			metadata.tags = mergeFrontmatterTags(metadata.tags, [noteType]);
		});
		return true;
	} catch (error) {
		console.error(`Trader Journal failed to add graph tag to ${file.path}`, error);
		return false;
	}
}

async function yieldToEventLoop(): Promise<void> {
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}
