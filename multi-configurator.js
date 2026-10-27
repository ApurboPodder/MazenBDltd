import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { enhanceMetalReflections, setupStudioEnvironment } from "./three-studio.js";

(() => {
  const stage = document.getElementById("modelStage");
  const canvas = document.getElementById("modelCanvas");
  const fileInput = document.getElementById("modelFiles");
  const modelName = document.getElementById("modelName");
  const modelStatus = document.getElementById("modelStatus");
  const emptyPrompt = document.getElementById("emptyPrompt");
  const errorMessage = document.getElementById("modelError");
  const chooseModelsButton = document.getElementById("chooseModels");
  const clearModelsButton = document.getElementById("clearModels");
  const autoRotateInput = document.getElementById("autoRotate");
  const showFaceInput = document.getElementById("showFace");
  const facePositionControls = document.getElementById("facePositionControls");
  const facePositionInputs = [...document.querySelectorAll("[data-face-axis]")];
  const facePositionNumberInputs = [...document.querySelectorAll("[data-face-value]")];
  const objectList = document.getElementById("objectList");
  const objectListEmpty = document.getElementById("objectListEmpty");
  const objectListNote = document.getElementById("objectListNote");
  const loader = new GLTFLoader();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const models = [];
  let renderer;
  let controls;
  let studioEnvironment;
  let faceModel;
  let resizeObserver;
  let animationFrame;
  let viewTransition;
  let faceVariantIds;
  let conditionalProjectTitle;
  let nextModelId = 0;

  function setError(message, error) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    modelStatus.textContent = message;
    if (error) console.error(message, error);
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    controls = new OrbitControls(camera, renderer.domElement);
  } catch (error) {
    setError("A WebGL-capable browser is required to display 3D models.", error);
    chooseModelsButton.disabled = true;
    return;
  }

  studioEnvironment = setupStudioEnvironment(renderer, scene);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b887f, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(-4, 6, 7);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xe6e2d8, 0.8);
  fillLight.position.set(5, 1, -4);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
  rimLight.position.set(0, -2, -6);
  scene.add(rimLight);

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotateSpeed = 1.2;
  camera.position.set(0, 0, 5);
  controls.target.set(0, 0, 0);
  controls.update();

  function disposeModel(model) {
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material.dispose();
      });
    });
  }

  function updateFaceVisibility() {
    const hasVisibleModel = models.some((item) => item.visible);
    if (faceVariantIds) {
      const activeVariantId = showFaceInput.checked
        ? faceVariantIds.faceVisible
        : faceVariantIds.faceHidden;
      models.forEach((item) => {
        if (item.id !== faceVariantIds.faceVisible && item.id !== faceVariantIds.faceHidden) return;
        item.visible = item.id === activeVariantId;
        item.root.visible = item.visible;
      });
      if (faceModel) faceModel.visible = showFaceInput.checked;
      modelName.textContent = `${conditionalProjectTitle} · Face ${showFaceInput.checked ? "shown" : "hidden"}`;
      return;
    }
    if (faceModel) faceModel.visible = showFaceInput.checked && hasVisibleModel;
  }

  function updateFacePositionControls() {
    if (!faceModel) return;
    facePositionInputs.forEach((input) => {
      const axis = input.dataset.faceAxis;
      input.value = faceModel.position[axis].toFixed(3);
      document.querySelector(`[data-face-value="${axis}"]`).value = input.value;
    });
    facePositionControls.disabled = false;
  }

  function updateSceneControls() {
    objectList.replaceChildren();
    models.forEach((item) => {
      const row = document.createElement("li");
      row.className = "object-list-item";
      const header = document.createElement("div");
      header.className = "object-list-header";
      const label = document.createElement("label");
      label.className = "object-visibility";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.visible;
      checkbox.disabled = Boolean(faceVariantIds &&
        (item.id === faceVariantIds.faceVisible || item.id === faceVariantIds.faceHidden));
      checkbox.dataset.visibilityId = String(item.id);
      checkbox.setAttribute("aria-label", `Show ${item.name}`);
      const name = document.createElement("span");
      name.textContent = item.name;
      label.append(checkbox, name);

      const removeButton = document.createElement("button");
      removeButton.className = "object-remove";
      removeButton.type = "button";
      removeButton.dataset.removeId = String(item.id);
      removeButton.setAttribute("aria-label", `Remove ${item.name}`);
      removeButton.disabled = Boolean(faceVariantIds &&
        (item.id === faceVariantIds.faceVisible || item.id === faceVariantIds.faceHidden));
      removeButton.textContent = "×";
      header.append(label, removeButton);
      const rotationControls = document.createElement("fieldset");
      rotationControls.className = "object-rotation-controls";
      const legend = document.createElement("legend");
      legend.textContent = "Rotation · degrees";
      rotationControls.append(legend);
      ["x", "y", "z"].forEach((axis) => {
        const control = document.createElement("label");
        control.className = "face-axis-control";
        const axisName = document.createElement("span");
        axisName.textContent = axis.toUpperCase();
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "-180";
        slider.max = "180";
        slider.step = "1";
        slider.value = String(Math.round(THREE.MathUtils.radToDeg(item.root.rotation[axis])));
        slider.dataset.rotationModelId = String(item.id);
        slider.dataset.rotationAxis = axis;
        slider.setAttribute("aria-label", `${item.name} ${axis.toUpperCase()} rotation in degrees`);
        const number = document.createElement("input");
        number.className = "face-axis-number";
        number.type = "number";
        number.min = "-180";
        number.max = "180";
        number.step = "1";
        number.value = slider.value;
        number.dataset.rotationModelId = String(item.id);
        number.dataset.rotationAxisValue = axis;
        number.setAttribute("aria-label", `${item.name} ${axis.toUpperCase()} rotation in degrees`);
        control.append(axisName, slider, number);
        rotationControls.append(control);
      });
      row.append(header, rotationControls);
      objectList.append(row);
    });
    objectListEmpty.hidden = models.length > 0;
    objectListNote.textContent = faceVariantIds
      ? "Toggle Show face to switch between the main model and its face companion."
      : "Each object can be shown, hidden, or removed independently.";
    clearModelsButton.hidden = models.length === 0;
    emptyPrompt.hidden = models.length > 0;
    modelName.textContent = conditionalProjectTitle
      ? `${conditionalProjectTitle} · Face ${showFaceInput.checked ? "shown" : "hidden"}`
      : models.length
        ? `${models.length} ${models.length === 1 ? "object" : "objects"} in view`
        : "Eyewear preview";
    updateFaceVisibility();
  }

  function cancelViewTransition() {
    if (!viewTransition) return;
    viewTransition = null;
    controls.enabled = true;
    controls.enableDamping = true;
  }

  function fitModel(preserveDirection = false) {
    updateFaceVisibility();
    const visibleModels = models.filter((item) => item.visible).map((item) => item.root);
    if (!visibleModels.length && !faceModel?.visible) {
      throw new Error("Show at least one object to fit the view.");
    }

    const bounds = new THREE.Box3();
    visibleModels.forEach((model) => {
      model.updateMatrixWorld(true);
      bounds.union(new THREE.Box3().setFromObject(model));
    });
    if (faceModel?.visible) {
      faceModel.updateMatrixWorld(true);
      bounds.union(new THREE.Box3().setFromObject(faceModel));
    }
    if (bounds.isEmpty()) throw new Error("The visible objects contain no geometry.");
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      throw new Error("The visible objects have invalid dimensions.");
    }

    const direction = camera.position.clone().sub(controls.target);
    if (preserveDirection && direction.lengthSq() > 0) direction.normalize();
    else direction.set(0.22, 0, 1).normalize();

    controls.target.copy(sphere.center);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = (sphere.radius * 1.25) / Math.sin(limitingFov / 2);
    camera.near = Math.max(sphere.radius / 1000, 0.001);
    camera.far = distance + sphere.radius * 5;
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    controls.update();
    controls.saveState();
  }

  function setStandardView(view) {
    if (!models.some((item) => item.visible)) return;
    cancelViewTransition();
    autoRotateInput.checked = false;
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update();
    const distance = Math.max(camera.position.distanceTo(controls.target), 1);
    const direction = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    if (view === "right") {
      direction.set(1, 0, 0);
    } else if (view === "top") {
      direction.set(0, 1, 0);
      up.set(0, 0, -1);
    } else {
      direction.set(0, 0, 1);
    }
    viewTransition = {
      startedAt: performance.now(),
      duration: 600,
      distance,
      fromDirection: camera.position.clone().sub(controls.target).normalize(),
      toDirection: direction,
      fromUp: camera.up.clone(),
      toUp: up,
    };
    controls.enabled = false;
  }

  async function addModel(file) {
    if (!file.name.toLowerCase().endsWith(".glb")) {
      throw new Error(`${file.name}: choose a self-contained .glb file.`);
    }
    if (file.size > 70 * 1024 * 1024) {
      throw new Error(`${file.name}: the file is larger than the 70 MB limit.`);
    }

    const data = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(data, "", resolve, reject);
    });
    const model = gltf.scene;
    if (!model) throw new Error(`${file.name}: the GLB file does not contain a scene.`);
    enhanceMetalReflections(model);
    const modelBounds = new THREE.Box3().setFromObject(model);
    if (modelBounds.isEmpty()) {
      throw new Error(`${file.name}: the GLB file does not contain visible geometry.`);
    }

    const center = modelBounds.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    const modelContent = new THREE.Group();
    modelContent.position.copy(center).negate();
    modelContent.add(model);
    root.position.copy(center);
    root.name = file.name;
    root.add(modelContent);
    scene.add(root);
    const item = { id: nextModelId++, name: file.name, root, visible: true };
    models.push(item);
    updateSceneControls();
    fitModel(models.length > 1);
    return item;
  }

  async function loadFiles(files) {
    const selectedFiles = [...files];
    if (!selectedFiles.length) return;
    cancelViewTransition();
    clearError();
    let loaded = 0;
    const failures = [];
    const addedModels = [];
    for (const file of selectedFiles) {
      modelStatus.textContent = `Loading ${file.name}…`;
      try {
        addedModels.push(await addModel(file));
        loaded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        console.error(`Could not load ${file.name}`, error);
      }
    }

    if (failures.length) {
      setError(failures.join(" "));
      modelStatus.textContent = `${loaded} loaded; ${failures.length} could not be loaded.`;
    } else {
      modelStatus.textContent = `${loaded} ${loaded === 1 ? "model" : "models"} added.`;
    }
    return addedModels;
  }

  function removeModel(id) {
    const index = models.findIndex((item) => item.id === id);
    if (index === -1) return;
    const [item] = models.splice(index, 1);
    scene.remove(item.root);
    disposeModel(item.root);
    updateSceneControls();
    if (models.some((model) => model.visible)) {
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
    }
    modelStatus.textContent = `${item.name} removed.`;
  }

  async function loadModelFromUrl(modelPath) {
    if (window.location.protocol === "file:") {
      setError("Project models can only be loaded when the site is opened from a web server.");
      return;
    }
    try {
      const modelUrl = new URL(modelPath, window.location.href);
      if (
        modelUrl.origin !== window.location.origin ||
        !/(?:^|\/)assets\/.+\.glb$/i.test(modelUrl.pathname)
      ) {
        throw new Error("Only same-site GLB files under an assets folder can be opened.");
      }
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
      const blob = await response.blob();
      if (blob.size > 70 * 1024 * 1024) throw new Error("This GLB is larger than the 70 MB file limit.");
      const fileName = decodeURIComponent(modelUrl.pathname.split("/").pop());
      await loadFiles([new File([blob], fileName, { type: "model/gltf-binary" })]);
    } catch (error) {
      setError(`Could not open the project model: ${error.message}`, error);
    }
  }

  async function fetchModelFile(modelPath) {
    if (window.location.protocol === "file:") {
      throw new Error("Project models can only be loaded when the site is opened from a web server.");
    }
    const modelUrl = new URL(modelPath, window.location.href);
    if (
      modelUrl.origin !== window.location.origin ||
      !/(?:^|\/)assets\/.+\.glb$/i.test(modelUrl.pathname)
    ) {
      throw new Error("Only same-site GLB files under an assets folder can be opened.");
    }
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
    const blob = await response.blob();
    if (blob.size > 70 * 1024 * 1024) throw new Error("This GLB is larger than the 70 MB file limit.");
    const fileName = decodeURIComponent(modelUrl.pathname.split("/").pop());
    return new File([blob], fileName, { type: "model/gltf-binary" });
  }

  async function loadFaceVariantsForProject(projectId) {
    try {
      const response = await fetch("project-data.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Project list request failed (${response.status}).`);
      const projects = await response.json();
      if (!Array.isArray(projects)) throw new Error("The project list has an invalid format.");
      const project = projects.find((item) => item && item.id === projectId);
      if (!project?.faceVariants) throw new Error("This project does not define face visibility model variants.");
      const { faceVisible, faceHidden } = project.faceVariants;
      if (typeof faceVisible !== "string" || typeof faceHidden !== "string") {
        throw new Error("The project is missing its face-visible or face-hidden GLB model.");
      }

      modelStatus.textContent = "Loading face visibility model variants…";
      const files = await Promise.all([fetchModelFile(faceVisible), fetchModelFile(faceHidden)]);
      const addedModels = await loadFiles(files);
      if (addedModels.length !== 2) {
        throw new Error("Both face visibility model variants must load successfully.");
      }
      conditionalProjectTitle = project.title;
      faceVariantIds = {
        faceVisible: addedModels[0].id,
        faceHidden: addedModels[1].id,
      };
      updateFaceVisibility();
      updateSceneControls();
      fitModel();
      modelStatus.textContent = `${project.title} models loaded. Toggle Show face to switch models.`;
    } catch (error) {
      setError(`Could not load the project models: ${error.message}`, error);
    }
  }

  async function loadFaceModel() {
    try {
      const response = await fetch("assets/face/face%201.glb");
      if (!response.ok) throw new Error(`Face model request failed (${response.status}).`);
      const data = await response.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => {
        loader.parse(data, "", resolve, reject);
      });
      faceModel = gltf.scene;
      if (!faceModel) throw new Error("The face GLB does not contain a scene.");
      faceModel.position.set(0, 0, 0);
      faceModel.visible = false;
      scene.add(faceModel);
      updateFacePositionControls();
      showFaceInput.disabled = false;
      updateFaceVisibility();
      if (models.some((item) => item.visible) && showFaceInput.checked) fitModel(true);
    } catch (error) {
      showFaceInput.checked = false;
      showFaceInput.disabled = true;
      setError(`Could not load the face model: ${error.message}`, error);
    }
  }

  function resizeRenderer() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (models.some((item) => item.visible)) fitModel(true);
  }

  function animate() {
    animationFrame = window.requestAnimationFrame(animate);
    if (viewTransition) {
      const progress = Math.min((performance.now() - viewTransition.startedAt) / viewTransition.duration, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        viewTransition.fromDirection,
        viewTransition.toDirection
      );
      rotation.slerp(new THREE.Quaternion(), 1 - easedProgress);
      const direction = viewTransition.fromDirection.clone().applyQuaternion(rotation);
      camera.position.copy(controls.target).addScaledVector(direction, viewTransition.distance);
      camera.up.lerpVectors(viewTransition.fromUp, viewTransition.toUp, easedProgress).normalize();
      camera.lookAt(controls.target);
      if (progress === 1) {
        viewTransition = null;
        controls.enabled = true;
        controls.enableDamping = true;
        controls.saveState();
      }
    }
    controls.autoRotate = !viewTransition && autoRotateInput.checked &&
      models.some((item) => item.visible);
    controls.update();
    renderer.render(scene, camera);
  }

  chooseModelsButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    loadFiles(fileInput.files);
    fileInput.value = "";
  });
  clearModelsButton.addEventListener("click", () => {
    models.splice(0).forEach((item) => {
      scene.remove(item.root);
      disposeModel(item.root);
    });
    faceVariantIds = null;
    conditionalProjectTitle = null;
    updateSceneControls();
    modelStatus.textContent = "All models removed.";
    clearError();
  });
  showFaceInput.addEventListener("change", () => {
    updateFaceVisibility();
    if (faceVariantIds) {
      updateSceneControls();
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
      modelStatus.textContent = showFaceInput.checked
        ? "Face shown; face-visible model active."
        : "Face hidden; alternate model active.";
      return;
    }
    if (models.some((item) => item.visible)) {
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
    }
  });
  function setModelRotation(id, axis, input, formatNumber = false) {
    const item = models.find((model) => model.id === id);
    if (!item || input.value === "") return;
    const slider = objectList.querySelector(
      `[data-rotation-model-id="${id}"][data-rotation-axis="${axis}"]`
    );
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const degrees = Math.round(THREE.MathUtils.clamp(value, Number(slider.min), Number(slider.max)));
    item.root.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    slider.value = String(degrees);
    const numberInput = objectList.querySelector(
      `[data-rotation-model-id="${id}"][data-rotation-axis-value="${axis}"]`
    );
    if (input !== numberInput || formatNumber) numberInput.value = String(degrees);
    if (item.visible) {
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
    }
  }

  objectList.addEventListener("input", (event) => {
    const slider = event.target.closest("[data-rotation-axis]");
    if (slider) {
      setModelRotation(
        Number(slider.dataset.rotationModelId),
        slider.dataset.rotationAxis,
        slider
      );
      return;
    }
    const number = event.target.closest("[data-rotation-axis-value]");
    if (number) {
      setModelRotation(
        Number(number.dataset.rotationModelId),
        number.dataset.rotationAxisValue,
        number
      );
    }
  });
  objectList.addEventListener("change", (event) => {
    const number = event.target.closest("[data-rotation-axis-value]");
    if (number) {
      setModelRotation(
        Number(number.dataset.rotationModelId),
        number.dataset.rotationAxisValue,
        number,
        true
      );
    }
  });
  function setFacePosition(axis, input, formatNumber = false) {
    if (!faceModel || input.value === "") return;
    const slider = document.querySelector(`[data-face-axis="${axis}"]`);
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const position = THREE.MathUtils.clamp(value, Number(slider.min), Number(slider.max));
    faceModel.position[axis] = position;
    slider.value = String(position);
    const numberInput = document.querySelector(`[data-face-value="${axis}"]`);
    if (input !== numberInput || formatNumber) numberInput.value = position.toFixed(3);
    if (models.some((item) => item.visible) && showFaceInput.checked) {
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
    }
  }

  facePositionInputs.forEach((input) => {
    input.addEventListener("input", () => {
      setFacePosition(input.dataset.faceAxis, input);
    });
  });
  facePositionNumberInputs.forEach((input) => {
    input.addEventListener("input", () => {
      setFacePosition(input.dataset.faceValue, input);
    });
    input.addEventListener("change", () => {
      setFacePosition(input.dataset.faceValue, input, true);
    });
  });
  objectList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-visibility-id]");
    if (!checkbox) return;
    const item = models.find((model) => model.id === Number(checkbox.dataset.visibilityId));
    if (!item) return;
    if (faceVariantIds && (item.id === faceVariantIds.faceVisible || item.id === faceVariantIds.faceHidden)) {
      updateSceneControls();
      return;
    }
    item.visible = checkbox.checked;
    item.root.visible = checkbox.checked;
    updateFaceVisibility();
    if (models.some((model) => model.visible)) {
      try {
        fitModel(true);
      } catch (error) {
        setError(error.message, error);
      }
    }
  });
  objectList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-id]");
    if (button) removeModel(Number(button.dataset.removeId));
  });
  document.getElementById("fitModel").addEventListener("click", () => {
    try {
      fitModel(true);
      clearError();
    } catch (error) {
      setError(error.message, error);
    }
  });
  document.getElementById("resetView").addEventListener("click", () => {
    if (models.some((item) => item.visible)) setStandardView("front");
    else {
      camera.position.set(0, 0, 5);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setStandardView(button.dataset.view));
  });

  stage.addEventListener("dragenter", (event) => {
    event.preventDefault();
    stage.classList.add("dragging");
  });
  stage.addEventListener("dragover", (event) => event.preventDefault());
  stage.addEventListener("dragleave", (event) => {
    if (!stage.contains(event.relatedTarget)) stage.classList.remove("dragging");
  });
  stage.addEventListener("drop", (event) => {
    event.preventDefault();
    stage.classList.remove("dragging");
    loadFiles(event.dataTransfer.files);
  });

  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(stage);
  resizeRenderer();
  animate();
  loadFaceModel();
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project");
  const modelPath = params.get("model");
  if (projectId) loadFaceVariantsForProject(projectId);
  else if (modelPath) loadModelFromUrl(modelPath);

  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.dispose();
    models.forEach((item) => disposeModel(item.root));
    if (faceModel) disposeModel(faceModel);
    studioEnvironment.dispose();
    renderer.dispose();
  }, { once: true });
})();
