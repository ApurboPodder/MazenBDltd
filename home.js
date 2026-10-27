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
  const contactDialog = document.getElementById("contactDialog");
  const contactTrigger = document.querySelector(".contact-trigger");
  const contactClose = document.querySelector("[data-contact-close]");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
  const loader = new GLTFLoader();
  const models = new THREE.Group();
  let previewModels = [];
  let currentModelIndex = 0;
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
  controls.enableZoom = false;
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
    modelLabel.textContent = model.label;
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
    try {
      const nextIndex = (currentModelIndex + direction + previewModels.length) % previewModels.length;
      const modelContent = await loadModel(previewModels[nextIndex].path);
      const previousModel = models.children[0];
      const nextModel = new THREE.Group();
      nextModel.add(modelContent);
      if (previousModel) await slideBetweenModels(previousModel, nextModel, direction);
      else {
        fitModel(nextModel);
        models.add(nextModel);
      }
      currentModelIndex = nextIndex;
      updateProjectCaption(previewModels[currentModelIndex]);
      status.textContent = "Preview ready.";
      status.hidden = true;
    } catch (error) {
      showError("The selected 3D preview model could not be loaded.", error);
    } finally {
      isSwitchingModels = false;
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

  async function loadModels() {
    try {
      const projects = await window.loadProjects();
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
      const modelsByPath = new Map();
      const excludedModelPaths = new Set();
      projects.forEach((project) => {
        [project.faceModel, project.faceVariants?.faceVisible].forEach((path) => {
          if (typeof path === "string") {
            excludedModelPaths.add(new URL(path, window.location.href).href);
          }
        });
      });
      const addModel = (path, project, fileName = "") => {
        if (typeof path !== "string" || !/\.glb(?:$|[?#])/i.test(path)) return;
        const modelUrl = new URL(path, window.location.href);
        if (excludedModelPaths.has(modelUrl.href)) return;
        const decodedFileName = fileName ||
          decodeURIComponent(modelUrl.pathname.split("/").pop());
        if (/^project 6 glb 1\.glb$/i.test(decodedFileName)) return;
        if (modelsByPath.has(modelUrl.href)) return;
        const title = project?.title || decodedFileName.replace(/\.glb$/i, "");
        modelsByPath.set(modelUrl.href, {
          path: modelUrl.href,
          label: `${title.toUpperCase()} / 3D MODEL`,
          title,
          projectId: project?.id,
        });
      };

      projects.forEach((project) => {
        addModel(project.model, project);
        addModel(project.faceVariants?.faceHidden, project);
      });

      try {
        const discovery = await window.discoverGlbModels();
        discoveryWarnings = discovery.warnings;
        discovery.models.forEach((path) => {
          const modelPath = decodeURIComponent(new URL(path, window.location.href).pathname)
            .toLowerCase();
          const matchingProject = projectsByFolder.find(({ folderPath }) =>
            modelPath.startsWith(`${folderPath}/`)
          )?.project;
          addModel(path, matchingProject);
        });
      } catch (error) {
        console.warn("Could not scan project folders for additional GLB models", error);
        discoveryWarnings = [error.message];
      }

      previewModels = [...modelsByPath.values()];
      previousModelButton.disabled = previewModels.length < 2;
      nextModelButton.disabled = previewModels.length < 2;
      if (!previewModels.length) {
        throw new Error("No eyewear GLB models were found in the project data or project folders.");
      }
      const modelContent = await loadModel(previewModels[0].path);
      const model = new THREE.Group();
      model.add(modelContent);
      fitModel(model);
      models.add(model);
      updateProjectCaption(previewModels[0]);
      const warnings = [...(window.projectDataWarnings || []), ...discoveryWarnings];
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
    controls.dispose();
    studioEnvironment.dispose();
    renderer.dispose();
  }, { once: true });
})();
