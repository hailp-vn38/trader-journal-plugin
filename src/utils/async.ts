export const INDEX_READ_CONCURRENCY = 8;

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}

	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			const item = items[index];
			if (item !== undefined) {
				results[index] = await mapper(item, index);
			}
		}
	}

	await Promise.all(Array.from({ length: workerCount }, async () => worker()));
	return results;
}
