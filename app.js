import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { enhanceMetalReflections, setupStudioEnvironment } from "./three-studio.js";

(() => {
  const stage = document.getElementById("modelStage");
  const canvas = document.getElementById("modelCanvas");
  const fileInput = document.getElementById("modelFile");
  const modelName = document.getElementById("modelName");
  const modelStatus = document.getElementById("modelStatus");
  const emptyPrompt = document.getElementById("emptyPrompt");
  const errorMessage = document.getElementById("modelError");
  const dropOverlay = document.getElementById("dropOverlay");
  const chooseModelButton = document.getElementById("chooseModel");
  const clearModelButton = document.getElementById("clearModel");
  const autoRotateInput = document.getElementById("autoRotate");
  const showFaceInput = document.getElementById("showFace");
  const facePositionControls = document.getElementById("facePositionControls");
  const facePositionInputs = [...document.querySelectorAll("[data-face-axis]")];
  const facePositionNumberInputs = [...document.querySelectorAll("[data-face-value]")];
  const modelRotationControls = document.getElementById("modelRotationControls");
  const modelRotationInputs = [...document.querySelectorAll("[data-model-rotation-axis]")];
  const modelRotationNumberInputs = [...document.querySelectorAll("[data-model-rotation-value]")];
  const loader = new GLTFLoader();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const configuratorParams = new URLSearchParams(window.location.search);
  const projectId = configuratorParams.get("project");
  let projectModelPath = configuratorParams.get("model");
  let projectFaceModelPath = configuratorParams.get("faceModel");
  let renderer;
  let controls;
  let studioEnvironment;
  let activeModel;
  let faceModel;
  let resizeObserver;
  let animationFrame;
  let viewTransition;
  let projectModelSwitchId = 0;

  function setError(message, error) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    modelStatus.textContent = message;
    if (error) console.error(message, error);
  }

  function showLocalModelFallback(modelPath) {
    const modelLocation = modelPath.split("/").map((part) => {
      try {
        return decodeURIComponent(part.replace(/\+/g, " "));
      } catch {
        return part;
      }
    }).join("/");
    errorMessage.replaceChildren(
      document.createTextNode(
        `Your browser blocks automatic loading of bundled models from a file:// page. Select "${modelLocation}" to open it locally, or run the site from a local web server to enable bundled face preview. `
      )
    );
    const chooseFileButton = document.createElement("button");
    chooseFileButton.className = "model-error-action";
    chooseFileButton.type = "button";
    chooseFileButton.textContent = "Choose model file";
    chooseFileButton.addEventListener("click", () => fileInput.click());
    errorMessage.append(chooseFileButton);
    errorMessage.hidden = false;
    modelStatus.textContent = "Choose the bundled model file from your device to load it locally.";
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    controls = new OrbitControls(camera, renderer.domElement);
  } catch (error) {
    setError("A WebGL-capable browser is required to display 3D models.", error);
    chooseModelButton.disabled = true;
    return;
  }

  studioEnvironment = setupStudioEnvironment(renderer, scene);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b887f, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-4, 6, 7);
  scene.add(keyLight);
  keyLight.intensity = 1.2;
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
    if (faceModel) faceModel.visible = showFaceInput.checked && Boolean(activeModel);
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

  function updateModelRotationControls() {
    if (!activeModel) return;
    modelRotationInputs.forEach((input) => {
      const axis = input.dataset.modelRotationAxis;
      const value = THREE.MathUtils.radToDeg(activeModel.rotation[axis]);
      input.value = String(Math.round(value));
      document.querySelector(`[data-model-rotation-value="${axis}"]`).value = input.value;
    });
    modelRotationControls.disabled = false;
  }

  function clearModel() {
    cancelViewTransition();
    if (activeModel) {
      scene.remove(activeModel);
      disposeModel(activeModel);
      activeModel = null;
    }
    updateFaceVisibility();
    modelRotationControls.disabled = true;
    modelName.textContent = "Eyewear preview";
    modelStatus.textContent = "Ready for a self-contained .glb model.";
    emptyPrompt.hidden = false;
    clearModelButton.hidden = true;
    errorMessage.hidden = true;
  }

  function cancelViewTransition() {
    if (!viewTransition) return;
    viewTransition = null;
    controls.enabled = true;
    controls.enableDamping = true;
  }

  function fitModel(preserveDirection = false) {
    if (!activeModel) return;

    const direction = camera.position.clone().sub(controls.target);
    if (preserveDirection && direction.lengthSq() > 0) direction.normalize();
    else direction.set(0.22, 0, 1).normalize();

    activeModel.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(activeModel);
    if (faceModel?.visible) bounds.union(new THREE.Box3().setFromObject(faceModel));
    if (bounds.isEmpty()) throw new Error("The selected model contains no visible geometry.");
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      throw new Error("The selected model has invalid dimensions.");
    }

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

  function captureCameraView() {
    return {
      position: camera.position.clone(),
      target: controls.target.clone(),
      up: camera.up.clone(),
    };
  }

  function restoreCameraView(view) {
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    camera.up.copy(view.up);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function setStandardView(view) {
    if (!activeModel) return;
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

  async function loadModel(file, cameraView = null, switchId = null) {
    if (!file) return;
    cancelViewTransition();
    errorMessage.hidden = true;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setError("Choose a self-contained .glb file. Other formats and external companion files are not supported.");
      return;
    }
    if (file.size > 70 * 1024 * 1024) {
      setError("This GLB is larger than the 70 MB file limit.");
      return;
    }

    modelStatus.textContent = "Loading model…";
    try {
      const data = await file.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => {
        loader.parse(data, "", resolve, reject);
      });
      if (switchId !== null && switchId !== projectModelSwitchId) {
        if (gltf.scene) disposeModel(gltf.scene);
        return;
      }
      const nextModel = gltf.scene;
      if (!nextModel) throw new Error("The GLB file does not contain a scene.");
      enhanceMetalReflections(nextModel);
      const nextBounds = new THREE.Box3().setFromObject(nextModel);
      if (nextBounds.isEmpty()) throw new Error("The GLB file does not contain visible geometry.");

      if (activeModel) {
        scene.remove(activeModel);
        disposeModel(activeModel);
      }
      const modelBounds = new THREE.Box3().setFromObject(nextModel);
      const modelCenter = modelBounds.getCenter(new THREE.Vector3());
      activeModel = new THREE.Group();
      const modelContent = new THREE.Group();
      modelContent.position.copy(modelCenter).negate();
      modelContent.add(nextModel);
      activeModel.position.copy(modelCenter);
      activeModel.add(modelContent);
      scene.add(activeModel);
      updateModelRotationControls();
      updateFaceVisibility();
      emptyPrompt.hidden = true;
      clearModelButton.hidden = false;
      modelName.textContent = "Eyewear preview";
      if (cameraView) {
        restoreCameraView(cameraView);
      } else {
        fitModel();
      }
      modelStatus.textContent = "Model loaded.";
    } catch (error) {
      if (switchId === null || switchId === projectModelSwitchId) {
        setError("Could not load the model: " + error.message, error);
      }
    }
  }

  async function loadModelFromUrl(modelPath, cameraView = null, switchId = null) {
    if (window.location.protocol === "file:") {
      showLocalModelFallback(modelPath);
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

      modelStatus.textContent = "Loading project model…";
      const response = await fetch(modelUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
      const blob = await response.blob();
      if (blob.size > 70 * 1024 * 1024) throw new Error("This GLB is larger than the 70 MB file limit.");
      await loadModel(new File([blob], decodeURIComponent(modelUrl.pathname.split("/").pop()), {
        type: "model/gltf-binary",
      }), cameraView, switchId);
    } catch (error) {
      if (switchId === null || switchId === projectModelSwitchId) {
        setError("Could not open the project model: " + error.message, error);
      }
    }
  }

  async function loadFaceModel(optional = false) {
    if (window.location.protocol === "file:") {
      if (!optional) {
        showFaceInput.checked = false;
        showFaceInput.disabled = true;
      }
      return;
    }

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
    } catch (error) {
      if (optional) {
        console.warn("Could not load the optional face overlay", error);
      } else {
        showFaceInput.checked = false;
        showFaceInput.disabled = true;
        setError("Could not load the face model: " + error.message, error);
      }
    }
  }

  function resizeRenderer() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (activeModel) fitModel(true);
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
    controls.autoRotate = !viewTransition && autoRotateInput.checked && Boolean(activeModel);
    controls.update();
    renderer.render(scene, camera);
  }

  function handleFiles(files) {
    const file = [...files].find((candidate) => candidate.name.toLowerCase().endsWith(".glb"));
    if (!file) {
      setError("Drop a self-contained .glb model to open it.");
      return;
    }
    loadModel(file);
  }

  chooseModelButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    loadModel(fileInput.files[0]);
    fileInput.value = "";
  });
  clearModelButton.addEventListener("click", clearModel);
  showFaceInput.addEventListener("change", () => {
    if (projectModelPath && projectFaceModelPath) {
      const cameraView = captureCameraView();
      const switchId = ++projectModelSwitchId;
      updateFaceVisibility();
      loadModelFromUrl(showFaceInput.checked ? projectFaceModelPath : projectModelPath, cameraView, switchId);
      return;
    }
    updateFaceVisibility();
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
  }

  function setModelRotation(axis, input, formatNumber = false) {
    if (!activeModel || input.value === "") return;
    const slider = document.querySelector(`[data-model-rotation-axis="${axis}"]`);
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const degrees = Math.round(THREE.MathUtils.clamp(value, Number(slider.min), Number(slider.max)));
    activeModel.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    slider.value = String(degrees);
    const numberInput = document.querySelector(`[data-model-rotation-value="${axis}"]`);
    if (input !== numberInput || formatNumber) numberInput.value = String(degrees);
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
  modelRotationInputs.forEach((input) => {
    input.addEventListener("input", () => {
      setModelRotation(input.dataset.modelRotationAxis, input);
    });
  });
  modelRotationNumberInputs.forEach((input) => {
    input.addEventListener("input", () => {
      setModelRotation(input.dataset.modelRotationValue, input);
    });
    input.addEventListener("change", () => {
      setModelRotation(input.dataset.modelRotationValue, input, true);
    });
  });
  document.getElementById("fitModel").addEventListener("click", () => {
    try {
      fitModel(true);
    } catch (error) {
      setError(error.message, error);
    }
  });
  document.getElementById("resetView").addEventListener("click", () => {
    if (activeModel) setStandardView("front");
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
    handleFiles(event.dataTransfer.files);
  });

  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(stage);
  resizeRenderer();
  animate();
  async function initializeProjectModels() {
    if (projectId) {
      try {
        const response = await fetch("project-data.json", { cache: "no-store" });
        if (!response.ok) throw new Error("Project data request failed (" + response.status + ").");
        const projects = await response.json();
        if (!Array.isArray(projects)) throw new Error("The project list has an invalid format.");
        const project = projects.find((item) => item && item.id === projectId);
        if (project) {
          projectModelPath = typeof project.model === "string" ? project.model : null;
          projectFaceModelPath = typeof project.faceModel === "string" ? project.faceModel : null;
        }
      } catch (error) {
        console.warn("Could not refresh the project model paths", error);
      }
    }

    if (projectModelPath && projectFaceModelPath) {
      showFaceInput.checked = false;
      showFaceInput.disabled = false;
      loadModelFromUrl(projectModelPath);
      loadFaceModel(true);
    } else if (projectModelPath) {
      showFaceInput.checked = false;
      showFaceInput.disabled = false;
      loadModelFromUrl(projectModelPath);
      loadFaceModel();
    } else {
      loadFaceModel();
    }
  }

  initializeProjectModels();

  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.dispose();
    if (activeModel) disposeModel(activeModel);
    if (faceModel) disposeModel(faceModel);
    studioEnvironment.dispose();
    renderer.dispose();
  }, { once: true });
})();
