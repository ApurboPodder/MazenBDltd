(() => {
  const grid = document.querySelector(".project-grid");
  const status = document.getElementById("galleryDataStatus");
  if (!grid || !status) return;
  const builtInProjectIds = new Set(["1", "2", "3", "4", "5"]);
  const categoryFilters = [...document.querySelectorAll(".category-filter")];
  let activeCategory = "all";

  function projectCategories(project) {
    const value = Array.isArray(project.categories) ? project.categories : project.category;
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") :
      typeof value === "string" ? [value] : [];
  }

  function applyCategoryFilter() {
    grid.querySelectorAll(".project-card").forEach((card) => {
      card.hidden = activeCategory !== "all" && !card.dataset.categories.split("|").includes(activeCategory);
    });
  }

  categoryFilters.forEach((button) => button.addEventListener("click", () => {
    activeCategory = button.dataset.category;
    categoryFilters.forEach((filter) => {
      const selected = filter === button;
      filter.classList.toggle("is-active", selected);
      filter.setAttribute("aria-pressed", String(selected));
    });
    applyCategoryFilter();
  }));

  function hasGlbModel(project) {
    const modelPaths = [
      project.model,
      project.faceModel,
      ...Object.values(project.faceVariants || {}),
    ];
    return modelPaths.some((path) =>
      typeof path === "string" && /\.glb(?:$|[?#])/i.test(path)
    );
  }

  function createProjectCard(project, index) {
    const card = document.createElement("article");
    card.className = "project-card";
    const categories = projectCategories(project);
    card.dataset.categories = categories.join("|");

    const projectUrl = new URL("project.html", window.location.href);
    projectUrl.searchParams.set("project", project.id);

    const artLink = document.createElement("a");
    artLink.className = "project-art";
    artLink.href = projectUrl.href;
    artLink.setAttribute("aria-label", `View ${project.title} project details`);

    const number = document.createElement("span");
    number.className = "project-number";
    number.textContent = `${String(index).padStart(2, "0")} / ${categories.join(" · ").toUpperCase()}`;
    artLink.append(number);

    if (project.cover) {
      const cover = document.createElement("img");
      cover.className = "project-dynamic-cover";
      cover.src = project.cover;
      cover.alt = `${project.title} project cover`;
      artLink.append(cover);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "project-cover-placeholder";
      placeholder.textContent = "NO COVER IMAGE";
      placeholder.setAttribute("aria-hidden", "true");
      artLink.append(placeholder);
    }

    const caption = document.createElement("span");
    caption.className = "art-caption";
    caption.textContent = categories.join(" · ").toUpperCase();
    artLink.append(caption);

    const copy = document.createElement("div");
    copy.className = "project-copy";
    const meta = document.createElement("div");
    meta.className = "project-meta";
    const metaCategory = document.createElement("span");
    metaCategory.textContent = categories.join(" · ");
    const metaNumber = document.createElement("span");
    metaNumber.textContent = String(index).padStart(2, "0");
    meta.append(metaCategory, metaNumber);

    const title = document.createElement("h2");
    title.textContent = project.title;
    const description = document.createElement("p");
    description.textContent = project.description;
    const cta = document.createElement("a");
    cta.className = "project-cta";
    cta.href = projectUrl.href;
    cta.append(document.createTextNode("View project "));
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    cta.append(arrow);

    copy.append(meta, title, description, cta);
    card.append(artLink, copy);
    return card;
  }

  async function loadProjects() {
    try {
      const projects = await window.loadProjects();
      const projectsById = new Map(projects.map((project) => [project.id, project]));
      const staticCards = [...grid.querySelectorAll(".project-card")];
      staticCards.forEach((card) => {
        const projectLink = card.querySelector(".project-art");
        const projectId = projectLink && new URL(projectLink.href).searchParams.get("project");
        const project = projectsById.get(projectId);
        if (!project || !hasGlbModel(project)) { card.remove(); return; }
        const categories = projectCategories(project);
        card.dataset.categories = categories.join("|");
        const categoryLabel = card.querySelector(".project-meta span");
        const artCaption = card.querySelector(".art-caption");
        if (categoryLabel) categoryLabel.textContent = categories.join(" · ");
        if (artCaption) artCaption.textContent = categories.join(" · ").toUpperCase();
      });
      const visibleBuiltInCount = grid.querySelectorAll(".project-card").length;
      projects
        .filter((project) => !builtInProjectIds.has(project.id) && hasGlbModel(project))
        .forEach((project, index) => {
          grid.append(createProjectCard(project, visibleBuiltInCount + index + 1));
        });
      applyCategoryFilter();
      if (window.projectDataWarnings.length) {
        status.textContent = window.projectDataWarnings.join(" ");
      }
    } catch (error) {
      status.textContent = `Additional projects could not be loaded: ${error.message}`;
      console.error("Could not load additional project cards", error);
    }
  }

  loadProjects();
})();
