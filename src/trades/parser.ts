import { parseYaml } from 'obsidian';
import { parseTradeJson } from './format';
import { TRADE_CODE_BLOCK_LANGUAGE } from './types';
import type { TradeEntry } from './types';

const TRADE_BLOCK_PATTERN = /```trader-journal-trade\s*\n([\s\S]*?)\n```/g;

export interface MarkdownParts {
	frontmatter: string;
	body: string;
}

export interface ExtractedTrades {
	trades: TradeEntry[];
	invalidTradeBlockCount: number;
}

export function splitFrontmatter(content: string): MarkdownParts {
	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);

	if (!match?.[0]) {
		return {
			frontmatter: '',
			body: content,
		};
	}

	return {
		frontmatter: match[0],
		body: content.slice(match[0].length),
	};
}

export function parseFrontmatter(frontmatter: string): Record<string, unknown> {
	const match = frontmatter.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const yaml = match?.[1];
	if (!yaml) {
		return {};
	}

	const parsed: unknown = parseYaml(yaml);
	return isRecord(parsed) ? parsed : {};
}

export function extractTrades(body: string): ExtractedTrades {
	const trades: TradeEntry[] = [];
	let invalidTradeBlockCount = 0;

	for (const match of body.matchAll(TRADE_BLOCK_PATTERN)) {
		const source = match[1];
		if (!source?.trim()) {
			invalidTradeBlockCount += 1;
			continue;
		}

		const { trade } = parseTradeJson(source);
		if (trade) {
			trades.push(trade);
		} else {
			invalidTradeBlockCount += 1;
		}
	}

	return {
		trades,
		invalidTradeBlockCount,
	};
}

export function hasTradeBlocks(content: string): boolean {
	return content.includes(`\`\`\`${TRADE_CODE_BLOCK_LANGUAGE}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
