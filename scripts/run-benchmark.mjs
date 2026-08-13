import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import path from 'node:path';

const projectRoot = process.cwd();
const result = await build({
	entryPoints: [path.join(projectRoot, 'benchmarks/performance.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node18',
	write: false,
	alias: {
		obsidian: path.join(projectRoot, 'tests/support/obsidian.ts'),
	},
});

const output = result.outputFiles[0];
if (!output) {
	throw new Error('Benchmark bundle was not generated.');
}

const source = Buffer.from(output.contents).toString('base64');
await import(`data:text/javascript;base64,${source}`);
