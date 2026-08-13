import assert from 'node:assert/strict';
import test from 'node:test';
import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { JournalDataService, type JournalDataSnapshot } from '../src/journal/JournalDataService';
import type TraderJournalPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/settings';

type VaultEvent = 'create' | 'modify' | 'delete' | 'rename';
type VaultListener = (...args: unknown[]) => void;

class FakeVault {
	private readonly listeners = new Map<VaultEvent, Set<VaultListener>>();
	private readonly filesByPath = new Map<string, TAbstractFile>();
	private readonly contents = new Map<string, string>();

	on(event: VaultEvent, listener: VaultListener): object {
		const listeners = this.listeners.get(event) ?? new Set<VaultListener>();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return { event, listener };
	}

	emit(event: VaultEvent, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(...args);
		}
	}

	add(file: TAbstractFile, content = ''): void {
		this.filesByPath.set(file.path, file);
		if (file instanceof TFile) {
			this.contents.set(file.path, content);
		}
	}

	setContent(file: TFile, content: string): void {
		this.contents.set(file.path, content);
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.filesByPath.get(path) ?? null;
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.contents.get(file.path) ?? '';
	}
}

void test('keeps snapshot identity and notify count stable for no-op vault events', async () => {
	(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
	const vault = new FakeVault();
	const backtestRoot = createFolder('Trading/Backtests');
	const liveRoot = createFolder('Trading/Live');
	const planRoot = createFolder('Trading/Live/_plans');
	const tradeFile = createFile('Trading/Backtests/NQ/2026/08/2026-08-13.md');
	const unrelatedFile = createFile('Notes/unrelated.md');
	const tradeContent = createTradeContent('initial');

	backtestRoot.children.push(tradeFile);
	liveRoot.children.push(planRoot);
	vault.add(backtestRoot);
	vault.add(liveRoot);
	vault.add(planRoot);
	vault.add(tradeFile, tradeContent);
	vault.add(unrelatedFile, '# Unrelated');

	const plugin = {
		settings: { ...DEFAULT_SETTINGS },
		app: { vault },
		register: () => undefined,
		registerEvent: () => undefined,
	} as unknown as TraderJournalPlugin;
	const service = new JournalDataService(plugin);
	const notifications: JournalDataSnapshot[] = [];
	const unsubscribe = service.subscribe((snapshot) => notifications.push(snapshot));
	await service.refresh();

	const stableSnapshot = service.getSnapshot();
	const stableNotifyCount = notifications.length;
	vault.emit('modify', unrelatedFile);
	assert.equal(service.getSnapshot(), stableSnapshot);
	assert.equal(notifications.length, stableNotifyCount);

	vault.emit('modify', tradeFile);
	await waitForDebounce();
	assert.equal(service.getSnapshot(), stableSnapshot);
	assert.equal(notifications.length, stableNotifyCount);

	vault.setContent(tradeFile, createTradeContent('changed'));
	vault.emit('modify', tradeFile);
	await waitForDebounce();
	assert.notEqual(service.getSnapshot(), stableSnapshot);
	assert.equal(notifications.length, stableNotifyCount + 1);
	unsubscribe();
});

function createTradeContent(notes: string): string {
	return [
		'```trader-journal-trade',
		JSON.stringify({
			id: 'trade-1',
			symbol: 'NQ',
			journalDate: '2026-08-13',
			journal_type: 'backtest',
			notes,
		}),
		'```',
	].join('\n');
}

async function waitForDebounce(): Promise<void> {
	await new Promise((resolve) => window.setTimeout(resolve, 320));
}

function createFile(path: string): TFile {
	const FileConstructor = TFile as unknown as new (filePath: string) => TFile;
	return new FileConstructor(path);
}

function createFolder(path: string): TFolder {
	const FolderConstructor = TFolder as unknown as new (folderPath: string) => TFolder;
	return new FolderConstructor(path);
}
