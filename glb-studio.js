import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { boostModelColor, enhanceMetalReflections, setupStudioEnvironment } from "./three-studio.js";

(() => {
  const canvas = document.getElementById("homeModel");
  const status = document.getElementById("homeModelStatus");
  const modelLabel = document.getElementById("homeModelLabel");
  const projectLink = document.getElementById("homeModelProject");
  const projectTitle = document.getElementById("homeModelProjectTitle");
  const previousModelButton = document.getElementById("homeModelPrevious");
  const nextModelButton = document.getElementById("homeModelNext");
  const showFaceToggle = document.getElementById("showFaceToggle");
  const zoomToggle = document.getElementById("enablePreviewZoom");
  const faceStatus = document.getElementById("studioFaceStatus");
  const contactDialog = document.getElementById("contactDialog");
  const contactTrigger = document.querySelector(".contact-trigger");
  const contactClose = document.querySelector("[data-contact-close]");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
  const loader = new GLTFLoader();
  const models = new THREE.Group();
  let previewModels = [];
  let currentModelIndex = 0;
  let displayedModelPath = "";
  let modelSwitchTimer;
  const transitionFrames = new Set();
  let referenceModelRadius = 0;
  const referenceModelCenter = new THREE.Vector3();
  let isSwitchingModels = false;
  let renderer;
  let controls;
  let studioEnvironment;
  let resizeObserver;
  let animationFrame;

  contactTrigger.addEventListener("click", () => contactDialog.showModal());
  contactClose.addEventListener("click", () => contactDialog.close());

  showFaceToggle.addEventListener("change", changeFaceMode);
  zoomToggle.addEventListener("change", () => {
    if (controls) controls.enableZoom = zoomToggle.checked;
  });

  function showError(message, error) {
    status.textContent = message;
    if (error) console.error(message, error);
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    controls = new OrbitControls(camera, canvas);
  } catch (error) {
    showError("3D preview is unavailable in this browser.", error);
    return;
  }

  studioEnvironment = setupStudioEnvironment(renderer, scene);
  scene.add(models);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7069, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-3, 5, 6);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xd9e4ed, 1);
  fillLight.position.set(4, 1, -3);
  scene.add(fillLight);

  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.enableZoom = zoomToggle.checked;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1;
  controls.target.set(0, 0, 0);
  camera.position.set(0.65, 0.15, 1.3);

  async function loadModel(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
    const data = await response.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(data, "", resolve, reject);
    });
    if (!gltf.scene) throw new Error("The GLB does not contain a scene.");
    enhanceMetalReflections(gltf.scene);
    boostModelColor(gltf.scene, 0);
    return gltf.scene;
  }

  function disposeModel(model) {
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material.dispose();
      });
    });
  }

  function fitModel(model) {
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error("The preview model contains no visible geometry.");
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = (sphere.radius * 0.95) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    referenceModelRadius = sphere.radius;
    referenceModelCenter.copy(sphere.center);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(sphere.radius / 1000, 0.001);
    camera.far = distance + sphere.radius * 5;
    camera.updateProjectionMatrix();
    controls.update();
    controls.saveState();
  }

  function fitModelToReference(model) {
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error("The preview model contains no visible geometry.");
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const scale = referenceModelRadius / sphere.radius;
    model.scale.setScalar(scale);
    model.position.copy(referenceModelCenter).addScaledVector(sphere.center, -scale);
  }

  function updateProjectCaption(model) {
    const selectedPath = getModelPath(model);
    const fileName = decodeURIComponent(new URL(selectedPath, window.location.href).pathname.split("/").pop());
    modelLabel.textContent = model.title.toUpperCase() + " / " + fileName.toUpperCase();
    projectTitle.textContent = model.title;
    projectLink.href = model.projectId
      ? `project.html?project=${encodeURIComponent(model.projectId)}`
      : "gallery.html";
  }

  function animateModelPosition(model, start, end, duration) {
    const startedAt = performance.now();

    return new Promise((resolve) => {
      let frameId;

      function animate(now) {
        transitionFrames.delete(frameId);
        const progress = duration ? Math.min((now - startedAt) / duration, 1) : 1;
        const easedProgress = progress < 0.5
          ? 4 * progress ** 3
          : 1 - ((-2 * progress + 2) ** 3) / 2;
        model.position.lerpVectors(start, end, easedProgress);

        if (progress < 1) {
          frameId = window.requestAnimationFrame(animate);
          transitionFrames.add(frameId);
          return;
        }

        resolve();
      }

      frameId = window.requestAnimationFrame(animate);
      transitionFrames.add(frameId);
    });
  }

  async function slideBetweenModels(previousModel, nextModel, direction) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDuration = reducedMotion ? 0 : 900;
    fitModelToReference(nextModel);

    const previousBounds = new THREE.Box3().setFromObject(previousModel);
    const previousRadius = previousBounds.getBoundingSphere(new THREE.Sphere()).radius;
    const nextBounds = new THREE.Box3().setFromObject(nextModel);
    const nextRadius = nextBounds.getBoundingSphere(new THREE.Sphere()).radius;
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const outgoingVector = screenRight.clone().multiplyScalar(direction > 0 ? 1 : -1);
    const incomingStartVector = screenRight.clone().multiplyScalar(direction > 0 ? -1 : 1);
    const viewWidth = camera.position.distanceTo(controls.target)
      * 2
      * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      * camera.aspect;
    const previousStart = previousModel.position.clone();
    const previousEnd = previousStart.clone().add(
      outgoingVector.clone().multiplyScalar(viewWidth / 2 + previousRadius)
    );
    const nextEnd = nextModel.position.clone();
    const startPosition = nextEnd.clone().add(
      incomingStartVector.clone().multiplyScalar(viewWidth / 2 + nextRadius)
    );
    nextModel.position.copy(startPosition);
    models.add(nextModel);

    await Promise.all([
      animateModelPosition(previousModel, previousStart, previousEnd, transitionDuration),
      animateModelPosition(nextModel, startPosition, nextEnd, transitionDuration),
    ]);

    models.remove(previousModel);
    disposeModel(previousModel);
  }

  function scheduleNextModel() {
    window.clearTimeout(modelSwitchTimer);
    if (previewModels.length < 2) return;
    modelSwitchTimer = window.setTimeout(() => switchModel(1), 15000);
  }

  function pauseModelTimer() {
    window.clearTimeout(modelSwitchTimer);
  }

  canvas.addEventListener("pointerdown", pauseModelTimer);
  canvas.addEventListener("pointerup", scheduleNextModel);
  canvas.addEventListener("pointercancel", scheduleNextModel);
  canvas.addEventListener("click", scheduleNextModel);

  async function switchModel(direction) {
    if (isSwitchingModels || previewModels.length < 2) return;
    isSwitchingModels = true;
    showFaceToggle.disabled = true;
    try {
      const nextIndex = (currentModelIndex + direction + previewModels.length) % previewModels.length;
      status.hidden = false;
      status.textContent = "Loading " + previewModels[nextIndex].title + " GLB…";
      const nextPath = getModelPath(previewModels[nextIndex]);
      const modelContent = await loadModel(nextPath);
      const previousModel = models.children[0];
      const nextModel = new THREE.Group();
      nextModel.add(modelContent);
      if (previousModel) await slideBetweenModels(previousModel, nextModel, direction);
      else {
        fitModel(nextModel);
        models.add(nextModel);
      }
      removeFaceModel();
      currentModelIndex = nextIndex;
      displayedModelPath = nextPath;
      updateProjectCaption(previewModels[currentModelIndex]);
      if (showFaceToggle.checked && previewModels[currentModelIndex].visiblePath !== nextPath) {
        try {
          await addFaceModel(previewModels[currentModelIndex]);
          updateFaceModeStatus("Face shown alongside the model.");
        } catch (faceError) {
          updateFaceModeStatus("The face GLB could not be loaded.");
          console.error("Could not load face GLB", faceError);
        }
      }
      status.textContent = "Preview ready.";
      status.hidden = true;
    } catch (error) {
      showError("The selected 3D preview model could not be loaded.", error);
    } finally {
      isSwitchingModels = false;
      showFaceToggle.disabled = false;
      scheduleNextModel();
    }
  }

  function selectPreviousModel() {
    pauseModelTimer();
    switchModel(-1);
  }

  function selectNextModel() {
    pauseModelTimer();
    switchModel(1);
  }

  previousModelButton.addEventListener("click", selectPreviousModel);
  nextModelButton.addEventListener("click", selectNextModel);

  function getModelPath(model) {
    return model ? model.hiddenPath || model.visiblePath || "" : "";
  }

  function removeFaceModel() {
    if (!activeFaceModel) return;
    scene.remove(activeFaceModel);
    disposeModel(activeFaceModel);
    activeFaceModel = null;
  }

  async function addFaceModel(model) {
    const facePath = model && model.visiblePath;
    const mainPath = getModelPath(model);
    if (!facePath || facePath === mainPath) return false;
    const faceContent = await loadModel(facePath);
    const faceGroup = new THREE.Group();
    faceGroup.add(faceContent);
    fitModelToReference(faceGroup);
    scene.add(faceGroup);
    activeFaceModel = faceGroup;
    return true;
  }

  function updateFaceModeStatus(message) {
    if (message) {
      faceStatus.textContent = message;
    } else {
      faceStatus.textContent = showFaceToggle.checked
        ? "Face shown alongside the model when a GLB2 face file is available."
        : "Face hidden.";
    }
  }

  async function changeFaceMode() {
    pauseModelTimer();
    updateFaceModeStatus();
    if (!previewModels.length || isSwitchingModels) return;
    const selected = previewModels[currentModelIndex];
    isSwitchingModels = true;
    showFaceToggle.disabled = true;
    try {
      if (showFaceToggle.checked) {
        if (!selected.visiblePath || selected.visiblePath === getModelPath(selected)) {
          updateFaceModeStatus("No separate GLB2 face file is available for this project.");
        } else {
          status.hidden = false;
          status.textContent = "Loading face alongside " + selected.title + "…";
          removeFaceModel();
          const added = await addFaceModel(selected);
          updateFaceModeStatus(added ? "Face shown alongside the model." : "No separate GLB2 face file is available for this project.");
          status.hidden = true;
        }
      } else {
        removeFaceModel();
        updateFaceModeStatus("Face hidden.");
      }
    } catch (error) {
      updateFaceModeStatus("The face GLB could not be loaded.");
      console.error("Could not load face GLB", error);
    } finally {
      isSwitchingModels = false;
      showFaceToggle.disabled = false;
      scheduleNextModel();
    }
  }

  async function loadModels() {
    try {
      status.hidden = false;
      status.textContent = "Loading project list…";
      const projectResponse = await fetch("project-data.json", { cache: "no-store" });
      if (!projectResponse.ok) throw new Error("Project list request failed (" + projectResponse.status + ").");
      const projects = await projectResponse.json();
      if (!Array.isArray(projects)) throw new Error("The project list has an invalid format.");
      let discoveryWarnings = [];
      const projectsByFolder = projects
        .filter((project) => typeof project.sourceFolder === "string")
        .map((project) => ({
          project,
          folderPath: decodeURIComponent(new URL(project.sourceFolder, window.location.href).pathname)
            .replace(/\/+$/, "")
            .toLowerCase(),
        }))
        .sort((first, second) => second.folderPath.length - first.folderPath.length);
      const modelsByProject = new Map();

      function registerModel(path, project, role = "auto") {
        if (typeof path !== "string" || !/\.glb(?:$|[?#])/i.test(path)) return;
        const modelUrl = new URL(path, window.location.href);
        const fileName = decodeURIComponent(modelUrl.pathname.split("/").pop());
        const directory = modelUrl.pathname.slice(0, modelUrl.pathname.lastIndexOf("/"));
        const key = project && project.id ? "project:" + project.id : "folder:" + directory.toLowerCase();
        let entry = modelsByProject.get(key);
        if (!entry) {
          const folderName = decodeURIComponent(directory.split("/").pop() || fileName.replace(/\.glb$/i, ""));
          entry = { title: project && project.title ? project.title : folderName, projectId: project && project.id, hiddenPath: "", visiblePath: "" };
          modelsByProject.set(key, entry);
        }
        const lowerName = fileName.toLowerCase();
        if (lowerName === "glb1.glb") entry.hiddenPath = modelUrl.href;
        else if (lowerName === "glb2.glb") entry.visiblePath = modelUrl.href;
        else if (role === "visible" || role === "faceVisible" || role === "faceModel") entry.visiblePath = modelUrl.href;
        else if (role === "hidden" || role === "faceHidden" || role === "model") entry.hiddenPath = modelUrl.href;
        else if (!entry.hiddenPath) entry.hiddenPath = modelUrl.href;
        else if (!entry.visiblePath) entry.visiblePath = modelUrl.href;
      }

      projects.forEach((project) => {
        registerModel(project.faceVariants && project.faceVariants.faceHidden, project, "hidden");
        registerModel(project.model, project, "model");
        registerModel(project.faceVariants && project.faceVariants.faceVisible, project, "visible");
        registerModel(project.faceModel, project, "faceModel");
      });

      try {
        const discovery = await window.discoverGlbModels();
        discoveryWarnings = discovery.warnings || [];
        discovery.models.forEach((path) => {
          const modelPath = decodeURIComponent(new URL(path, window.location.href).pathname).toLowerCase();
          const matchingProject = projectsByFolder.find(({ folderPath }) => modelPath.startsWith(folderPath + "/"))?.project;
          registerModel(path, matchingProject);
        });
      } catch (error) {
        console.warn("Could not scan project folders for additional GLB models", error);
        discoveryWarnings = [error.message];
      }

      previewModels = [...modelsByProject.values()].filter((model) => model.hiddenPath || model.visiblePath);
      previewModels.sort((first, second) => first.title.localeCompare(second.title, undefined, { numeric: true, sensitivity: "base" }));
      previousModelButton.disabled = previewModels.length < 2;
      nextModelButton.disabled = previewModels.length < 2;
      if (!previewModels.length) throw new Error("No eyewear GLB models were found in the project data or project folders.");
      const modelPath = getModelPath(previewModels[0]);
      status.textContent = "Loading " + previewModels[0].title + " GLB…";
      const modelContent = await loadModel(modelPath);
      const model = new THREE.Group();
      model.add(modelContent);
      fitModel(model);
      models.add(model);
      displayedModelPath = modelPath;
      updateProjectCaption(previewModels[0]);
      updateFaceModeStatus();
      if (showFaceToggle.checked && previewModels[0].visiblePath !== modelPath) {
        try {
          await addFaceModel(previewModels[0]);
          updateFaceModeStatus("Face shown alongside the model.");
        } catch (faceError) {
          updateFaceModeStatus("The face GLB could not be loaded.");
          console.error("Could not load face GLB", faceError);
        }
      }
      const warnings = discoveryWarnings;
      if (warnings.length) {
        status.textContent = "Some project folders could not be checked for additional 3D models.";
        status.hidden = false;
        console.warn("3D preview discovery warnings", warnings);
      } else {
        status.textContent = "Preview ready.";
        status.hidden = true;
      }
      scheduleNextModel();
    } catch (error) {
      showError("The 3D preview could not be loaded.", error);
    }
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    animationFrame = window.requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  animate();
  loadModels();

  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(animationFrame);
transitionFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
    transitionFrames.clear();
    window.clearTimeout(modelSwitchTimer);
    canvas.removeEventListener("pointerdown", pauseModelTimer);
    canvas.removeEventListener("pointerup", scheduleNextModel);
    canvas.removeEventListener("pointercancel", scheduleNextModel);
    canvas.removeEventListener("click", scheduleNextModel);
    previousModelButton.removeEventListener("click", selectPreviousModel);

nextModelButton.removeEventListener("click", selectNextModel);
    resizeObserver.disconnect();
    removeFaceModel();
    controls.dispose();
    studioEnvironment.dispose();
    renderer.dispose();
  }, { once: true });
})();
