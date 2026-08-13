import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWithConcurrency } from '../src/utils/async';

void test('mapWithConcurrency preserves order and never exceeds its limit', async () => {
	let active = 0;
	let peakActive = 0;
	const values = Array.from({ length: 40 }, (_, index) => index);
	const results = await mapWithConcurrency(values, 8, async (value) => {
		active += 1;
		peakActive = Math.max(peakActive, active);
		await new Promise((resolve) => setTimeout(resolve, 1));
		active -= 1;
		return value * 2;
	});

	assert.equal(peakActive, 8);
	assert.deepEqual(results, values.map((value) => value * 2));
});

void test('mapWithConcurrency handles empty input and clamps invalid limits', async () => {
	assert.deepEqual(await mapWithConcurrency([], 8, async (value) => value), []);
	assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (value) => value), [1, 2]);
});
