(() => {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project");
  const title = document.getElementById("projectTitle");
  const category = document.getElementById("projectCategory");
  const description = document.getElementById("projectDescription");
  const images = document.getElementById("projectImages");
  const configuratorLink = document.getElementById("projectConfiguratorLink");
  const tryOnLink = document.getElementById("projectTryOnLink");
  const modelPreview = document.getElementById("projectModelPreview");
  const modelCanvas = document.getElementById("projectModelCanvas");
  const modelStatus = document.getElementById("projectModelStatus");
  const status = document.getElementById("projectStatus");
  const lightbox = document.getElementById("projectImageLightbox");
  const lightboxImage = document.getElementById("projectImageLightboxImage");
  const lightboxCaption = document.getElementById("projectImageLightboxCaption");
  const lightboxContent = document.querySelector(".project-image-lightbox-content");
  let projectImages = [];
  let activeImageIndex = 0;
  let imageZoom = 1;
  let imagePanX = 0;
  let imagePanY = 0;
  let pinchStart;
  let wheelZoomTimeout;
  const imagePointers = new Map();

  function constrainImagePan() {
    const bounds = lightboxContent.getBoundingClientRect();
    const maxX = bounds.width * (imageZoom - 1) / 2;
    const maxY = bounds.height * (imageZoom - 1) / 2;
    imagePanX = Math.max(-maxX, Math.min(maxX, imagePanX));
    imagePanY = Math.max(-maxY, Math.min(maxY, imagePanY));
  }

  function renderImageZoom() {
    constrainImagePan();
    lightboxImage.style.transform = `translate3d(${imagePanX}px, ${imagePanY}px, 0) scale(${imageZoom})`;
    lightboxContent.classList.toggle("is-zoomed", imageZoom > 1);
  }

  function resetImageZoom() {
    imageZoom = 1;
    imagePanX = 0;
    imagePanY = 0;
    pinchStart = null;
    clearTimeout(wheelZoomTimeout);
    lightboxContent.classList.remove("is-wheel-zooming");
    renderImageZoom();
  }

  function setImageZoom(nextZoom, focusX, focusY, smooth = false) {
    const previousZoom = imageZoom;
    imageZoom = Math.max(1, Math.min(5, nextZoom));
    imagePanX = focusX - (focusX - imagePanX) * (imageZoom / previousZoom);
    imagePanY = focusY - (focusY - imagePanY) * (imageZoom / previousZoom);
    clearTimeout(wheelZoomTimeout);
    lightboxContent.classList.toggle("is-wheel-zooming", smooth);
    if (smooth) {
      wheelZoomTimeout = window.setTimeout(() => {
        lightboxContent.classList.remove("is-wheel-zooming");
      }, 160);
    }
    renderImageZoom();
  }

  function getImagePoint(event) {
    const bounds = lightboxContent.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
    };
  }

  function showImage(index) {
    activeImageIndex = (index + projectImages.length) % projectImages.length;
    const image = projectImages[activeImageIndex];
    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    lightboxCaption.textContent = `${activeImageIndex + 1} / ${projectImages.length} · ${image.alt}`;
    resetImageZoom();
  }

  function openImage(index) {
    if (!projectImages.length) return;
    showImage(index);
    lightbox.showModal();
  }

  document.getElementById("projectImageLightboxClose").addEventListener("click", () => {
    lightbox.close();
  });
  document.getElementById("projectImageLightboxPrevious").addEventListener("click", () => {
    showImage(activeImageIndex - 1);
  });
  document.getElementById("projectImageLightboxNext").addEventListener("click", () => {
    showImage(activeImageIndex + 1);
  });
  lightboxContent.addEventListener("wheel", (event) => {
    if (!lightbox.open) return;
    event.preventDefault();
    const point = getImagePoint(event);
    setImageZoom(imageZoom * Math.exp(-event.deltaY * 0.002), point.x, point.y, true);
  }, { passive: false });
  lightboxContent.addEventListener("pointerdown", (event) => {
    if (!lightbox.open) return;
    clearTimeout(wheelZoomTimeout);
    lightboxContent.classList.remove("is-wheel-zooming");
    imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.isTrusted) lightboxContent.setPointerCapture(event.pointerId);
    if (imagePointers.size === 2) {
      const [first, second] = [...imagePointers.values()];
      const point = getImagePoint({
        clientX: (first.x + second.x) / 2,
        clientY: (first.y + second.y) / 2,
      });
      pinchStart = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: imageZoom,
        panX: imagePanX,
        panY: imagePanY,
        pointX: point.x,
        pointY: point.y,
      };
    } else if (imagePointers.size === 1 && imageZoom > 1) {
      pinchStart = {
        panX: imagePanX,
        panY: imagePanY,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
    }
    if (event.pointerType === "touch" || imageZoom > 1) event.preventDefault();
  });
  lightboxContent.addEventListener("pointermove", (event) => {
    if (!imagePointers.has(event.pointerId)) return;
    imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (imagePointers.size >= 2 && pinchStart?.distance) {
      const [first, second] = [...imagePointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const center = getImagePoint({
        clientX: (first.x + second.x) / 2,
        clientY: (first.y + second.y) / 2,
      });
      imageZoom = Math.max(1, Math.min(5, pinchStart.zoom * distance / pinchStart.distance));
      imagePanX = center.x - ((pinchStart.pointX - pinchStart.panX) / pinchStart.zoom) * imageZoom;
      imagePanY = center.y - ((pinchStart.pointY - pinchStart.panY) / pinchStart.zoom) * imageZoom;
      renderImageZoom();
      event.preventDefault();
    } else if (imagePointers.size === 1 && pinchStart?.pointerX !== undefined) {
      imagePanX = pinchStart.panX + event.clientX - pinchStart.pointerX;
      imagePanY = pinchStart.panY + event.clientY - pinchStart.pointerY;
      renderImageZoom();
      event.preventDefault();
    }
  });
  function finishImagePointer(event) {
    imagePointers.delete(event.pointerId);
    if (event.isTrusted && lightboxContent.hasPointerCapture(event.pointerId)) {
      lightboxContent.releasePointerCapture(event.pointerId);
    }
    pinchStart = null;
    if (imagePointers.size === 1 && imageZoom > 1) {
      const [pointer] = imagePointers.values();
      pinchStart = {
        panX: imagePanX,
        panY: imagePanY,
        pointerX: pointer.x,
        pointerY: pointer.y,
      };
    }
  }
  lightboxContent.addEventListener("pointerup", finishImagePointer);
  lightboxContent.addEventListener("pointercancel", finishImagePointer);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  document.addEventListener("keydown", (event) => {
    if (!lightbox.open) return;
    if (event.key === "Escape") {
      lightbox.close();
      return;
    }
    if (event.key === "ArrowLeft") showImage(activeImageIndex - 1);
    if (event.key === "ArrowRight") showImage(activeImageIndex + 1);
  });

  function setProject(project, photos = []) {
    document.title = `${project.title} — Mazen(BD) Industries LTD`;
    title.textContent = project.title;
    const projectCategories = Array.isArray(project.categories) ? project.categories :
      (typeof project.category === "string" ? [project.category] : []);
    category.textContent = projectCategories.join(" · ").toUpperCase();
    description.textContent = project.description;
    status.textContent = "";
    configuratorLink.hidden = true;
    tryOnLink.hidden = true;
    modelPreview.hidden = true;
    const previewModel = project.faceVariants?.faceHidden || project.model;
    if (typeof previewModel === "string" && previewModel) {
      modelPreview.hidden = false;
      import("./project-viewer.js")
        .then(({ initProjectModelViewer }) => initProjectModelViewer(modelCanvas, modelStatus, previewModel))
        .catch((error) => {
          modelStatus.textContent = "The 3D model preview could not be loaded.";
          console.error("Could not initialize the project model preview", error);
        });
    }
    if (project.faceVariants || project.model) {
      const configuratorPage = project.faceVariants
        ? "multi-configurator.html"
        : "configurator.html";
      const configuratorUrl = new URL(configuratorPage, window.location.href);
      configuratorUrl.searchParams.set("project", project.id);
      if (!project.faceVariants) {
        configuratorUrl.searchParams.set("model", project.model);
        if (project.faceModel) configuratorUrl.searchParams.set("faceModel", project.faceModel);
      }
      configuratorLink.href = configuratorUrl.href;
      configuratorLink.hidden = false;
    }
    const tryOnModel = project.model ||
      project.faceVariants?.faceVisible ||
      project.faceVariants?.faceHidden;
    if (typeof tryOnModel === "string" && tryOnModel) {
      const tryOnUrl = new URL("try-on.html", window.location.href);
      tryOnUrl.searchParams.set("model", tryOnModel);
      tryOnUrl.searchParams.set("title", project.title);
      tryOnLink.href = tryOnUrl.href;
      tryOnLink.hidden = false;
    }

    const imagePaths = photos.length
      ? photos
      : Array.isArray(project.photos) && project.photos.length
        ? project.photos
        : (project.cover ? [project.cover] : []);
    projectImages = imagePaths.map((path, index) => ({
      src: path,
      alt: `${project.title} product view ${index + 1}`,
    }));
    projectImages.forEach((projectImage, index) => {
      const figure = document.createElement("figure");
      figure.className = "project-detail-image";
      const image = document.createElement("img");
      image.src = projectImage.src;
      image.alt = projectImage.alt;
      image.loading = index === 0 ? "eager" : "lazy";
      const button = document.createElement("button");
      button.className = "project-detail-image-button";
      button.type = "button";
      button.setAttribute("aria-label", `View ${project.title} image ${index + 1} full screen`);
      button.addEventListener("click", () => openImage(index));
      button.append(image);
      figure.append(button);
      images.append(figure);
    });
  }

  async function loadProject() {
    if (!projectId) {
      status.textContent = "No project was selected. Return to the project gallery and choose a card.";
      title.textContent = "Project not found";
      return;
    }

    const builtInProjects = {
      "2": {
        id: "2",
        title: "Fashion Acetate",
        category: "Eyewear design",
        description: "A distinctive violet-patterned acetate frame, shown from every angle.",
        photos: [
          "assets/gallery-covers/project%202/1.webp",
          "assets/gallery-covers/project%202/2.webp",
          "assets/gallery-covers/project%202/3.webp",
          "assets/gallery-covers/project%202/4.webp",
        ],
      },
      "1": {
        id: "1",
        title: "Classic Acetate",
        category: "Eyewear design",
        description: "A rounded silhouette with a confident acetate profile, made for everyday wear.",
        photos: ["assets/gallery-covers/1.webp"],
      },
      "3": {
        id: "3",
        title: "Rounded Metal Design",
        category: "Eyewear design",
        description: "A new eyewear design concept, shown from multiple views.",
        photos: [
          "assets/gallery-covers/project%203/1-1.webp",
          "assets/gallery-covers/project%203/1-2.webp",
          "assets/gallery-covers/project%203/1-3.webp",
          "assets/gallery-covers/project%203/1-4.webp",
          "assets/gallery-covers/project%203/1-5.webp",
        ],
      },
      "4": {
        id: "4",
        title: "Project 4",
        category: "Eyewear design",
        description: "A new eyewear design concept, presented in four product views.",
        photos: [
          "assets/gallery-covers/project%204/1.webp",
          "assets/gallery-covers/project%204/2.webp",
          "assets/gallery-covers/project%204/3.webp",
          "assets/gallery-covers/project%204/4.webp",
        ],
      },
      "5": {
        id: "5",
        title: "Modern Design",
        category: "Eyewear design",
        description: "A contemporary eyewear study, presented in five product views.",
        photos: [
          "assets/gallery-covers/project%205/shape%201%201.webp",
          "assets/gallery-covers/project%205/shape%201%202.webp",
          "assets/gallery-covers/project%205/shape%201%203.webp",
          "assets/gallery-covers/project%205/shape%201%205.webp",
          "assets/gallery-covers/project%205/shape%201%206.webp",
        ],
        model: "assets/gallery-covers/project%205/GLB1.glb",
      },
    };

    if (builtInProjects[projectId]) {
      const project = builtInProjects[projectId];
      setProject(project, project.photos);
      return;
    }

    try {
      const projects = await window.loadProjects();
      const project = projects.find((item) => item && item.id === projectId);
      if (!project) throw new Error("That project could not be found.");
      if (
        typeof project.title !== "string" ||
        !(typeof project.category === "string" || Array.isArray(project.categories)) ||
        typeof project.description !== "string"
      ) {
        throw new Error("The project entry is missing required details.");
      }
      setProject(project);
    } catch (error) {
      status.textContent = `This project could not be loaded: ${error.message}`;
      console.error("Could not load project details", error);
    }
  }

  loadProject();
})();
