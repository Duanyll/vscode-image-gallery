import * as vscode from 'vscode';
import { hash256 } from '../utils';

export interface ImageDimensions {
	width: number;
	height: number;
}

export interface CacheEntry {
	uri: vscode.Uri;
	dimensions: ImageDimensions | null;
}

export class ThumbnailCache {
	private cacheDir: vscode.Uri;
	private maxDiskSizeBytes: number;
	private index: Map<string, CacheEntry> = new Map();
	private pathKeyMap: Map<string, Set<string>> = new Map();
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	constructor(cacheDir: vscode.Uri, maxDiskSizeMB: number) {
		this.cacheDir = cacheDir;
		this.maxDiskSizeBytes = maxDiskSizeMB * 1024 * 1024;
	}

	private cacheKey(imagePath: string, mtime: number): string {
		return hash256(imagePath + ':' + mtime, 32);
	}

	async init(): Promise<void> {
		if (this.initialized) { return; }
		if (!this.initPromise) {
			this.initPromise = this.scanCacheDir();
		}
		return this.initPromise;
	}

	private async scanCacheDir(): Promise<void> {
		try {
			await vscode.workspace.fs.createDirectory(this.cacheDir);
			const entries = await vscode.workspace.fs.readDirectory(this.cacheDir);
			// First pass: collect image files
			const imageFiles = new Map<string, vscode.Uri>();
			const metaFiles = new Set<string>();
			for (const [name, type] of entries) {
				if (type !== vscode.FileType.File) { continue; }
				if (name.endsWith('.json')) {
					metaFiles.add(name);
				} else {
					const key = name.substring(0, name.lastIndexOf('.'));
					if (key) { imageFiles.set(key, vscode.Uri.joinPath(this.cacheDir, name)); }
				}
			}
			// Second pass: pair with metadata
			for (const [key, uri] of imageFiles) {
				let dimensions: ImageDimensions | null = null;
				if (metaFiles.has(key + '.json')) {
					try {
						const metaUri = vscode.Uri.joinPath(this.cacheDir, key + '.json');
						const raw = await vscode.workspace.fs.readFile(metaUri);
						dimensions = JSON.parse(Buffer.from(raw).toString());
					} catch { /* ignore corrupt meta */ }
				}
				this.index.set(key, { uri, dimensions });
			}
		} catch {
			// Cache dir doesn't exist yet or is unreadable
		}
		this.initialized = true;
	}

	async get(imagePath: string, mtime: number): Promise<CacheEntry | null> {
		await this.init();
		const key = this.cacheKey(imagePath, mtime);
		const entry = this.index.get(key);
		if (entry) {
			try {
				await vscode.workspace.fs.stat(entry.uri);
				return entry;
			} catch {
				this.index.delete(key);
				return null;
			}
		}
		return null;
	}

	async put(imagePath: string, mtime: number, data: Uint8Array, format: string, dimensions: ImageDimensions): Promise<CacheEntry> {
		await this.init();
		const key = this.cacheKey(imagePath, mtime);
		const filename = `${key}.${format}`;
		const uri = vscode.Uri.joinPath(this.cacheDir, filename);
		const metaUri = vscode.Uri.joinPath(this.cacheDir, `${key}.json`);

		await vscode.workspace.fs.writeFile(uri, data);
		await vscode.workspace.fs.writeFile(metaUri, Buffer.from(JSON.stringify(dimensions)));

		const entry: CacheEntry = { uri, dimensions };
		this.index.set(key, entry);

		// Track path → keys mapping for invalidation
		if (!this.pathKeyMap.has(imagePath)) {
			this.pathKeyMap.set(imagePath, new Set());
		}
		this.pathKeyMap.get(imagePath)!.add(key);

		return entry;
	}

	async clearAll(): Promise<void> {
		await this.init();
		try {
			const entries = await vscode.workspace.fs.readDirectory(this.cacheDir);
			for (const [name, type] of entries) {
				if (type === vscode.FileType.File) {
					try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.cacheDir, name)); } catch { /* ignore */ }
				}
			}
		} catch { /* ignore */ }
		this.index.clear();
		this.pathKeyMap.clear();
	}

	async invalidate(imagePath: string): Promise<void> {
		const keys = this.pathKeyMap.get(imagePath);
		if (!keys) { return; }
		for (const key of keys) {
			const entry = this.index.get(key);
			if (entry) {
				try { await vscode.workspace.fs.delete(entry.uri); } catch { /* ignore */ }
				const metaUri = vscode.Uri.joinPath(this.cacheDir, `${key}.json`);
				try { await vscode.workspace.fs.delete(metaUri); } catch { /* ignore */ }
				this.index.delete(key);
			}
		}
		this.pathKeyMap.delete(imagePath);
	}

	async cleanup(): Promise<void> {
		await this.init();
		try {
			const entries = await vscode.workspace.fs.readDirectory(this.cacheDir);
			const files: { name: string; key: string; uri: vscode.Uri; size: number; mtime: number }[] = [];
			let totalSize = 0;

			for (const [name, type] of entries) {
				if (type !== vscode.FileType.File || name.endsWith('.json')) { continue; }
				const uri = vscode.Uri.joinPath(this.cacheDir, name);
				try {
					const stat = await vscode.workspace.fs.stat(uri);
					const key = name.substring(0, name.lastIndexOf('.'));
					files.push({ name, key, uri, size: stat.size, mtime: stat.mtime });
					totalSize += stat.size;
				} catch { /* skip unreadable files */ }
			}

			if (totalSize <= this.maxDiskSizeBytes) { return; }

			// Sort by mtime ascending (oldest first) for eviction
			files.sort((a, b) => a.mtime - b.mtime);

			for (const file of files) {
				if (totalSize <= this.maxDiskSizeBytes) { break; }
				try {
					await vscode.workspace.fs.delete(file.uri);
					const metaUri = vscode.Uri.joinPath(this.cacheDir, `${file.key}.json`);
					try { await vscode.workspace.fs.delete(metaUri); } catch { /* ignore */ }
					totalSize -= file.size;
					this.index.delete(file.key);
				} catch { /* ignore */ }
			}
		} catch { /* cache dir may not exist */ }
	}
}
