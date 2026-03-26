const vscode = acquireVsCodeApi();
let gFolders = {}; // a global holder for all content DOMs to preserve attributes
/** {folderId: {
		status: "",
		bar: domBarButton,
		grid: domGridDiv,
		images: {
			imageId: {
				status: "" | "refresh",
				container: domContainerDiv,
			}, ...
		},
	}, ...}
 **/

function init() {
	initMessageListeners();
	DOMManager.requestContentDOMs();
	EventListener.addAllToToolbar();
}

function initMessageListeners() {
	window.addEventListener("message", event => {
		const message = event.data;
		const command = message.command;
		delete message.command;
		switch (command) {
			case "POST.gallery.responseContentDOMs":
				DOMManager.updateGlobalDoms(message);
				DOMManager.updateGalleryContent();
				break;
			case "POST.gallery.refreshComplete":
				const btn = document.querySelector(".toolbar .refresh-all");
				btn.classList.remove("refreshing");
				btn.disabled = false;
				break;
			case "POST.gallery.thumbnailReady":
				ThumbnailManager.onThumbnailReady(message.imageId, message.thumbnailSrc, message.dimensions);
				break;
		}
	});
}

const imageObserver = new IntersectionObserver(
	(entries, _observer) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const image = entry.target;
				const galleryContent = document.querySelector(".gallery-content");
				const waitForThumbnail = galleryContent && galleryContent.dataset.waitForThumbnail === "true";
				const thumbnailEnabled = galleryContent && galleryContent.dataset.thumbnailEnabled === "true";

				// If thumbnail is pending and waitForThumbnail is on, skip loading for now
				if (thumbnailEnabled && waitForThumbnail && image.classList.contains("thumbnail-pending")) {
					return;
				}

				imageObserver.unobserve(image);

				// If thumbnail not ready but waitForThumbnail is off, load original
				if (thumbnailEnabled && !waitForThumbnail && image.classList.contains("thumbnail-pending")) {
					image.src = image.dataset.originalSrc;
				} else {
					image.src = image.dataset.src;
				}
				image.onload = () => image.classList.replace("unloaded", "loaded");
			}
		});
	}
);

class ThumbnailManager {
	static onThumbnailReady(imageId, thumbnailSrc, dimensions) {
		const img = document.getElementById(imageId);
		if (!img) { return; }

		img.dataset.src = thumbnailSrc;
		img.classList.remove("thumbnail-pending");

		// Store original dimensions in data-meta so tooltip can use them
		if (dimensions) {
			try {
				const meta = JSON.parse(img.dataset.meta);
				meta.width = dimensions.width;
				meta.height = dimensions.height;
				img.dataset.meta = JSON.stringify(meta);
			} catch { /* ignore */ }
		}

		// If image is still unloaded (hasn't been displayed yet), trigger load
		if (img.classList.contains("unloaded")) {
			// If already loaded the original (waitForThumbnail=false), don't swap
			if (img.src && img.src !== img.dataset.src && img.classList.contains("loaded")) {
				return;
			}
			// Re-observe to trigger if currently in viewport
			imageObserver.unobserve(img);
			imageObserver.observe(img);
		}
		// If already loaded (has "loaded" class), don't swap — original is already displayed
	}
}

class FilterManager {
	static debounceTimer = null;
	static currentPattern = "";

	static globToRegex(glob) {
		if (!glob) return null;
		let regex = "";
		let i = 0;
		while (i < glob.length) {
			const c = glob[i];
			if (c === "*") {
				if (glob[i + 1] === "*") {
					// ** matches across path segments
					regex += ".*";
					i += 2;
					// skip trailing /
					if (glob[i] === "/") i++;
				} else {
					// * matches within a single segment
					regex += "[^/]*";
					i++;
				}
			} else if (c === "?") {
				regex += "[^/]";
				i++;
			} else if (".+^${}()|[]\\".includes(c)) {
				regex += "\\" + c;
				i++;
			} else {
				regex += c;
				i++;
			}
		}
		return new RegExp(regex, "i");
	}

