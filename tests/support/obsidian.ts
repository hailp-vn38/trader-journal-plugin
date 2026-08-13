export class TAbstractFile {
	path: string;
	name: string;
	parent: TFolder | null = null;

	constructor(path: string) {
		this.path = normalizePath(path);
		this.name = this.path.split('/').pop() ?? '';
	}
}

export class TFile extends TAbstractFile {
	extension: string;
	basename: string;
	stat = { ctime: 1, mtime: 1, size: 1 };

	constructor(path: string) {
		super(path);
		const dotIndex = this.name.lastIndexOf('.');
		this.extension = dotIndex === -1 ? '' : this.name.slice(dotIndex + 1);
		this.basename = dotIndex === -1 ? this.name : this.name.slice(0, dotIndex);
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function stringifyYaml(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

export function parseYaml(): unknown {
	return {};
}
