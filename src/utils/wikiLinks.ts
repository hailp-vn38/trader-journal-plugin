export function createWikiLink(filePath: string): string {
	const linkPath = filePath.trim().replace(/\.md$/i, '');
	return linkPath ? `[[${linkPath}]]` : '';
}
