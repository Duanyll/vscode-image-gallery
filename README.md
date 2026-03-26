# Image Gallery Plus

A feature-rich extension that brings you the best image browsing experience in VS Code, especially for remote / cloud development.

> This is a maintained fork of [geriyoco/vscode-image-gallery](https://github.com/geriyoco/vscode-image-gallery), which has been inactive since 2024.

## Highlights

- **Thumbnail Compression**: Generates compressed thumbnails on the backend using WebAssembly (wasm-vips), dramatically reducing bandwidth in Remote SSH / WSL / Containers sessions. Configurable size, quality, and output format, with a persistent disk cache.
- **Gallery View**: Collapsible grid of all images in the selected folder and its sub-folders.
- **Lazy Loading**: Images load on-demand as you scroll (tested on 10k+ images).
- **Live Refresh**: Automatically updates the view when images are modified, added, or deleted.
- **Glob Filter**: Filter images by glob patterns (e.g. `*.png`, `**/icons/*`) directly from the toolbar.
- **Adjustable Thumbnails**: Resize thumbnail grid with a slider in the toolbar.
- **Theme Integration**: Fully respects your VS Code color theme.

## What's New in This Fork

- **Backend thumbnail compression** with [wasm-vips](https://github.com/kleisauke/wasm-vips) — zero native dependencies, works across all remote environments
- **Glob filter search box** in the toolbar
- **Thumbnail size slider** for adjustable grid density
- **Full theme compatibility** for toolbar, folder bars, icons, and tooltips
- **Modernized dependencies** and build toolchain

## Usage

![demo](docs/demo-v1.0.0.gif)

See [here](docs/photo_credits.md) for the photo credits.

## Thumbnail Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `imageGallery.thumbnail.enabled` | `"remote"` | When to enable: `"always"`, `"remote"` (SSH/WSL/Containers only), or `"never"` |
| `imageGallery.thumbnail.maxSize` | `512` | Maximum width/height of thumbnails in pixels |
| `imageGallery.thumbnail.quality` | `80` | Compression quality (1-100) |
| `imageGallery.thumbnail.format` | `"webp"` | Output format: `"webp"` or `"jpeg"` |
| `imageGallery.thumbnail.diskCacheSizeMB` | `200` | Maximum disk cache size in MB |
| `imageGallery.thumbnail.skipFormats` | `["svg"]` | Formats to skip (served as-is). Add `"gif"` to preserve animations |
| `imageGallery.thumbnail.waitForThumbnail` | `true` | `true`: show placeholder until thumbnail is ready (saves bandwidth). `false`: load original immediately |

Use the command **Image Gallery: Clear Thumbnail Cache** to force regeneration after changing settings.

## Like this work?

- Star this project on [GitHub](https://github.com/Duanyll/vscode-image-gallery) or [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=duanyll.image-gallery)
- Contribute to the project: Start an [issue](https://github.com/Duanyll/vscode-image-gallery/issues/new) or [fork](https://github.com/Duanyll/vscode-image-gallery/fork) the repository.
