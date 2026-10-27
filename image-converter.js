(() => {
  const fileInput = document.getElementById("imageFiles");
  const dropzone = document.getElementById("dropzone");
  const qualityInput = document.getElementById("quality");
  const qualityValue = document.getElementById("qualityValue");
  const processModeInput = document.getElementById("processMode");
  const backgroundInput = document.getElementById("backgroundMode");
  const outputFormatInput = document.getElementById("outputFormat");
  const modeHelp = document.getElementById("modeHelp");
  const fileCount = document.getElementById("fileCount");
  const queueStatus = document.getElementById("queueStatus");
  const fileList = document.getElementById("fileList");
  const convertAllButton = document.getElementById("convertAll");
  const downloadAllButton = document.getElementById("downloadAll");
  const clearButton = document.getElementById("clearFiles");
  const maskEditorDialog = document.getElementById("maskEditorDialog");
  const maskEditorCanvas = document.getElementById("maskEditorCanvas");
  const maskEditorContext = maskEditorCanvas.getContext("2d");
  const maskBrushMode = document.getElementById("maskBrushMode");
  const maskBrushSize = document.getElementById("maskBrushSize");
  const maskBrushSizeValue = document.getElementById("maskBrushSizeValue");
  const zoomInMaskButton = document.getElementById("zoomInMask");
  const zoomOutMaskButton = document.getElementById("zoomOutMask");
  const resetMaskZoomButton = document.getElementById("resetMaskZoom");
  const maskZoomValue = document.getElementById("maskZoomValue");
  const saveMaskEditsButton = document.getElementById("saveMaskEdits");
  const closeMaskEditorButton = document.getElementById("closeMaskEditor");
  const files = [];
  let processing = false;
  let removeBackgroundLoader;
  let editorEntry;
  let editorImage;
  let editorWorkingMask;
  let isPainting = false;
  let lastBrushPoint;
  let maskZoom = 1;
  let maskFitScale = 1;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unit = units[0];
    for (let index = 1; size >= 1024 && index < units.length; index += 1) {
      size /= 1024;
      unit = units[index];
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`;
  }

  function outputName(name, mode, format, background) {
    const baseName = name.replace(/\.[^.]*$/, "");
    const extension = format === "image/jpeg" ? "jpg" : format.split("/")[1];
    if (mode !== "remove-background") return `${baseName}.${extension}`;
    const suffix = background === "transparent" && format !== "image/jpeg" ? "transparent-background" : "white-background";
    return `${baseName}-${suffix}.${extension}`;
  }

  function updateActions() {
    const mode = processModeInput.value;
    const format = outputFormatInput.value;
    const background = backgroundInput.value;
    const ready = files.some((entry) => entry.output
      && entry.outputMode === mode
      && entry.outputFormat === format
      && (mode !== "remove-background" || entry.outputBackground === background));
    fileCount.textContent = `(${files.length})`;
    convertAllButton.disabled = processing || files.length === 0;
    convertAllButton.textContent = mode === "remove-background" ? "Remove backgrounds" : "Convert images";
    downloadAllButton.disabled = processing || !ready;
    clearButton.disabled = processing || files.length === 0;
    fileInput.disabled = processing;
    processModeInput.disabled = processing;
    backgroundInput.disabled = processing || mode !== "remove-background";
    outputFormatInput.disabled = processing;
    qualityInput.disabled = processing || outputFormatInput.value === "image/png";
  }

  function setStatus(message) {
    queueStatus.textContent = message;
  }

  function renderFiles() {
    fileList.replaceChildren();
    files.forEach((entry) => {
      const row = document.createElement("li");
      row.className = "converter-file-row";

      const preview = document.createElement("div");
      preview.className = "converter-preview";
      preview.setAttribute("aria-hidden", "true");
      if (entry.previewUrl) {
        const image = document.createElement("img");
        image.src = entry.previewUrl;
        image.alt = "";
        preview.append(image);
      } else if (entry.output) {
        const image = document.createElement("img");
        image.src = URL.createObjectURL(entry.output);
        image.alt = "";
        entry.previewUrl = image.src;
        preview.append(image);
      } else {
        preview.textContent = "IMAGE";
      }

      const info = document.createElement("div");
      info.className = "converter-file-info";
      const name = document.createElement("p");
      name.className = "converter-file-name";
      name.textContent = entry.file.name;
      name.title = entry.file.name;
      const meta = document.createElement("p");
      meta.className = "converter-file-meta";
      meta.textContent = `${formatBytes(entry.file.size)}${entry.output ? ` → ${formatBytes(entry.output.size)}` : ""}`;
      const status = document.createElement("p");
      status.className = "converter-file-status";
      status.dataset.state = entry.state;
      status.textContent = entry.message;
      info.append(name, meta, status);

      const actions = document.createElement("div");
      actions.className = "converter-row-actions";
      const download = document.createElement("button");
      download.type = "button";
      download.textContent = "Download";
      download.disabled = !entry.output
        || entry.outputMode !== processModeInput.value
        || entry.outputFormat !== outputFormatInput.value
        || (entry.outputMode === "remove-background" && entry.outputBackground !== backgroundInput.value)
        || processing;
      download.addEventListener("click", () => downloadBlob(
        entry.output,
        outputName(entry.file.name, entry.outputMode, entry.outputFormat, entry.outputBackground),
      ));
      if (entry.maskCanvas) {
        const editMask = document.createElement("button");
        editMask.type = "button";
        editMask.textContent = "Edit mask";
        editMask.disabled = processing;
        editMask.addEventListener("click", () => openMaskEditor(entry));
        actions.append(editMask);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${entry.file.name}`);
      remove.disabled = processing;
      remove.addEventListener("click", () => removeFile(entry));
      actions.append(download, remove);
      row.append(preview, info, actions);
      fileList.append(row);
    });
    updateActions();
  }

  function addFiles(fileListToAdd) {
    const selected = [...fileListToAdd].filter((file) => file.type.startsWith("image/"));
    const ignoredCount = fileListToAdd.length - selected.length;
    selected.forEach((file) => {
      files.push({
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        output: null,
        master: null,
        maskCanvas: null,
        outputMode: null,
        outputFormat: null,
        outputBackground: null,
        previewUrl: null,
        state: "waiting",
        message: "Waiting to convert",
      });
    });
    if (selected.length) {
      setStatus(`${files.length} image${files.length === 1 ? "" : "s"} in the queue.`);
    } else if (ignoredCount) {
      setStatus("Choose image files to add them to the queue.");
    }
    if (ignoredCount && selected.length) {
      setStatus(`Added ${selected.length} image${selected.length === 1 ? "" : "s"}; skipped ${ignoredCount} non-image file${ignoredCount === 1 ? "" : "s"}.`);
    }
    renderFiles();
  }

  function removeFile(entry) {
    const index = files.indexOf(entry);
    if (index < 0) return;
    if (editorEntry === entry) closeMaskEditor();
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    files.splice(index, 1);
    setStatus(files.length ? `${files.length} image${files.length === 1 ? "" : "s"} in the queue.` : "Add images to get started.");
    renderFiles();
  }

  function decodeImage(file) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(file);
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This image format could not be opened by the browser."));
      };
      image.src = url;
    });
  }

  async function getBackgroundRemover() {
    if (!removeBackgroundLoader) {
      removeBackgroundLoader = import("https://esm.sh/@imgly/background-removal@1.7.0?bundle")
        .then((module) => module.removeBackground)
        .catch((error) => {
          removeBackgroundLoader = null;
          throw new Error(`Could not load the background-removal AI library: ${error.message}`);
        });
    }
    return removeBackgroundLoader;
  }

  async function encodeImage(canvas, format) {
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, format, Number(qualityInput.value) / 100);
    });
    if (!blob || blob.type !== format) {
      throw new Error(`This browser could not encode the image as ${format.split("/")[1].toUpperCase()}.`);
    }
    return blob;
  }

  async function convertImage(entry, mode, format) {
    let originalImage;
    let maskImage;
    try {
      entry.state = "processing";
      entry.message = mode === "remove-background" ? "Creating a high-accuracy background mask…" : "Preparing image…";
      renderFiles();
      if (mode === "remove-background") {
        const removeBackground = await getBackgroundRemover();
        setStatus("Loading the on-device AI model if needed…");
        const mask = await removeBackground(entry.file, {
          model: "isnet",
          publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/",
          output: { format: "image/png", quality: 1 },
          progress: (key, current, total) => {
            if (total > 0) setStatus(`Loading AI resources: ${Math.round((current / total) * 100)}%`);
          },
        });
        [originalImage, maskImage] = await Promise.all([decodeImage(entry.file), decodeImage(mask)]);
        if (originalImage.width !== maskImage.width || originalImage.height !== maskImage.height) {
          throw new Error("The AI mask dimensions did not match the original image.");
        }
        entry.maskCanvas = document.createElement("canvas");
        entry.maskCanvas.width = maskImage.width;
        entry.maskCanvas.height = maskImage.height;
        const maskContext = entry.maskCanvas.getContext("2d", { willReadFrequently: true });
        if (!maskContext) throw new Error("Canvas mask processing is not supported by this browser.");
        maskContext.drawImage(maskImage, 0, 0);
        const maskPixels = maskContext.getImageData(0, 0, maskImage.width, maskImage.height);
        for (let offset = 0; offset < maskPixels.data.length; offset += 4) {
          const foreground = maskPixels.data[offset + 3] >= 128;
          maskPixels.data[offset] = 255;
          maskPixels.data[offset + 1] = 255;
          maskPixels.data[offset + 2] = 255;
          maskPixels.data[offset + 3] = foreground ? 255 : 0;
        }
        maskContext.putImageData(maskPixels, 0, 0);
      }
      entry.outputMode = mode;
      await buildMaster(entry, originalImage);
      await encodeMaster(entry, format);
      entry.state = "success";
      entry.message = "Ready to download";
    } catch (error) {
      entry.state = "error";
      entry.message = error instanceof Error ? error.message : "Image conversion failed.";
    } finally {
      originalImage?.close?.();
      maskImage?.close?.();
    }
  }

  async function buildMaster(entry, decodedImage) {
    let image = decodedImage;
    if (!image) image = await decodeImage(entry.file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      if (!canvas.width || !canvas.height) {
        throw new Error("The image has invalid dimensions.");
      }
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas conversion is not supported by this browser.");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      if (entry.outputMode === "remove-background") {
        context.globalCompositeOperation = "destination-in";
        context.drawImage(entry.maskCanvas, 0, 0);
      }
      entry.master = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!entry.master || entry.master.type !== "image/png") {
        throw new Error("This browser could not prepare the image for export.");
      }
    } finally {
      if (image !== decodedImage) image?.close?.();
    }
  }

  async function encodeMaster(entry, format) {
    const image = await decodeImage(entry.master);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas conversion is not supported by this browser.");
      context.imageSmoothingEnabled = false;
      const flattenOnWhite = format === "image/jpeg"
        || (entry.outputMode === "remove-background" && backgroundInput.value === "white");
      if (flattenOnWhite) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0);
      if (flattenOnWhite) {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 0; offset < imageData.data.length; offset += 4) {
          imageData.data[offset + 3] = 255;
        }
        context.putImageData(imageData, 0, 0);
      }
      const output = await encodeImage(canvas, format);
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      entry.previewUrl = null;
      entry.output = output;
      entry.outputFormat = format;
      entry.outputBackground = entry.outputMode === "remove-background" ? backgroundInput.value : "original";
      entry.state = "success";
      entry.message = "Ready to download";
    } finally {
      image?.close?.();
    }
  }

  function paintMaskSegment(from, to) {
    const context = editorWorkingMask.getContext("2d");
    const rect = maskEditorCanvas.getBoundingClientRect();
    const scale = maskEditorCanvas.width / rect.width;
    const brushSize = Number(maskBrushSize.value) * scale;
    context.save();
    context.globalCompositeOperation = maskBrushMode.value === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "#ffffff";
    context.lineWidth = brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.beginPath();
    context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const radius = brushSize / 2 + 1;
    const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
    const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
    const right = Math.min(editorWorkingMask.width, Math.ceil(Math.max(from.x, to.x) + radius));
    const bottom = Math.min(editorWorkingMask.height, Math.ceil(Math.max(from.y, to.y) + radius));
    const region = context.getImageData(left, top, right - left, bottom - top);
    for (let offset = 3; offset < region.data.length; offset += 4) {
      region.data[offset] = region.data[offset] >= 128 ? 255 : 0;
    }
    context.putImageData(region, left, top);
  }

  function editorPoint(event) {
    const rect = maskEditorCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(maskEditorCanvas.width, ((event.clientX - rect.left) / rect.width) * maskEditorCanvas.width)),
      y: Math.max(0, Math.min(maskEditorCanvas.height, ((event.clientY - rect.top) / rect.height) * maskEditorCanvas.height)),
    };
  }

  function drawMaskEditor() {
    if (!editorImage || !editorWorkingMask) return;
    maskEditorContext.clearRect(0, 0, maskEditorCanvas.width, maskEditorCanvas.height);
    maskEditorContext.drawImage(editorImage, 0, 0);
    maskEditorContext.globalCompositeOperation = "destination-in";
    maskEditorContext.drawImage(editorWorkingMask, 0, 0);
    maskEditorContext.globalCompositeOperation = "source-over";
  }

  function updateMaskZoom() {
    const canvasWrap = maskEditorCanvas.parentElement;
    const availableWidth = Math.max(1, canvasWrap.clientWidth - 32);
    const availableHeight = Math.max(1, Math.min(window.innerHeight * 0.64, canvasWrap.clientHeight || window.innerHeight * 0.64) - 32);
    maskFitScale = Math.min(1, availableWidth / maskEditorCanvas.width, availableHeight / maskEditorCanvas.height);
    maskZoomValue.value = `${Math.round(maskZoom * 100)}%`;
    maskZoomValue.textContent = maskZoomValue.value;
    maskEditorCanvas.style.width = `${maskEditorCanvas.width * maskFitScale * maskZoom}px`;
    maskEditorCanvas.style.height = `${maskEditorCanvas.height * maskFitScale * maskZoom}px`;
    maskEditorCanvas.style.maxWidth = "none";
    maskEditorCanvas.style.maxHeight = "none";
    zoomOutMaskButton.disabled = maskZoom <= 0.25;
    zoomInMaskButton.disabled = maskZoom >= 4;
  }

  function setMaskZoom(nextZoom) {
    maskZoom = Math.max(0.25, Math.min(4, Math.round(nextZoom * 4) / 4));
    updateMaskZoom();
  }

  async function openMaskEditor(entry) {
    if (processing || !entry.maskCanvas) return;
    try {
      editorEntry = entry;
      editorImage = await decodeImage(entry.file);
      editorWorkingMask = document.createElement("canvas");
      editorWorkingMask.width = entry.maskCanvas.width;
      editorWorkingMask.height = entry.maskCanvas.height;
      editorWorkingMask.getContext("2d").drawImage(entry.maskCanvas, 0, 0);
      maskEditorCanvas.width = editorWorkingMask.width;
      maskEditorCanvas.height = editorWorkingMask.height;
      maskZoom = 1;
      document.getElementById("maskEditorTitle").textContent = `Refine mask · ${entry.file.name}`;
      maskEditorDialog.showModal();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      updateMaskZoom();
      drawMaskEditor();
    } catch (error) {
      editorImage?.close?.();
      editorImage = null;
      editorEntry = null;
      setStatus(`Could not open the mask editor: ${error.message}`);
      console.error("Could not open image mask editor", error);
    }
  }

  function closeMaskEditor() {
    if (maskEditorDialog.open) {
      maskEditorDialog.close();
      return;
    }
    resetMaskEditor();
  }

  function resetMaskEditor() {
    editorImage?.close?.();
    editorImage = null;
    editorEntry = null;
    editorWorkingMask = null;
    isPainting = false;
    lastBrushPoint = null;
    maskZoom = 1;
    maskEditorCanvas.style.width = "";
    maskEditorCanvas.style.height = "";
    maskEditorCanvas.style.maxWidth = "";
    maskEditorCanvas.style.maxHeight = "";
    maskZoomValue.value = "100%";
    maskZoomValue.textContent = "100%";
  }

  async function convertAll() {
    if (processing || !files.length) return;
    const mode = processModeInput.value;
    const format = outputFormatInput.value;
    processing = true;
    updateActions();
    let completed = 0;
    for (const entry of files) {
      if (entry.output && entry.outputMode === mode && entry.outputFormat === format) {
        if (mode === "remove-background" && entry.outputBackground !== backgroundInput.value) {
          try {
            await encodeMaster(entry, format);
          } catch (error) {
            entry.state = "error";
            entry.message = error instanceof Error ? error.message : "Could not apply the background option.";
          }
        } else {
          completed += 1;
          continue;
        }
      } else {
        try {
          if (entry.master && entry.outputMode === mode) {
            await encodeMaster(entry, format);
          } else {
            await convertImage(entry, mode, format);
          }
        } catch (error) {
          entry.state = "error";
          entry.message = error instanceof Error ? error.message : "Image processing failed.";
          console.error(`Could not process ${entry.file.name}`, error);
        }
      }
      completed += 1;
      setStatus(`Processed ${completed} of ${files.length} images.`);
      renderFiles();
    }
    processing = false;
    const failed = files.filter((entry) => entry.state === "error").length;
    const ready = files.filter((entry) => entry.output
      && entry.outputMode === mode
      && entry.outputFormat === format
      && (mode !== "remove-background" || entry.outputBackground === backgroundInput.value)).length;
    const action = mode === "remove-background" ? "background removed" : "converted";
    setStatus(failed
      ? `Finished: ${ready} processed, ${failed} could not be processed.`
      : `Finished: ${ready} image${ready === 1 ? "" : "s"} ready to download; ${action}.`);
    renderFiles();
  }

  function downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  async function createZip(entries) {
    if (entries.length > 0xffff) throw new Error("A ZIP archive cannot contain more than 65,535 files.");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;
    const maxZip32 = 0xffffffff;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      if (name.length > 0xffff) throw new Error("A ZIP filename is too long to include in the archive.");
      const nextLocalOffset = localOffset + 30 + name.length + entry.blob.size;
      if (!Number.isSafeInteger(nextLocalOffset) || nextLocalOffset > maxZip32) {
        throw new Error("This batch is too large for a standard ZIP archive.");
      }
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30 + name.length);
      const localView = new DataView(localHeader.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write16(localView, 8, 0);
      write16(localView, 10, dosTime);
      write16(localView, 12, dosDate);
      write32(localView, 14, checksum);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      write16(localView, 28, 0);
      localHeader.set(name, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + name.length);
      const centralView = new DataView(centralHeader.buffer);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x0800);
      write16(centralView, 10, 0);
      write16(centralView, 12, dosTime);
      write16(centralView, 14, dosDate);
      write32(centralView, 16, checksum);
      write32(centralView, 20, data.length);
      write32(centralView, 24, data.length);
      write16(centralView, 28, name.length);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, localOffset);
      centralHeader.set(name, 46);
      centralParts.push(centralHeader);
      localOffset = nextLocalOffset;
      centralSize += centralHeader.length;
    }

    if (centralSize > maxZip32 || localOffset + centralSize + 22 > maxZip32) {
      throw new Error("This batch is too large for a standard ZIP archive.");
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, entries.length);
    write16(endView, 10, entries.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, localOffset);
    write16(endView, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function uniqueZipEntries(readyFiles) {
    const usedNames = new Set();
    return readyFiles.map((entry) => {
      const originalName = outputName(entry.file.name, entry.outputMode, entry.outputFormat, entry.outputBackground);
      let name = originalName;
      let suffix = 2;
      while (usedNames.has(name.toLocaleLowerCase())) {
        const extensionIndex = originalName.lastIndexOf(".");
        name = `${originalName.slice(0, extensionIndex)} (${suffix})${originalName.slice(extensionIndex)}`;
        suffix += 1;
      }
      usedNames.add(name.toLocaleLowerCase());
      return { name, blob: entry.output };
    });
  }

  async function downloadAll() {
    const readyFiles = files.filter((entry) => entry.output
      && entry.outputMode === processModeInput.value
      && entry.outputFormat === outputFormatInput.value
      && (entry.outputMode !== "remove-background" || entry.outputBackground === backgroundInput.value));
    if (!readyFiles.length || processing) return;
    downloadAllButton.disabled = true;
    setStatus("Preparing the ZIP archive…");
    try {
      const archive = await createZip(uniqueZipEntries(readyFiles));
      const archiveName = processModeInput.value === "remove-background"
        ? `${backgroundInput.value}-background-images-${outputFormatInput.value.split("/")[1]}.zip`
        : `converted-images-${outputFormatInput.value.split("/")[1]}.zip`;
      downloadBlob(archive, archiveName);
      setStatus(`Downloaded ${readyFiles.length} processed image${readyFiles.length === 1 ? "" : "s"} in a ZIP archive.`);
    } catch (error) {
      setStatus(`Could not create the ZIP archive: ${error.message}`);
      console.error("Could not create the converted image archive", error);
    } finally {
      updateActions();
    }
  }

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  qualityInput.addEventListener("input", () => {
    qualityValue.value = `${qualityInput.value}%`;
    qualityValue.textContent = qualityValue.value;
  });

  outputFormatInput.addEventListener("change", async () => {
    if (outputFormatInput.value === "image/jpeg" && backgroundInput.value === "transparent") {
      backgroundInput.value = "white";
      setStatus("JPEG does not support transparency; the background was changed to white.");
    }
    qualityInput.disabled = outputFormatInput.value === "image/png";
    const entriesToReencode = files.filter((entry) => entry.master && entry.outputMode === processModeInput.value);
    if (!entriesToReencode.length) {
      setStatus(files.length ? "Output format changed. Process the queue to create outputs." : "Add images to get started.");
      renderFiles();
      return;
    }
    processing = true;
    updateActions();
    let failed = 0;
    try {
      for (const entry of entriesToReencode) {
        try {
          await encodeMaster(entry, outputFormatInput.value);
        } catch (error) {
          failed += 1;
          entry.state = "error";
          entry.message = error instanceof Error ? error.message : "Could not change the image format.";
          console.error(`Could not change format for ${entry.file.name}`, error);
        }
        renderFiles();
      }
      setStatus(failed
        ? `Updated the format; ${failed} image${failed === 1 ? "" : "s"} could not be re-encoded.`
        : `Updated ${entriesToReencode.length} image${entriesToReencode.length === 1 ? "" : "s"} to ${outputFormatInput.value.split("/")[1].toUpperCase()}.`);
    } finally {
      processing = false;
      renderFiles();
    }
  });

  backgroundInput.addEventListener("change", async () => {
    const entriesToReencode = files.filter((entry) => entry.master && entry.outputMode === "remove-background");
    if (!entriesToReencode.length) {
      setStatus(files.length ? "Background changed. Process the queue to create outputs." : "Add images to get started.");
      renderFiles();
      return;
    }
    processing = true;
    updateActions();
    let failed = 0;
    for (const entry of entriesToReencode) {
      try {
        await encodeMaster(entry, outputFormatInput.value);
      } catch (error) {
        failed += 1;
        entry.state = "error";
        entry.message = error instanceof Error ? error.message : "Could not apply the background option.";
        console.error(`Could not change background for ${entry.file.name}`, error);
      }
      renderFiles();
    }
    processing = false;
    setStatus(failed
      ? `Background changed; ${failed} image${failed === 1 ? "" : "s"} could not be updated.`
      : `Updated ${entriesToReencode.length} image${entriesToReencode.length === 1 ? "" : "s"} to a ${backgroundInput.value} background.`);
    renderFiles();
  });

  processModeInput.addEventListener("change", () => {
    files.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      entry.previewUrl = null;
      entry.output = null;
      entry.master = null;
      entry.maskCanvas = null;
      entry.outputMode = null;
      entry.outputFormat = null;
      entry.outputBackground = null;
      entry.state = "waiting";
      entry.message = "Waiting to process";
    });
    modeHelp.textContent = processModeInput.value === "remove-background"
      ? "AI estimates the mask; use Edit mask to erase missed areas like eyeglass lenses. Original pixels remain unchanged."
      : "The image is not resized or smoothed. Animated images use the first frame. JPEG transparency is composited on white.";
    setStatus(files.length ? "Image action changed. Process the queue to create new outputs." : "Add images to get started.");
    renderFiles();
  });

  maskBrushSize.addEventListener("input", () => {
    maskBrushSizeValue.value = `${maskBrushSize.value} px`;
    maskBrushSizeValue.textContent = maskBrushSizeValue.value;
  });

  zoomInMaskButton.addEventListener("click", () => setMaskZoom(maskZoom + 0.25));
  zoomOutMaskButton.addEventListener("click", () => setMaskZoom(maskZoom - 0.25));
  resetMaskZoomButton.addEventListener("click", () => setMaskZoom(1));

  window.addEventListener("resize", () => {
    if (editorWorkingMask) updateMaskZoom();
  });

  maskEditorCanvas.addEventListener("wheel", (event) => {
    if (!maskEditorDialog.open || !editorWorkingMask) return;
    event.preventDefault();
    setMaskZoom(maskZoom + (event.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });

  maskEditorCanvas.addEventListener("pointerdown", (event) => {
    if (!editorEntry || !editorWorkingMask) return;
    event.preventDefault();
    maskEditorCanvas.setPointerCapture(event.pointerId);
    isPainting = true;
    lastBrushPoint = editorPoint(event);
    paintMaskSegment(lastBrushPoint, lastBrushPoint);
    drawMaskEditor();
  });

  maskEditorCanvas.addEventListener("pointermove", (event) => {
    if (!isPainting || !lastBrushPoint) return;
    const point = editorPoint(event);
    paintMaskSegment(lastBrushPoint, point);
    lastBrushPoint = point;
    drawMaskEditor();
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    maskEditorCanvas.addEventListener(eventName, () => {
      isPainting = false;
      lastBrushPoint = null;
    });
  });

  saveMaskEditsButton.addEventListener("click", async () => {
    if (!editorEntry || !editorWorkingMask || processing) return;
    const entry = editorEntry;
    entry.maskCanvas = editorWorkingMask;
    processing = true;
    saveMaskEditsButton.disabled = true;
    try {
      await buildMaster(entry);
      await encodeMaster(entry, outputFormatInput.value);
      entry.state = "success";
      entry.message = "Mask edits applied";
      closeMaskEditor();
      setStatus(`Applied mask edits to ${entry.file.name}.`);
      renderFiles();
    } catch (error) {
      entry.state = "error";
      entry.message = error instanceof Error ? error.message : "Could not apply mask edits.";
      setStatus(`Could not apply mask edits: ${entry.message}`);
      console.error(`Could not save mask edits for ${entry.file.name}`, error);
    } finally {
      processing = false;
      saveMaskEditsButton.disabled = false;
      renderFiles();
    }
  });

  closeMaskEditorButton.addEventListener("click", closeMaskEditor);
  maskEditorDialog.addEventListener("close", resetMaskEditor);

  convertAllButton.addEventListener("click", convertAll);
  downloadAllButton.addEventListener("click", downloadAll);
  clearButton.addEventListener("click", () => {
    closeMaskEditor();
    files.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
    files.length = 0;
    setStatus("Add images to get started.");
    renderFiles();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });
  dropzone.addEventListener("drop", (event) => {
    if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
  });

  window.addEventListener("pagehide", () => {
    files.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, { once: true });

  renderFiles();
})();
