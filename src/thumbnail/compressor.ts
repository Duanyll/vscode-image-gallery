import type Vips from 'wasm-vips';

let vipsInstance: typeof Vips | null = null;
let vipsInitPromise: Promise<typeof Vips> | null = null;

async function getVips(): Promise<typeof Vips> {
	if (vipsInstance) {
		return vipsInstance;
	}
	if (!vipsInitPromise) {
		vipsInitPromise = (async () => {
			const vipsModule = await import('wasm-vips');
			const vips = await (vipsModule.default as any)();
			vipsInstance = vips;
			return vips;
		})();
	}
	return vipsInitPromise;
}

export interface ThumbnailOptions {
	maxSize: number;
	quality: number;
	format: 'webp' | 'jpeg';
}

export interface ThumbnailResult {
	data: Uint8Array;
	originalWidth: number;
	originalHeight: number;
}

export async function generateThumbnail(
	inputBuffer: Buffer | Uint8Array,
	options: ThumbnailOptions,
): Promise<ThumbnailResult> {
	const vips = await getVips();

	// Load original to get dimensions before thumbnailing
	const original = vips.Image.newFromBuffer(inputBuffer);
	const originalWidth = original.width;
	const originalHeight = original.height;
	original.delete();

	const image = vips.Image.thumbnailBuffer(inputBuffer, options.maxSize, {
		height: options.maxSize,
	});
	try {
		const formatStr = options.format === 'webp' ? '.webp' : '.jpg';
		const saveOptions = options.format === 'webp'
			? { Q: options.quality }
			: { Q: options.quality, optimize_coding: true };
		return {
			data: image.writeToBuffer(formatStr, saveOptions),
			originalWidth,
			originalHeight,
		};
	} finally {
		image.delete();
	}
}

export function disposeVips(): void {
	if (vipsInstance) {
		(vipsInstance as any).shutdown?.();
		vipsInstance = null;
		vipsInitPromise = null;
	}
}
