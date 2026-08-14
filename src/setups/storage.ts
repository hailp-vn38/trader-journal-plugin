import { normalizePath, stringifyYaml, TFile, TFolder } from 'obsidian';
import type TraderJournalPlugin from '../main';
import { stringifyValue } from '../trades/format';
import { parseFrontmatter, splitFrontmatter } from '../trades/parser';
import type { NewTradeSetup, TradeSetupDefinition, TradeSetupStatus } from './types';
import { mergeFrontmatterTags } from '../utils/frontmatterTags';
import { normalizeSymbol } from '../settings';
import { INDEX_READ_CONCURRENCY, mapWithConcurrency } from '../utils/async';
import {
	getTraderJournalNoteType,
	setTraderJournalNoteType,
	TRADER_JOURNAL_NOTE_TYPE_KEY,
} from '../utils/noteType';

const SETUP_NOTE_TYPE = 'trader-journal-setup';
const DEFAULT_SETUP_FOLDER = 'Trading/_setups';

const SETUP_SECTIONS = [
	'Description',
	'Entry criteria',
	'Invalidation',
	'Take profit',
	'Risk rules',
] as const;

export async function listTradeSetups(plugin: TraderJournalPlugin): Promise<TradeSetupDefinition[]> {
	return plugin.referenceDataService.listSetups();
}

export async function scanTradeSetups(plugin: TraderJournalPlugin): Promise<TradeSetupDefinition[]> {
	const rootFolder = plugin.app.vault.getAbstractFileByPath(getSetupRootFolder(plugin));
	if (!(rootFolder instanceof TFolder)) {
		return [];
	}

	const files: TFile[] = [];
	collectMarkdownFiles(rootFolder, files);
	const setups = await mapWithConcurrency(files, INDEX_READ_CONCURRENCY, async (file) =>
		readTradeSetupFile(plugin, file),
	);

	return setups
		.filter((setup): setup is TradeSetupDefinition => setup !== null)
		.sort((first, second) => first.name.localeCompare(second.name));
}

export async function createTradeSetup(
	plugin: TraderJournalPlugin,
	setup: NewTradeSetup,
): Promise<TradeSetupDefinition> {
	const name = setup.name.trim();
	if (!name) {
		throw new Error('Setup name is required.');
	}

	const root = getSetupRootFolder(plugin);
	await ensureFolder(plugin, root);
	const existingSetups = await listTradeSetups(plugin);
	const existingIds = new Set(existingSetups.map((item) => item.id));
	const id = createUniqueSetupId(name, existingIds);
	const filePath = getUniqueSetupFilePath(plugin, root, name);
	const updatedAt = getCurrentLocalIsoString();
	const normalizedSetup: TradeSetupDefinition = {
		id,
		name,
		status: normalizeSetupStatus(setup.status),
		symbols: normalizeSymbols(setup.symbols),
		timeframes: normalizeTimeframes(setup.timeframes),
		updatedAt,
		description: '',
		entryCriteria: '',
		invalidation: '',
		takeProfit: '',
		riskRules: '',
		filePath,
	};

	const file = await plugin.app.vault.create(filePath, renderSetupNote(normalizedSetup));
	await plugin.referenceDataService.refreshFile(file);
	return normalizedSetup;
}

export async function updateTradeSetup(
	plugin: TraderJournalPlugin,
	initialSetup: TradeSetupDefinition,
	setup: NewTradeSetup,
): Promise<TradeSetupDefinition> {
	const name = setup.name.trim();
	if (!name) {
		throw new Error('Setup name is required.');
	}

	const abstractFile = plugin.app.vault.getAbstractFileByPath(initialSetup.filePath);
	if (!(abstractFile instanceof TFile)) {
		throw new Error(`Could not find ${initialSetup.filePath}.`);
	}

	const updatedSetup: TradeSetupDefinition = {
		...initialSetup,
		name,
		status: normalizeSetupStatus(setup.status),
		symbols: normalizeSymbols(setup.symbols),
		timeframes: normalizeTimeframes(setup.timeframes),
		updatedAt: getCurrentLocalIsoString(),
	};

	await plugin.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
		const metadata = frontmatter as Record<string, unknown>;
		setTraderJournalNoteType(metadata, SETUP_NOTE_TYPE);
		metadata.tags = mergeFrontmatterTags(metadata.tags, [SETUP_NOTE_TYPE]);
		metadata.setupId = initialSetup.id;
		metadata.name = updatedSetup.name;
		metadata.status = updatedSetup.status;
		metadata.symbols = updatedSetup.symbols;
		metadata.timeframes = updatedSetup.timeframes;
		metadata.updatedAt = updatedSetup.updatedAt;
	});
	await plugin.app.vault.process(abstractFile, (content) => updateSetupTitle(content, updatedSetup.name));
	await plugin.referenceDataService.refreshFile(abstractFile);

	return updatedSetup;
}

export function getSetupRootFolder(plugin: TraderJournalPlugin): string {
	return normalizePath(plugin.settings.setupFolder || DEFAULT_SETUP_FOLDER).replace(/\/$/, '');
}

