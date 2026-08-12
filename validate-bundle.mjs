import { readFile } from 'node:fs/promises';

const bundle = await readFile('main.js', 'utf8');
const dynamicScriptCreations = bundle.match(/\.createElement\(\s*['"]script['"]\s*\)/giu) ?? [];

if (dynamicScriptCreations.length > 0) {
	console.error(`Found ${dynamicScriptCreations.length} dynamic <script> element creation(s) in main.js.`);
	process.exitCode = 1;
} else {
	console.log('Bundle security validation passed.');
}
