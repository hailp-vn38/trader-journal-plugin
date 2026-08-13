import { normalizePath } from 'obsidian';
import type TraderJournalPlugin from '../main';

export type TraderJournalFileKind = 'journal' | 'plan' | 'setup' | 'attachment' | 'unrelated';

interface ScopeRoot {
	kind: Exclude<TraderJournalFileKind, 'unrelated'>;
	path: string;
}

const KIND_PRIORITY: Record<ScopeRoot['kind'], number> = {
	journal: 0,
	plan: 1,
	setup: 2,
	attachment: 3,
};

export function classifyTraderJournalPath(
	plugin: TraderJournalPlugin,
	path: string,
): TraderJournalFileKind {
	const normalizedPath = normalizeScopePath(path);
	const matches = getScopeRoots(plugin).filter((root) => isPathInFolder(normalizedPath, root.path));
	if (matches.length === 0) {
		return 'unrelated';
	}

	matches.sort((first, second) => {
		if (first.path.length !== second.path.length) {
			return second.path.length - first.path.length;
		}

		return KIND_PRIORITY[second.kind] - KIND_PRIORITY[first.kind];
	});

	return matches[0]?.kind ?? 'unrelated';
}

export function isPathInFolder(path: string, folderPath: string): boolean {
	const normalizedPath = normalizeScopePath(path);
	const normalizedFolder = normalizeScopePath(folderPath);
	return normalizedFolder === '' || normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function normalizeScopePath(path: string): string {
	const normalizedPath = normalizePath(path.trim()).replace(/^\/+|\/+$/g, '');
	return normalizedPath === '.' ? '' : normalizedPath;
}

function getScopeRoots(plugin: TraderJournalPlugin): ScopeRoot[] {
	const journalRoots = [plugin.settings.journalFolder, plugin.settings.liveJournalFolder].map(normalizeScopePath);
	const attachmentRoots = journalRoots.map((root) => normalizeScopePath(`${root}/_attachments`));
	const roots: ScopeRoot[] = [
		...journalRoots.map((path): ScopeRoot => ({ kind: 'journal', path })),
		{ kind: 'plan', path: normalizeScopePath(plugin.settings.planFolder) },
		{ kind: 'setup', path: normalizeScopePath(plugin.settings.setupFolder) },
		...attachmentRoots.map((path): ScopeRoot => ({ kind: 'attachment', path })),
	];

	const uniqueRoots = new Map<string, ScopeRoot>();
	for (const root of roots) {
		const key = `${root.kind}:${root.path}`;
		uniqueRoots.set(key, root);
	}

	return [...uniqueRoots.values()];
}
