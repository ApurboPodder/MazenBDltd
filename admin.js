(() => {
  const form = document.getElementById("projectForm");
  const folderButton = document.getElementById("chooseFolder");
  const folderStatus = document.getElementById("folderStatus");
  const publishButton = document.getElementById("publishButton");
  const status = document.getElementById("publishStatus");
  const imageInput = document.getElementById("imageFiles");
  const modelInput = document.getElementById("modelFiles");
  const cloudSection = document.getElementById("cloudUploadSection");
  const cloudStatus = document.getElementById("cloudUploadStatus");
  const uploadPassword = document.getElementById("uploadPassword");
  const localFolderSection = document.getElementById("localFolderSection");
  let siteDirectory;
  let remoteAvailable = false;
  let blobUploadModule;
  let saving = false;

  function showStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function createSlug(title) {
    const slug = title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) throw new Error("Enter a project name that contains at least one letter or number.");
    return slug;
  }

  function naturalCompare(first, second) {
    return first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
  }

  function webpFileName(name) {
    return `${name.replace(/\.[^.]*$/, "")}.webp`;
  }

  function encodeAssetPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function safeFileName(name) {
    const safeName = name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return safeName || "file";
  }

  async function getResponseError(response) {
    try {
      const result = await response.json();
      if (typeof result.error === "string") return result.error;
    } catch (error) {
      console.warn("Could not read the upload service error response", error);
    }
    return `Request failed (${response.status}).`;
  }

  async function checkRemoteUploadService() {
    if (window.location.protocol === "file:") return;
    try {
      const response = await fetch("api/projects", { cache: "no-store" });
      if (response.status === 404) return;
      remoteAvailable = true;
      cloudSection.hidden = false;
      localFolderSection.hidden = true;
      publishButton.textContent = "Upload project to Vercel";
      if (!response.ok) {
        cloudStatus.textContent = `Vercel upload service is unavailable: ${await getResponseError(response)}`;
        cloudStatus.dataset.state = "error";
        return;
      }
      const projects = await response.json();
      if (!Array.isArray(projects)) throw new Error("The Vercel project list has an invalid format.");
      cloudStatus.textContent = "Vercel storage is ready. Enter the upload password to publish a project.";
    } catch (error) {
      cloudStatus.textContent = `Could not connect to Vercel storage: ${error.message}`;
      cloudStatus.dataset.state = "error";
      console.error("Could not check the Vercel project upload service", error);
    } finally {
      updatePublishButton();
    }
  }

  function updatePublishButton() {
    publishButton.disabled = saving ||
      (remoteAvailable && !siteDirectory && !uploadPassword.value.trim());
  }

  function hasDuplicateNames(names) {
    const normalizedNames = names.map((name) => name.toLocaleLowerCase());
    return new Set(normalizedNames).size !== normalizedNames.length;
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in window) return createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`The browser cannot open "${file.name}".`));
      };
      image.src = url;
    });
  }

  async function convertToWebp(file) {
    if (file.type && !file.type.startsWith("image/")) {
      throw new Error(`"${file.name}" is not an image file.`);
    }
    let image;
    try {
      image = await decodeImage(file);
      if (!image.width || !image.height) {
        throw new Error(`"${file.name}" has invalid image dimensions.`);
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas image conversion is unavailable in this browser.");
      context.drawImage(image, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
      if (!blob || blob.type !== "image/webp") {
        throw new Error(`The browser could not convert "${file.name}" to WebP.`);
      }
      if (blob.size > 10 * 1024 * 1024) {
        throw new Error(`Converted image "${webpFileName(file.name)}" exceeds the 10 MB limit.`);
      }
      return { name: webpFileName(file.name), blob };
    } finally {
      image?.close?.();
    }
  }

  function getSelectedFiles(input) {
    return [...input.files];
  }

  async function chooseSiteFolder() {
    if (!("showDirectoryPicker" in window)) {
      folderStatus.textContent = "This browser cannot edit local folders. Use Chrome or Edge on HTTPS or localhost.";
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      const assetsDirectory = await directory.getDirectoryHandle("assets");
      await assetsDirectory.getDirectoryHandle("gallery-covers");
      const dataHandle = await directory.getFileHandle("project-data.json");
      const data = JSON.parse(await (await dataHandle.getFile()).text());
      if (!Array.isArray(data)) {
        throw new Error("project-data.json must contain a JSON array.");
      }
      siteDirectory = directory;
      folderStatus.textContent = `Selected site folder: ${directory.name}`;
      updatePublishButton();
      showStatus("");
    } catch (error) {
      if (error.name === "AbortError") return;
      siteDirectory = null;
      updatePublishButton();
      folderStatus.textContent = "Could not use that folder. Choose the site root containing assets and project-data.json.";
      showStatus(error instanceof SyntaxError
        ? "The selected folder has an invalid project-data.json file."
        : `Could not open the website folder: ${error.message}`, "error");
    }
  }

  async function readProjects(directory) {
    const dataHandle = await directory.getFileHandle("project-data.json");
    const projects = JSON.parse(await (await dataHandle.getFile()).text());
    if (!Array.isArray(projects)) throw new Error("project-data.json must contain a JSON array.");
    return projects;
  }

  async function directoryExists(parent, name) {
    try {
      await parent.getDirectoryHandle(name);
      return true;
    } catch (error) {
      if (error.name === "NotFoundError") return false;
      throw error;
    }
  }

  async function writeFile(directory, name, contents) {
    const fileHandle = await directory.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
  }

  async function uploadToVercel(title, categories, convertedImages, modelFiles, projects) {
    const password = uploadPassword.value;
    if (!password) throw new Error("Enter the Vercel upload password.");
    if (!blobUploadModule) {
      blobUploadModule = import("https://esm.sh/@vercel/blob@2.8.2/client?bundle");
    }
    const { upload } = await blobUploadModule;
    const idBase = createSlug(title);
    const projectIds = new Set(projects.map((project) => project && project.id));
    let id = idBase;
    let suffix = 2;
    while (projectIds.has(id)) {
      id = `${idBase}-${suffix}`;
      suffix += 1;
    }

    const uploaded = [];
    const files = [
      ...convertedImages.map((file, index) => ({
        pathname: `projects/${id}/images/${String(index + 1).padStart(2, "0")}-${safeFileName(file.name)}`,
        file,
        contentType: "image/webp",
      })),
      ...modelFiles.map((file, index) => ({
        pathname: `projects/${id}/models/${String(index + 1).padStart(2, "0")}-${safeFileName(file.name)}`,
        file,
        contentType: "model/gltf-binary",
      })),
    ];

    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      showStatus(`Uploading project file ${index + 1} of ${files.length}…`);
      const blob = await upload(item.pathname, item.file.blob || item.file, {
        access: "public",
        contentType: item.contentType,
        handleUploadUrl: "/api/upload",
        headers: { Authorization: `Bearer ${password}` },
      });
      uploaded.push(blob.url);
    }

    const imageUrls = uploaded.slice(0, convertedImages.length);
    const project = {
      id,
      title,
      categories,
      description: "A new eyewear design concept, shown from multiple product views.",
      cover: imageUrls[0],
      photos: imageUrls,
    };
    if (modelFiles.length) project.model = uploaded[convertedImages.length];
    if (modelFiles.length > 1) project.faceModel = uploaded[convertedImages.length + 1];

    showStatus("Publishing project details…");
    const response = await fetch("api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${password}`,
      },
      body: JSON.stringify(project),
    });
    if (!response.ok) throw new Error(await getResponseError(response));
    return project;
  }

  async function saveProject(event) {
    event.preventDefault();
    if (saving) return;
    if (!siteDirectory && !remoteAvailable) {
      showStatus("Choose the local repository or website folder containing project-data.json and assets before saving.", "error");
      return;
    }
    showStatus("");

    const title = document.getElementById("projectTitle").value.trim();
    const categories = [...document.querySelectorAll("input[name=projectCategory]:checked")].map((input) => input.value);
    const imageFiles = getSelectedFiles(imageInput)
      .sort((first, second) => naturalCompare(first.name, second.name));
    const modelFiles = getSelectedFiles(modelInput)
      .sort((first, second) => {
        const firstName = first.name.toLocaleLowerCase();
        const secondName = second.name.toLocaleLowerCase();
        return firstName < secondName ? -1 : firstName > secondName ? 1 : 0;
      });

    if (!title || !imageFiles.length || !categories.length) {
      showStatus("Enter a project name, choose at least one image, and select one or more categories.", "error");
      return;
    }
    if (imageFiles.some((file) => file.type && !file.type.startsWith("image/"))) {
      showStatus("Choose image files only.", "error");
      return;
    }
    if (modelFiles.some((file) => !file.name.toLowerCase().endsWith(".glb"))) {
      showStatus("All model files must be GLB (.glb) files.", "error");
      return;
    }
    if (modelFiles.some((file) => file.size > 70 * 1024 * 1024)) {
      showStatus("Each GLB model must be 70 MB or smaller.", "error");
      return;
    }
    if (hasDuplicateNames([
      ...imageFiles.map((file) => webpFileName(file.name)),
      ...modelFiles.map((file) => file.name),
    ])) {
      showStatus("Image output names and model filenames must be unique.", "error");
      return;
    }

    saving = true;
    publishButton.disabled = true;
    folderButton.disabled = true;
    try {
      const convertedImages = [];
      for (let index = 0; index < imageFiles.length; index += 1) {
        showStatus(`Converting image ${index + 1} of ${imageFiles.length} to WebP…`);
        convertedImages.push(await convertToWebp(imageFiles[index]));
      }

      if (remoteAvailable) {
        const projects = await window.loadProjects();
        const project = await uploadToVercel(title, categories, convertedImages, modelFiles, projects);
        showStatus(`Published “${project.title}” to Vercel. Refresh the gallery to see the new project.`, "success");
        form.reset();
        cloudStatus.textContent = "Vercel storage is ready. Enter the upload password to publish another project.";
        return;
      }

      const projects = await readProjects(siteDirectory);
      const assetsDirectory = await siteDirectory.getDirectoryHandle("assets");
      const coversDirectory = await assetsDirectory.getDirectoryHandle("gallery-covers");
      const idBase = createSlug(title);
      let id = idBase;
      let suffix = 2;
      while (
        projects.some((project) => project && project.id === id) ||
        await directoryExists(coversDirectory, id)
      ) {
        id = `${idBase}-${suffix}`;
        suffix += 1;
      }

      const projectDirectoryName = id;
      const projectDirectory = await coversDirectory.getDirectoryHandle(projectDirectoryName, { create: true });
      const relativeFolder = `assets/gallery-covers/${projectDirectoryName}`;
      const assetPath = (name) => `${relativeFolder}/${name}`;
      const imagePaths = convertedImages.map((file) => encodeAssetPath(assetPath(file.name)));
      const project = {
        id,
        title,
        categories,
        description: "A new eyewear design concept, shown from multiple product views.",
        cover: imagePaths[0],
        photos: imagePaths,
        sourceFolder: relativeFolder,
      };
      if (modelFiles.length) project.model = encodeAssetPath(assetPath(modelFiles[0].name));
      if (modelFiles.length > 1) project.faceModel = encodeAssetPath(assetPath(modelFiles[1].name));

      const files = [
        ...convertedImages.map((file) => ({ name: file.name, contents: file.blob })),
        ...modelFiles.map((file) => ({ name: file.name, contents: file })),
      ];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        showStatus(`Saving project file ${index + 1} of ${files.length}…`);
        await writeFile(projectDirectory, file.name, file.contents);
      }

      projects.push(project);
      showStatus("Updating project list…");
      await writeFile(
        siteDirectory,
        "project-data.json",
        `${JSON.stringify(projects, null, 2)}\n`
      );

      showStatus(`Saved “${title}” to ${relativeFolder}. For GitHub Pages, commit and push project-data.json and the assets/gallery-covers/${projectDirectoryName} folder to your publishing branch; GitHub Actions will deploy the project. Refresh the local gallery to see it now.`, "success");
      form.reset();
    } catch (error) {
      showStatus(`Could not save the project: ${error.message}`, "error");
      console.error("Could not publish project", error);
    } finally {
      saving = false;
      folderButton.disabled = false;
      updatePublishButton();
    }
  }

  folderButton.addEventListener("click", chooseSiteFolder);
  uploadPassword.addEventListener("input", updatePublishButton);
  form.addEventListener("submit", saveProject);
  checkRemoteUploadService();
})();