	static apply() {
		const input = document.getElementById("filter-input");
		FilterManager.currentPattern = input ? input.value.trim() : "";
		const regex = FilterManager.globToRegex(FilterManager.currentPattern);

		for (const [folderId, folder] of Object.entries(gFolders)) {
			let visibleCount = 0;
			for (const [imageId, image] of Object.entries(folder.images)) {
				const imgEl = image.container.querySelector("img[data-path]");
				if (!imgEl) continue;
				const path = imgEl.dataset.path;
				const filename = path.split("/").pop();
				// match against full path or just filename
				const matches = !regex || regex.test(path) || regex.test(filename);
				if (matches) {
					image.container.classList.remove("filter-hidden");
					visibleCount++;
				} else {
					image.container.classList.add("filter-hidden");
				}
			}

			// hide folder if all images are filtered out
			const totalImages = Object.keys(folder.images).length;
			if (regex && visibleCount === 0) {
				folder.bar.classList.add("filter-hidden");
				folder.grid.classList.add("filter-hidden");
			} else {
				folder.bar.classList.remove("filter-hidden");
				folder.grid.classList.remove("filter-hidden");
			}

			// update count to show filtered/total
			const countEl = folder.bar.querySelector(`#${folderId}-items-count`);
			if (countEl) {
				if (regex && visibleCount < totalImages) {
					countEl.textContent = `${visibleCount}/${totalImages} images`;
				} else {
					const countText = `${totalImages} image${totalImages === 1 ? "" : "s"} found`;
					countEl.textContent = countText;
				}
			}
		}

		// update global folder count
		const visibleFolders = Object.values(gFolders).filter(f => !f.bar.classList.contains("filter-hidden")).length;
		const totalFolders = Object.keys(gFolders).length;
		const folderCountEl = document.querySelector(".toolbar .folder-count");
		if (folderCountEl) {
			if (regex && visibleFolders < totalFolders) {
				folderCountEl.textContent = `${visibleFolders}/${totalFolders} folders`;
			} else {
				folderCountEl.textContent = `${totalFolders} folder${totalFolders === 1 ? "" : "s"} found`;
			}
		}
	}

	static onInput() {
		clearTimeout(FilterManager.debounceTimer);
		FilterManager.debounceTimer = setTimeout(() => FilterManager.apply(), 300);
	}
}

class DOMManager {
	static htmlToDOM(html) {
		const template = document.createElement("template");
		template.innerHTML = html.trim();
		return template.content.firstChild;
	}

	static requestContentDOMs() {
		vscode.postMessage({
			command: "POST.gallery.requestContentDOMs",
		});
	}

	static updateGlobalDoms(response) {
		const content = JSON.parse(response.content);

		// remove deleted images and folders
		for (const folderId of Object.keys(gFolders)) {
			for (const imageId of Object.keys(gFolders[folderId].images)) {
				if (content.hasOwnProperty(folderId) && !content[folderId].images.hasOwnProperty(imageId)) {
					gFolders[folderId].images[imageId].container.remove();
					delete gFolders[folderId].images[imageId];
				}
			}

			if (!content.hasOwnProperty(folderId)) {
				gFolders[folderId].bar.remove();
				gFolders[folderId].grid.remove();
				delete gFolders[folderId];
			}
		}

		// synchronize the images and folders
		// convert all new html to DOMs
		for (const [folderId, folder] of Object.entries(content)) {
			if (gFolders.hasOwnProperty(folderId)) { // old folder
				content[folderId].bar = gFolders[folderId].bar;
				content[folderId].grid = gFolders[folderId].grid;
			}
			else { // new folder
				content[folderId].bar = DOMManager.htmlToDOM(folder.barHtml);
				content[folderId].grid = DOMManager.htmlToDOM(folder.gridHtml);
				delete content[folderId].barHtml;
				delete content[folderId].gridHtml;
				EventListener.addToFolderBar(content[folderId].bar);
			}

			for (const [imageId, image] of Object.entries(folder.images)) {
				const hasFolder = gFolders.hasOwnProperty(folderId);
				const hasImage = hasFolder && gFolders[folderId].images.hasOwnProperty(imageId);

				if (hasFolder && hasImage && image.status !== "refresh") { // old image
					content[folderId].images[imageId].container = gFolders[folderId].images[imageId].container;
				} 
				else if (hasFolder && hasImage && image.status === "refresh") { // image demands refresh
					gFolders[folderId].images[imageId].container.remove();
					content[folderId].images[imageId].container = DOMManager.htmlToDOM(image.containerHtml);
					delete content[folderId].images[imageId].containerHtml;
					EventListener.addToImageContainer(content[folderId].images[imageId].container);

					const imageDom = content[folderId].images[imageId].container.querySelector("#" + imageId);
					imageDom.src += "?t=" + Date.now();
					imageDom.dataset.src += "?t=" + Date.now();
				}
				else { // new image
					content[folderId].images[imageId].container = DOMManager.htmlToDOM(image.containerHtml);
					delete content[folderId].images[imageId].containerHtml;
					EventListener.addToImageContainer(content[folderId].images[imageId].container);
				}
				content[folderId].images[imageId].status = "";

			}

			// update counts
			const countText = (object, count) => `${count} ${object}${count === 1 ? "" : "s"} found`;
			const nImages = Object.keys(content[folderId].images).length;
			content[folderId].bar.querySelector(`#${folderId}-items-count`).textContent = countText("image", nImages);
			const nFolders = Object.keys(content).length;
			document.querySelector('.toolbar .folder-count').textContent = countText("folder", nFolders);
		}

		gFolders = content;
	}

