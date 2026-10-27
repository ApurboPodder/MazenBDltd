(() => {
  function naturalSortKey(value) {
    return value.match(/\d+|\D+/g).map((part) =>
      /^\d+$/.test(part) ? [0, Number(part)] : [1, part.toLocaleLowerCase()]
    );
  }

  function naturalCompare(first, second) {
    const firstParts = naturalSortKey(first);
    const secondParts = naturalSortKey(second);
    for (let index = 0; index < Math.min(firstParts.length, secondParts.length); index += 1) {
      const [firstType, firstValue] = firstParts[index];
      const [secondType, secondValue] = secondParts[index];
      if (firstType !== secondType) {
        return String(firstValue).localeCompare(String(secondValue), undefined, { sensitivity: "base" });
      }
      if (firstValue < secondValue) return -1;
      if (firstValue > secondValue) return 1;
    }
    return firstParts.length - secondParts.length;
  }

  function createSlug(value) {
    const slug = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "project";
  }

  function isLocalServer() {
    return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  }

  async function readDirectoryListing(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Folder listing request failed (${response.status}).`);
    }
    const html = await response.text();
    const listing = new DOMParser().parseFromString(html, "text/html");
    if (!listing.querySelector("a[href]")) {
      throw new Error("The server did not provide a folder listing.");
    }
    return [...listing.querySelectorAll("a[href]")].map((link) => {
      const target = new URL(link.getAttribute("href"), response.url);
      if (target.origin !== window.location.origin || target.search || target.hash) return null;
      return {
        url: target,
        isDirectory: link.classList.contains("icon-directory") ||
          link.getAttribute("href").endsWith("/"),
      };
    }).filter(Boolean);
  }

  async function discoverProjectFolders(registeredProjects) {
    if (!isLocalServer()) return [];

    const registeredFolders = new Set(
      registeredProjects
        .map((project) => project && project.sourceFolder)
        .filter((folder) => typeof folder === "string")
    );
    const projectIds = new Set(
      registeredProjects
        .map((project) => project && project.id)
        .filter((id) => typeof id === "string")
    );
    const rootUrl = new URL("assets/gallery-covers/", window.location.href);
    const rootPath = rootUrl.pathname;
    const entries = await readDirectoryListing(rootUrl);
    const folders = entries
      .filter((entry) => entry.isDirectory && entry.url.pathname.startsWith(rootPath))
      .map((entry) => ({
        url: entry.url,
        path: entry.url.pathname.slice(rootPath.length),
      }))
      .filter((entry) => entry.path && !entry.path.includes("/"))
      .sort((first, second) => naturalCompare(first.path, second.path));

    const discovered = [];
    for (const folder of folders) {
      const folderName = decodeURIComponent(folder.path.replace(/\/$/, ""));
      const sourceFolder = `assets/gallery-covers/${folderName}`;
      const registeredProject = registeredProjects.find((project) => project && project.sourceFolder === sourceFolder);
      if (registeredFolders.has(sourceFolder) && !registeredProject) continue;

      const folderUrl = new URL(`${encodeURIComponent(folderName)}/`, rootUrl);
      const files = await readDirectoryListing(folderUrl);
      const images = files
        .filter((file) => !file.isDirectory && file.url.pathname.startsWith(folderUrl.pathname))
        .filter((file) => !file.url.pathname.slice(folderUrl.pathname.length).includes("/"))
        .filter((file) => decodeURIComponent(file.url.pathname).toLowerCase().endsWith(".webp"))
        .sort((first, second) =>
          naturalCompare(
            decodeURIComponent(first.url.pathname.split("/").pop()),
            decodeURIComponent(second.url.pathname.split("/").pop())
          )
        );
      const models = files
        .filter((file) => !file.isDirectory && file.url.pathname.startsWith(folderUrl.pathname))
        .filter((file) => !file.url.pathname.slice(folderUrl.pathname.length).includes("/"))
        .filter((file) => decodeURIComponent(file.url.pathname).toLowerCase().endsWith(".glb"))
        .sort((first, second) => {
          const firstName = decodeURIComponent(first.url.pathname.split("/").pop());
          const secondName = decodeURIComponent(second.url.pathname.split("/").pop());
          const priority = (name) => name.toLowerCase() === "glb1.glb" ? 0 :
            name.toLowerCase() === "glb2.glb" ? 1 : 2;
          return priority(firstName) - priority(secondName) || naturalCompare(firstName, secondName);
        });
      if (!images.length) continue;

      const baseId = createSlug(folderName);
      let id = baseId;
      let suffix = 2;
      while (projectIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }

      const project = {
        id,
        title: folderName,
        category: "Eyewear design",
        description: "A new eyewear design concept, shown from multiple product views.",
        sourceFolder,
        cover: images[0].url.href,
        photos: images.map((image) => image.url.href),
      };
      if (registeredProject) {
        if (models.length) {
          registeredProject.model = models[0].url.href;
          if (models.length > 1) registeredProject.faceModel = models[1].url.href;
          else delete registeredProject.faceModel;
        }
        continue;
      }
      if (models.length) {
        project.model = models[0].url.href;
        if (models.length > 1) project.faceModel = models[1].url.href;
      }
      discovered.push(project);
      projectIds.add(id);
      registeredFolders.add(sourceFolder);
    }
    return discovered;
  }

  async function discoverGlbModels() {
    if (!isLocalServer()) return { models: [], warnings: [] };
    const rootUrl = new URL("assets/gallery-covers/", window.location.href);
    const pendingFolders = [rootUrl];
    const visitedFolders = new Set();
    const models = [];
    const warnings = [];

    while (pendingFolders.length) {
      const folderUrl = pendingFolders.pop();
      if (visitedFolders.has(folderUrl.pathname)) continue;
      visitedFolders.add(folderUrl.pathname);
      let entries;
      try {
        entries = await readDirectoryListing(folderUrl);
      } catch (error) {
        if (folderUrl.pathname === rootUrl.pathname) throw error;
        warnings.push(`${decodeURIComponent(folderUrl.pathname)}: ${error.message}`);
        continue;
      }
      entries.forEach((entry) => {
        if (!entry.url.pathname.startsWith(rootUrl.pathname)) return;
        if (entry.isDirectory) {
          pendingFolders.push(entry.url);
        } else if (decodeURIComponent(entry.url.pathname).toLowerCase().endsWith(".glb")) {
          models.push(entry.url.href);
        }
      });
    }

    return {
      models: models.sort((first, second) =>
        naturalCompare(decodeURIComponent(first), decodeURIComponent(second))
      ),
      warnings,
    };
  }

  const projectCacheKey = "eyewear-projects:" + new URL("project-data.json", window.location.href).href;
  try {
    window.localStorage.removeItem(projectCacheKey);
    window.localStorage.removeItem(projectCacheKey + ":cloud");
  } catch (error) {
    console.warn("Could not clear old project data caches", error);
  }

  async function refreshProjects() {
    const response = await fetch("project-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Project list request failed (" + response.status + ").");
    const projects = await response.json();
    if (!Array.isArray(projects)) throw new Error("The project list has an invalid format.");

    const projectIds = new Set(projects
      .map((project) => project && project.id)
      .filter((id) => typeof id === "string"));
    const warnings = [];
    if (window.location.protocol !== "file:") {
      try {
        const cloudResponse = await fetch("api/projects", { cache: "no-store" });
        if (cloudResponse.status !== 404) {
          if (!cloudResponse.ok) {
            throw new Error(`Cloud project request failed (${cloudResponse.status}).`);
          }
          const cloudProjects = await cloudResponse.json();
          if (!Array.isArray(cloudProjects)) {
            throw new Error("The cloud project list has an invalid format.");
          }
          cloudProjects.forEach((project) => {
            if (
              !project ||
              typeof project.id !== "string" ||
              typeof project.title !== "string" ||
              !(typeof project.category === "string" || Array.isArray(project.categories)) ||
              typeof project.description !== "string"
            ) {
              throw new Error("A cloud project entry is missing required details.");
            }
            if (!projectIds.has(project.id)) {
              projects.push(project);
              projectIds.add(project.id);
            }
          });
        }
      } catch (error) {
        warnings.push(`Cloud projects could not be loaded: ${error.message}`);

        console.error("Could not load Vercel-hosted projects", error);
      }
    }

    try {
      const discoveredProjects = await discoverProjectFolders(projects);
      discoveredProjects.forEach((project) => {
        if (!projectIds.has(project.id)) {
          projects.push(project);
          projectIds.add(project.id);
        }
      });
    } catch (error) {
      warnings.push(`Local folder discovery is unavailable: ${error.message}`);
      console.warn("Could not discover project folders from the local server", error);
    }
    window.projectDataWarnings = warnings;
    return projects;
  }

  function loadProjects() {
    return refreshProjects();
  }

  window.discoverProjectFolders = discoverProjectFolders;
  window.discoverGlbModels = discoverGlbModels;
  window.loadProjects = loadProjects;
})();