export async function readTradeSetupFile(
	plugin: TraderJournalPlugin,
	file: TFile,
): Promise<TradeSetupDefinition | null> {
	try {
		const content = await plugin.app.vault.cachedRead(file);
		const { frontmatter, body } = splitFrontmatter(content);
		const metadata = parseFrontmatter(frontmatter);
		if (getTraderJournalNoteType(metadata) !== SETUP_NOTE_TYPE) {
			return null;
		}

		const id = stringifyValue(metadata.setupId);
		const name = stringifyValue(metadata.name);
		if (!id || !name) {
			console.warn(`Trader Journal ignored setup without setupId or name: ${file.path}`);
			return null;
		}

		return {
			id,
			name,
			status: normalizeSetupStatus(metadata.status),
			symbols: normalizeSymbols(metadata.symbols),
			timeframes: normalizeTimeframes(metadata.timeframes),
			updatedAt: stringifyValue(metadata.updatedAt),
			description: extractSetupSection(body, 'Description'),
			entryCriteria: extractSetupSection(body, 'Entry criteria'),
			invalidation: extractSetupSection(body, 'Invalidation'),
			takeProfit: extractSetupSection(body, 'Take profit'),
			riskRules: extractSetupSection(body, 'Risk rules'),
			filePath: file.path,
		};
	} catch (error) {
		console.error(`Trader Journal failed to read setup ${file.path}`, error);
		return null;
	}
}

function extractSetupSection(body: string, heading: typeof SETUP_SECTIONS[number]): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(
		`(?:^|\\r?\\n)##[ \\t]+${escapedHeading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##[ \\t]+|$)`,
		'i',
	);
	return pattern.exec(body)?.[1]?.trim() ?? '';
}

function renderSetupNote(setup: TradeSetupDefinition): string {
	const frontmatter = stringifyYaml({
		[TRADER_JOURNAL_NOTE_TYPE_KEY]: SETUP_NOTE_TYPE,
		tags: mergeFrontmatterTags(undefined, [SETUP_NOTE_TYPE]),
		setupId: setup.id,
		name: setup.name,
		status: setup.status,
		symbols: setup.symbols,
		timeframes: setup.timeframes,
		updatedAt: setup.updatedAt,
	});
	const sections = SETUP_SECTIONS.map((heading) => `## ${heading}\n`).join('\n');
	return `---\n${frontmatter}---\n\n# ${setup.name}\n\n${sections}`;
}

function updateSetupTitle(content: string, name: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const titlePattern = /^#\s+.*$/m;
	const nextBody = titlePattern.test(body)
		? body.replace(titlePattern, `# ${name}`)
		: `\n# ${name}\n${body}`;
	return `${frontmatter}${nextBody}`;
}

function normalizeSetupStatus(value: unknown): TradeSetupStatus {
	return value === 'archived' ? 'archived' : 'active';
}

function normalizeTimeframes(value: unknown): string[] {
	return normalizeStringList(value, (item) => item);
}

function normalizeSymbols(value: unknown): string[] {
	return normalizeStringList(value, normalizeSymbol);
}

function normalizeStringList(value: unknown, normalize: (item: string) => string): string[] {
	const values = Array.isArray(value)
		? value
		: typeof value === 'string'
			? value.split(',')
			: [];
	return [...new Set(values.map((item) => normalize(stringifyValue(item))).filter(Boolean))];
}

export function isSetupAvailableForSymbol(setup: TradeSetupDefinition, symbol: string): boolean {
	const normalizedSymbol = normalizeSymbol(symbol);
	return setup.symbols.length === 0 || !normalizedSymbol || setup.symbols.includes(normalizedSymbol);
}

function createUniqueSetupId(name: string, existingIds: Set<string>): string {
	const baseId = `setup-${slugify(name) || 'setup'}`;
	let id = baseId;
	let suffix = 2;
	while (existingIds.has(id)) {
		id = `${baseId}-${suffix}`;
		suffix += 1;
	}
	return id;
}

function getUniqueSetupFilePath(plugin: TraderJournalPlugin, root: string, name: string): string {
	const baseName = slugify(name) || 'setup';
	let filePath = normalizePath(`${root}/${baseName}.md`);
	let suffix = 2;
	while (plugin.app.vault.getAbstractFileByPath(filePath)) {
		filePath = normalizePath(`${root}/${baseName}-${suffix}.md`);
		suffix += 1;
	}
	return filePath;
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectMarkdownFiles(child, files);
		} else if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
		}
	}
}

async function ensureFolder(plugin: TraderJournalPlugin, folderPath: string): Promise<void> {
	let currentPath = '';
	for (const segment of normalizePath(folderPath).split('/')) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		const abstractFile = plugin.app.vault.getAbstractFileByPath(currentPath);
		if (abstractFile instanceof TFolder) {
			continue;
		}
		if (abstractFile instanceof TFile) {
			throw new Error(`${currentPath} is a file, not a folder.`);
		}
		await plugin.app.vault.createFolder(currentPath);
	}
}

function getCurrentLocalIsoString(): string {
	const now = new Date();
	const offsetMinutes = -now.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
	const offsetRemainder = String(absoluteOffset % 60).padStart(2, '0');
	const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	return `${localDate}${sign}${offsetHours}:${offsetRemainder}`;
}
