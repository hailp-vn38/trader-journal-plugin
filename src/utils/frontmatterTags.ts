import { stringifyValue } from '../trades/format';

export function mergeFrontmatterTags(value: unknown, requiredTags: string[]): string[] {
	const existingTags = normalizeFrontmatterTags(value);
	const normalizedRequiredTags = requiredTags
		.map((tag) => normalizeTag(tag))
		.filter(Boolean);

	return [...new Set([...existingTags, ...normalizedRequiredTags])];
}

export function hasFrontmatterTag(value: unknown, tag: string): boolean {
	return normalizeFrontmatterTags(value).includes(normalizeTag(tag));
}

function normalizeFrontmatterTags(value: unknown): string[] {
	const values = Array.isArray(value)
		? value
		: typeof value === 'string'
			? value.split(/[\s,]+/)
			: [];

	return values
		.map((tag) => normalizeTag(stringifyValue(tag)))
		.filter(Boolean);
}

function normalizeTag(value: string): string {
	return value.trim().replace(/^#+/, '');
}