	static updateGalleryContent() {
		const content = document.querySelector(".gallery-content");
		content.replaceChildren(
			...Object.values(gFolders).flatMap(folder => {
				folder.grid.replaceChildren(
					...Object.values(folder.images).map(image => image.container)
				);
				return [folder.bar, folder.grid];
			})
		);
		if (content.childElementCount === 0) {
			content.innerHTML = "<p>No image found in this folder.</p>";
		}
		FilterManager.apply();
	}
}

class EventListener {
	static addAllToToolbar() {
		document.querySelector(".toolbar .collapse-all").addEventListener(
			"click", () => EventListener.collapseAllFolderBars()
		);
		document.querySelector(".toolbar .expand-all").addEventListener(
			"click", () => EventListener.expandAllFolderBars()
		);
		document.querySelector(".toolbar .refresh-all").addEventListener(
			"click", () => {
				const btn = document.querySelector(".toolbar .refresh-all");
				btn.classList.add("refreshing");
				btn.disabled = true;
				vscode.postMessage({ command: "POST.gallery.requestRefresh" });
			}
		);
		document.querySelector(".toolbar .dropdown").addEventListener(
			"change", () => EventListener.sortRequest()
		);
		document.querySelector(".toolbar .sort-order-arrow").addEventListener(
			"click", () => {
				EventListener.toggleSortOrder();
				EventListener.sortRequest();
			}
		);
		document.querySelector("#thumbnail-size-slider").addEventListener(
			"input", (event) => {
				document.documentElement.style.setProperty('--thumbnail-size', event.target.value + 'px');
			}
		);
		document.getElementById("filter-input").addEventListener(
			"input", () => FilterManager.onInput()
		);
	}

	static addToFolderBar(folderBar) {
		folderBar.addEventListener("click", () => {
			EventListener.toggleFolderBar(folderBar);
		});
	}

	static addToImageContainer(imageContainer) {
		for (const child of imageContainer.childNodes) {
			if (child.nodeName !== "IMG") { continue; }
			const image = child;

			imageContainer.addEventListener("click", () => {
				EventListener.openImageViewer(image.dataset.path, true);
			});
			imageContainer.addEventListener("dblclick", () => {
				EventListener.openImageViewer(image.dataset.path, false);
			});
			let tooltipTimer = null;
			imageContainer.addEventListener("mouseover", () => {
				const tooltip = image.previousElementSibling;
				EventListener.showImageMetadata(tooltip, image.dataset.meta);
			});
			imageContainer.addEventListener("mousemove", (event) => {
				const tooltip = image.previousElementSibling;
				tooltip.style.display = "none";
				clearTimeout(tooltipTimer);
				const x = event.clientX;
				const y = event.clientY;
				tooltipTimer = setTimeout(() => {
					tooltip.style.left = (x + 12) + "px";
					tooltip.style.top = (y + 12) + "px";
					tooltip.style.display = "block";
				}, 500);
			});
			imageContainer.addEventListener("mouseout", () => {
				const tooltip = image.previousElementSibling;
				clearTimeout(tooltipTimer);
				tooltipTimer = null;
				tooltip.style.display = "none";
				tooltip.textContent = "";
			});

			if (image.classList.contains("unloaded")) {
				imageObserver.observe(image);
			}
		}
	}

