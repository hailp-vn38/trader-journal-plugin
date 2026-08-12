import { readFile } from 'node:fs/promises';

const manifest = await readJson('manifest.json');
const packageJson = await readJson('package.json');
const versions = await readJson('versions.json');
const errors = [];

const requiredFields = {
	id: 'string',
	name: 'string',
	version: 'string',
	minAppVersion: 'string',
	description: 'string',
	author: 'string',
	isDesktopOnly: 'boolean',
};
const allowedFields = new Set([
	...Object.keys(requiredFields),
	'authorUrl',
	'fundingUrl',
	'helpUrl',
]);

for (const [field, expectedType] of Object.entries(requiredFields)) {
	if (typeof manifest[field] !== expectedType || (expectedType === 'string' && manifest[field].length === 0)) {
		errors.push(`manifest.json field "${field}" must be a non-empty ${expectedType}.`);
	}
}

for (const field of Object.keys(manifest)) {
	if (!allowedFields.has(field)) {
		errors.push(`manifest.json contains unsupported field "${field}".`);
	}
}

if (typeof manifest.id === 'string') {
	if (!/^[a-z-]+$/.test(manifest.id)) {
		errors.push('Plugin ID may contain only lowercase letters and hyphens.');
	}
	if (manifest.id.includes('obsidian')) {
		errors.push('Plugin ID must not contain "obsidian".');
	}
	if (manifest.id.endsWith('plugin')) {
		errors.push('Plugin ID must not end with "plugin".');
	}
}

if (typeof manifest.name === 'string') {
	const normalizedName = manifest.name.toLowerCase();
	if (normalizedName.includes('obsidian') || normalizedName.endsWith('plugin')) {
		errors.push('Plugin name must not contain "Obsidian" or end with "Plugin".');
	}
}

if (typeof manifest.description === 'string') {
	if (manifest.description.toLowerCase().includes('obsidian')) {
		errors.push('Plugin description must not contain "Obsidian".');
	}
	if (manifest.description.length > 250) {
		errors.push('Plugin description must not exceed 250 characters.');
	}
	if (!/[.?!)]$/.test(manifest.description)) {
		errors.push('Plugin description must end with punctuation.');
	}
}

const versionPattern = /^\d+\.\d+\.\d+$/;
if (typeof manifest.version === 'string' && !versionPattern.test(manifest.version)) {
	errors.push('Plugin version must use x.y.z format.');
}
if (typeof manifest.minAppVersion === 'string' && !versionPattern.test(manifest.minAppVersion)) {
	errors.push('Minimum app version must use x.y.z format.');
}
if (manifest.version !== packageJson.version) {
	errors.push('manifest.json and package.json versions must match.');
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	errors.push('versions.json must map the current plugin version to minAppVersion.');
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exitCode = 1;
} else {
	console.log('Manifest validation passed.');
}

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}
