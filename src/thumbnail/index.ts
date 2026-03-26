import * as vscode from 'vscode';
import { TImage, ThumbnailConfig } from 'custom_typings';
import { ThumbnailCache, CacheEntry, ImageDimensions } from './cache';
import { generateThumbnail, disposeVips } from './compressor';

function isThumbnailEnabled(config: ThumbnailConfig): boolean {
	switch (config.enabled) {
		case 'always': return true;
		case 'never': return false;
		case 'remote': return vscode.env.remoteName !== undefined;
		default: return false;
	}
}

export class ThumbnailService {
	private cache: ThumbnailCache;
	private config: ThumbnailConfig;
	readonly effectivelyEnabled: boolean;
	private disposed = false;
	private readonly maxConcurrency = 3;

	constructor(context: vscode.ExtensionContext, config: ThumbnailConfig) {
		this.config = config;
		this.effectivelyEnabled = isThumbnailEnabled(config);
		const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'thumbnails');
		this.cache = new ThumbnailCache(cacheDir, config.diskCacheSizeMB);
	}

	private shouldSkip(image: TImage): boolean {
		const ext = image.ext.toLowerCase();
		return this.config.skipFormats.some(f => f.toLowerCase() === ext);
	}

	async getCachedEntry(image: TImage): Promise<CacheEntry | null> {
		if (!this.effectivelyEnabled || this.shouldSkip(image)) {
			return null;
		}
		return this.cache.get(image.uri.path, image.mtime);
	}

	async generateBatch(
		images: TImage[],
		webview: vscode.Webview,
		onReady: (imageId: string, thumbnailWebviewUri: string, dimensions: ImageDimensions | null) => void,
	): Promise<void> {
		const queue = images.filter(img => !this.shouldSkip(img));
		const active: Set<Promise<void>> = new Set();

		for (const image of queue) {
			if (this.disposed) { break; }

			// Wait if at concurrency limit
			if (active.size >= this.maxConcurrency) {
				await Promise.race(active);
			}

			const task = this.processOne(image, webview, onReady).finally(() => {
				active.delete(task);
			});
			active.add(task);
		}

		await Promise.allSettled(active);
		this.cache.cleanup();
	}

	private async processOne(
		image: TImage,
		webview: vscode.Webview,
		onReady: (imageId: string, thumbnailWebviewUri: string, dimensions: ImageDimensions | null) => void,
	): Promise<void> {
		if (this.disposed) { return; }

		try {
			// Check cache first
			const cached = await this.cache.get(image.uri.path, image.mtime);
			if (cached) {
				onReady(image.id, webview.asWebviewUri(cached.uri).toString(), cached.dimensions);
				return;
			}

			// Read original file
			const originalData = await vscode.workspace.fs.readFile(image.uri);

			if (this.disposed) { return; }

			// Generate thumbnail
			const result = await generateThumbnail(
				originalData,
				{
					maxSize: this.config.maxSize,
					quality: this.config.quality,
					format: this.config.format,
				},
			);

			if (this.disposed) { return; }

			const dimensions: ImageDimensions = { width: result.originalWidth, height: result.originalHeight };

			// Write to cache
			const entry = await this.cache.put(
				image.uri.path,
				image.mtime,
				result.data,
				this.config.format,
				dimensions,
			);

			onReady(image.id, webview.asWebviewUri(entry.uri).toString(), entry.dimensions);
		} catch (err) {
			// Log but don't crash — the image will stay as placeholder or original
			console.error(`Thumbnail generation failed for ${image.uri.path}:`, err);
		}
	}

	invalidate(imagePath: string): void {
		this.cache.invalidate(imagePath);
	}

	async clearCache(): Promise<void> {
		await this.cache.clearAll();
	}

	dispose(): void {
		this.disposed = true;
		disposeVips();
	}
}

export function readThumbnailConfig(): ThumbnailConfig {
	const config = vscode.workspace.getConfiguration('imageGallery.thumbnail');
	return {
		enabled: config.get<'always' | 'remote' | 'never'>('enabled', 'remote'),
		maxSize: config.get<number>('maxSize', 200),
		quality: config.get<number>('quality', 80),
		format: config.get<'webp' | 'jpeg'>('format', 'webp'),
		diskCacheSizeMB: config.get<number>('diskCacheSizeMB', 200),
		skipFormats: config.get<string[]>('skipFormats', ['svg']),
		waitForThumbnail: config.get<boolean>('waitForThumbnail', true),
	};
}