	static openImageViewer(path, preview) {
		vscode.postMessage({
			command: "POST.gallery.openImageViewer",
			path: path,
			preview: preview,
		});
	}

	static showImageMetadata(tooltipDOM, metadata) {
		const image = tooltipDOM.nextElementSibling;

		const data = JSON.parse(metadata);

		const pow = Math.floor(Math.log(data.size) / Math.log(1024));
		const unit = ["bytes", "kB", "MB", "GB", "TB", "PB"][pow];
		const sizeStr = (data.size / Math.pow(1024, pow)).toFixed(2) + " " + unit;

		const dateOptions = {
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		};
		const ctimeStr = new Date(data.ctime).toLocaleString("en-US", dateOptions);
		const mtimeStr = new Date(data.mtime).toLocaleString("en-US", dateOptions);

		const dimWidth = data.width || image.naturalWidth;
		const dimHeight = data.height || image.naturalHeight;

		tooltipDOM.textContent = [
			`Dimensions: ${dimWidth} x ${dimHeight}`,
			`Type: ${data.ext}`,
			`Size: ${sizeStr}`,
			`Modified: ${mtimeStr}`,
			`Created: ${ctimeStr}`,
		].join("\n");
	}

	static getFolderAssociatedElements(folderDOM) {
		return {
			arrow: document.getElementById(`${folderDOM.id}-arrow`),
			arrowImg: document.getElementById(`${folderDOM.id}-arrow-img`),
			grid: document.getElementById(`${folderDOM.id}-grid`),
		};
	}

	static toggleFolderBar(folderDOM) {
		switch (folderDOM.dataset.state) {
			case "collapsed":
				EventListener.expandFolderBar(folderDOM);
				break;
			case "expanded":
				EventListener.collapseFolderBar(folderDOM);
				break;
		}
	}

	static expandFolderBar(folderDOM) {
		const elements = EventListener.getFolderAssociatedElements(folderDOM);
		if (elements.arrowImg.src.includes("chevron-right.svg")) {
			elements.arrowImg.src = elements.arrowImg.dataset.chevronDown;
		}
		elements.grid.style.display = "grid";
		folderDOM.dataset.state = "expanded";
	}

	static collapseFolderBar(folderDOM) {
		const elements = EventListener.getFolderAssociatedElements(folderDOM);
		if (elements.arrowImg.src.includes("chevron-down.svg")) {
			elements.arrowImg.src = elements.arrowImg.dataset.chevronRight;
		}
		elements.grid.style.display = "none";
		folderDOM.dataset.state = "collapsed";
	}

	static expandAllFolderBars() {
		const folders = document.querySelectorAll(".folder");
		folders.forEach(folder => EventListener.expandFolderBar(folder));
	}

	static collapseAllFolderBars() {
		const folders = document.querySelectorAll(".folder");
		folders.forEach(folder => EventListener.collapseFolderBar(folder));
	}

	static toggleSortOrder() {
		const sortArrowImg = document.querySelector(".toolbar .sort-order-arrow-img");
		if (sortArrowImg.src.includes("arrow-up.svg")) {
			sortArrowImg.src = sortArrowImg.dataset.arrowDown;
			return;
		}
		if (sortArrowImg.src.includes("arrow-down.svg")) {
			sortArrowImg.src = sortArrowImg.dataset.arrowUp;
			return;
		}
	}

	static sortRequest() {
		const dropdownDOM = document.querySelector(".toolbar .dropdown");
		const sortOrderDOM = document.querySelector(".toolbar .sort-order-arrow-img");
		vscode.postMessage({
			command: "POST.gallery.requestSort",
			valueName: dropdownDOM.value,
			ascending: sortOrderDOM.src.includes("arrow-up.svg") ? true : false,
		});
	}
}

(function () {
	init();
}());
