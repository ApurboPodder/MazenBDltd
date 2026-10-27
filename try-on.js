import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { enhanceMetalReflections, setupStudioEnvironment } from "./three-studio.js";
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const params = new URLSearchParams(window.location.search);
const modelPath = params.get("model");
const title = params.get("title");
const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("tryOnCanvas");
const preview = document.getElementById("preview");
const placeholder = document.getElementById("placeholder");
const status = document.getElementById("tryOnStatus");
const startButton = document.getElementById("startCamera");
const stopButton = document.getElementById("stopCamera");
const flipButton = document.getElementById("flipCamera");
const scaleInput = document.getElementById("frameScale");
const scaleOutput = document.getElementById("frameScaleValue");
const horizontalOffsetInput = document.getElementById("frameHorizontalOffset");
const horizontalOffsetOutput = document.getElementById("frameHorizontalOffsetValue");
const offsetInput = document.getElementById("frameOffset");
const offsetOutput = document.getElementById("frameOffsetValue");
const depthOffsetInput = document.getElementById("frameDepthOffset");
const depthOffsetOutput = document.getElementById("frameDepthOffsetValue");
const modelUploadInput = document.getElementById("modelUpload");
const modelUploadName = document.getElementById("modelUploadName");
const backLink = document.getElementById("backToProject");
const heading = document.getElementById("tryOnTitle");
const FACE_DETECTION_INTERVAL = 50;
const POSE_SMOOTHING_SECONDS = 0.09;

let faceLandmarker;
let cameraStream;
let animationFrame;
let lastDetectionTime = 0;
let facingMode = "user";
let loadedModel;
let modelLoadId = 0;
let modelWidth = 1;
let lastFaceTime = 0;
let faceOccluder;
let faceOccluderPositions;
let targetGlassesPosition = new THREE.Vector3();
let targetGlassesRotation = new THREE.Quaternion();
let targetGlassesScale = 1;
let hasGlassesPose = false;
let lastRenderTime = 0;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
camera.position.z = 1000;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const studioEnvironment = setupStudioEnvironment(renderer, scene);
scene.add(new THREE.HemisphereLight(0xffffff, 0x55515a, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(-1, 2, 5);
scene.add(keyLight);
const glassesGroup = new THREE.Group();
glassesGroup.visible = false;
scene.add(glassesGroup);

function setStatus(message) {
  status.textContent = message;
}

function resizePreview() {
  const bounds = preview.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  renderer.setSize(width, height, false);
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
}

function createFaceOccluder() {
  if (faceOccluder) return;
  const adjacency = Array.from({ length: 478 }, () => new Set());
  FaceLandmarker.FACE_LANDMARKS_TESSELATION.forEach(({ start, end }) => {
    adjacency[start].add(end);
    adjacency[end].add(start);
  });

  const triangles = [];
  for (let first = 0; first < adjacency.length; first += 1) {
    const neighbors = [...adjacency[first]].filter((index) => index > first);
    for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex += 1) {
      const second = neighbors[neighborIndex];
      for (let thirdIndex = neighborIndex + 1; thirdIndex < neighbors.length; thirdIndex += 1) {
        const third = neighbors[thirdIndex];
        if (adjacency[second].has(third)) triangles.push(first, second, third);
      }
    }
  }
  if (!triangles.length) {
    throw new Error("Face mesh connections are unavailable for model occlusion.");
  }

  const geometry = new THREE.BufferGeometry();
  faceOccluderPositions = new Float32Array(adjacency.length * 3);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(faceOccluderPositions, 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setIndex(triangles);
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  faceOccluder = new THREE.Mesh(geometry, material);
  faceOccluder.frustumCulled = false;
  faceOccluder.renderOrder = -1;
  faceOccluder.visible = false;
  scene.add(faceOccluder);
}

function disposeModel(model) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}

function loadModel(source = modelPath, isLocalFile = false) {
  const loadId = ++modelLoadId;
  if (!source) {
    setStatus("No eyewear model was selected.");
    return;
  }
  const modelUrl = isLocalFile ? source : new URL(source, window.location.href).href;
  setStatus("Loading eyewear model…");
  startButton.disabled = true;
  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      if (isLocalFile) URL.revokeObjectURL(modelUrl);
      if (loadId !== modelLoadId) {
        disposeModel(gltf.scene);
        return;
      }
      const model = gltf.scene;
      enhanceMetalReflections(model);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.x) || size.x <= 0) {
        disposeModel(model);
        setStatus("This model has no usable width and cannot be fitted for camera try-on.");
        startButton.disabled = !loadedModel;
        return;
      }
      if (loadedModel) {
        glassesGroup.remove(loadedModel);
        disposeModel(loadedModel);
      }
      loadedModel = model;
      modelWidth = size.x;
      let frontFrameDepth = -Infinity;
      loadedModel.traverse((node) => {
        if (!node.isMesh) return;
        const meshBounds = new THREE.Box3().setFromObject(node);
        const meshSize = meshBounds.getSize(new THREE.Vector3());
        const spansFrameFront = meshSize.x >= size.x * 0.5 &&
          meshSize.y >= size.y * 0.25 &&
          meshSize.z <= size.x * 0.2;
        if (spansFrameFront) frontFrameDepth = Math.max(frontFrameDepth, meshBounds.max.z);
      });
      if (!Number.isFinite(frontFrameDepth)) frontFrameDepth = bounds.max.z;
      model.position.x -= center.x;
      model.position.y -= center.y;
      model.position.z -= frontFrameDepth;
      glassesGroup.add(loadedModel);
      glassesGroup.visible = false;
      hasGlassesPose = false;
      startButton.disabled = false;
      setStatus("Ready. Start the camera to begin.");
      renderer.render(scene, camera);
    },
    undefined,
    (error) => {
      if (isLocalFile) URL.revokeObjectURL(modelUrl);
      if (loadId !== modelLoadId) return;
      setStatus("Could not load this model. Choose a valid GLB eyewear model and try again.");
      startButton.disabled = !loadedModel;
      console.error("Could not load the try-on model", error);
    }
  );
}

async function initializeFaceTracking() {
  if (faceLandmarker) return faceLandmarker;
  setStatus("Loading face tracking…");
  createFaceOccluder();
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  let gpuError;
  try {
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  } catch (error) {
    gpuError = error;
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    }).catch((cpuError) => {
      throw new Error(`Face tracking could not start on this device: ${cpuError.message || gpuError.message}`);
    });
  }
  return faceLandmarker;
}

function pointOnPreview(landmark) {
  const width = preview.clientWidth;
  const height = preview.clientHeight;
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const scale = getPreviewScale();
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const cropX = (renderedWidth - width) / 2;
  const cropY = (renderedHeight - height) / 2;
  const sourceX = landmark.x * videoWidth;
  return {
    x: sourceX * scale - cropX,
    y: landmark.y * videoHeight * scale - cropY,
  };
}

function getPreviewScale() {
  return Math.max(
    preview.clientWidth / video.videoWidth,
    preview.clientHeight / video.videoHeight
  );
}

function pointInCameraSpace(landmark) {
  return new THREE.Vector3(
    landmark.x * video.videoWidth,
    -landmark.y * video.videoHeight,
    -landmark.z * video.videoWidth
  );
}

function positionGlasses(landmarks) {
  const outerLeft = pointOnPreview(landmarks[33]);
  const outerRight = pointOnPreview(landmarks[263]);
  const eyeDistance = Math.hypot(outerRight.x - outerLeft.x, outerRight.y - outerLeft.y);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 16) return false;
  if (landmarks.length !== faceOccluderPositions.length / 3) return false;
  const width = preview.clientWidth;
  const height = preview.clientHeight;
  const centerX = (outerLeft.x + outerRight.x) / 2;
  const centerY = (outerLeft.y + outerRight.y) / 2;
  const previewScale = getPreviewScale();
  const depthScale = video.videoWidth * previewScale;
  const horizontalDirection = facingMode === "user" ? -1 : 1;
  for (let index = 0; index < landmarks.length; index += 1) {
    const landmark = landmarks[index];
    if (![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) return false;
    const point = pointOnPreview(landmarks[index]);
    faceOccluderPositions[index * 3] = point.x - width / 2;
    faceOccluderPositions[index * 3 + 1] = height / 2 - point.y;
    faceOccluderPositions[index * 3 + 2] = -landmark.z * depthScale;
  }
  faceOccluder.geometry.attributes.position.needsUpdate = true;
  faceOccluder.visible = true;
  const horizontalAxis = pointInCameraSpace(landmarks[263])
    .sub(pointInCameraSpace(landmarks[33]));
  const faceUp = pointInCameraSpace(landmarks[10])
    .sub(pointInCameraSpace(landmarks[152]));
  if (
    !Number.isFinite(horizontalAxis.lengthSq()) ||
    !Number.isFinite(faceUp.lengthSq()) ||
    horizontalAxis.lengthSq() < 1 ||
    faceUp.lengthSq() < 1
  ) {
    return false;
  }
  horizontalAxis.normalize();
  faceUp.normalize();
  const verticalAxis = faceUp
    .addScaledVector(horizontalAxis, -faceUp.dot(horizontalAxis));
  if (!Number.isFinite(verticalAxis.lengthSq()) || verticalAxis.lengthSq() < 0.01) return false;
  verticalAxis.normalize();
  const faceNormal = horizontalAxis.clone().cross(verticalAxis).normalize();
  if (!Number.isFinite(faceNormal.lengthSq()) || faceNormal.lengthSq() < 0.5) {
    return false;
  }
  const faceRotation = new THREE.Matrix4().makeBasis(horizontalAxis, verticalAxis, faceNormal);
  const horizontalProjection = Math.hypot(horizontalAxis.x, horizontalAxis.y);
  if (horizontalProjection < 0.1) return false;
  const desiredWidth = eyeDistance * Number(scaleInput.value);
  targetGlassesPosition.set(
    centerX + horizontalDirection * Number(horizontalOffsetInput.value) * eyeDistance - width / 2,
    height / 2 - centerY + Number(offsetInput.value) * eyeDistance,
    ((-landmarks[33].z - landmarks[263].z) / 2) * depthScale +
      eyeDistance * (0.2 + Number(depthOffsetInput.value))
  );
  targetGlassesRotation.setFromRotationMatrix(faceRotation);
  targetGlassesScale = desiredWidth / (modelWidth * horizontalProjection);
  if (!hasGlassesPose) {
    glassesGroup.position.copy(targetGlassesPosition);
    glassesGroup.quaternion.copy(targetGlassesRotation);
    glassesGroup.scale.setScalar(targetGlassesScale);
    hasGlassesPose = true;
  }
  glassesGroup.visible = true;
  lastFaceTime = performance.now();
  return true;
}

function smoothGlassesPose(deltaSeconds) {
  if (!hasGlassesPose) return;
  const amount = 1 - Math.exp(-deltaSeconds / POSE_SMOOTHING_SECONDS);
  glassesGroup.position.lerp(targetGlassesPosition, amount);
  glassesGroup.quaternion.slerp(targetGlassesRotation, amount);
  const scale = THREE.MathUtils.lerp(glassesGroup.scale.x, targetGlassesScale, amount);
  glassesGroup.scale.setScalar(scale);
}

function renderFrame(now) {
  animationFrame = requestAnimationFrame(renderFrame);
  const deltaSeconds = lastRenderTime
    ? Math.min((now - lastRenderTime) / 1000, 0.1)
    : 0;
  lastRenderTime = now;
  if (!faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    renderer.render(scene, camera);
    return;
  }
  if (now - lastDetectionTime >= FACE_DETECTION_INTERVAL) {
    lastDetectionTime = now;
    try {
      const result = faceLandmarker.detectForVideo(video, now);
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks || !positionGlasses(landmarks)) {
        glassesGroup.visible = false;
        hasGlassesPose = false;
        if (faceOccluder) faceOccluder.visible = false;
        setStatus("Center your face in the preview");
      } else {
        setStatus("Face detected · adjust frame fit if needed");
      }
    } catch (error) {
      glassesGroup.visible = false;
      if (faceOccluder) faceOccluder.visible = false;
      setStatus("Face tracking paused. Restart the camera to try again.");
      console.error("Face tracking failed", error);
      stopCamera();
    }
  }
  if (glassesGroup.visible && performance.now() - lastFaceTime > 400) {
    glassesGroup.visible = false;
    hasGlassesPose = false;
    if (faceOccluder) faceOccluder.visible = false;
    setStatus("Center your face in the preview");
  }
  smoothGlassesPose(deltaSeconds);
  renderer.render(scene, camera);
}

async function startCamera() {
  if (cameraStream) return;
  startButton.disabled = true;
  flipButton.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable. Use HTTPS or open the site on localhost.");
    }
    await initializeFaceTracking();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    video.srcObject = cameraStream;
    await video.play();
    preview.classList.add("is-active");
    preview.classList.toggle("is-mirrored", facingMode === "user");
    placeholder.hidden = true;
    stopButton.disabled = false;
    flipButton.hidden = false;
    flipButton.disabled = false;
    resizePreview();
    lastRenderTime = 0;
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(renderFrame);
    setStatus("Center your face in the preview");
  } catch (error) {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    stopButton.disabled = true;
    flipButton.disabled = false;
    const message = error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser settings."
      : error.name === "NotFoundError"
        ? "No camera was found on this device."
        : error.message || "Could not start the camera.";
    setStatus(message);
    console.error("Could not start camera try-on", error);
  } finally {
    startButton.disabled = !loadedModel;
  }
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  preview.classList.remove("is-active");
  preview.classList.remove("is-mirrored");
  placeholder.hidden = false;
  glassesGroup.visible = false;
  hasGlassesPose = false;
  if (faceOccluder) faceOccluder.visible = false;
  stopButton.disabled = true;
  flipButton.hidden = true;
  cancelAnimationFrame(animationFrame);
  renderer.render(scene, camera);
  setStatus(loadedModel ? "Camera stopped." : "Preparing try-on…");
  startButton.disabled = !loadedModel;
}

scaleInput.addEventListener("input", () => {
  scaleOutput.value = `${Number(scaleInput.value).toFixed(2)}×`;
  scaleOutput.textContent = scaleOutput.value;
});
horizontalOffsetInput.addEventListener("input", () => {
  horizontalOffsetOutput.value = Number(horizontalOffsetInput.value).toFixed(2);
  horizontalOffsetOutput.textContent = horizontalOffsetOutput.value;
});
offsetInput.addEventListener("input", () => {
  offsetOutput.value = Number(offsetInput.value).toFixed(2);
  offsetOutput.textContent = offsetOutput.value;
});
depthOffsetInput.addEventListener("input", () => {
  depthOffsetOutput.value = Number(depthOffsetInput.value).toFixed(2);
  depthOffsetOutput.textContent = depthOffsetOutput.value;
});
modelUploadInput.addEventListener("change", () => {
  const file = modelUploadInput.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".glb")) {
    modelUploadName.textContent = "Please choose a .glb file";
    setStatus("Unsupported model format. Choose a GLB (.glb) file.");
    modelUploadInput.value = "";
    return;
  }
  modelUploadName.textContent = file.name;
  modelUploadInput.value = "";
  loadModel(URL.createObjectURL(file), true);
});
startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
flipButton.addEventListener("click", async () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  stopCamera();
  await startCamera();
});
window.addEventListener("resize", resizePreview);
window.addEventListener("pagehide", () => {
  stopCamera();
  studioEnvironment.dispose();
}, { once: true });

if (title) heading.innerHTML = `${title.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
}[character]))} <span>try-on.</span>`;
if (params.get("project")) {
  const projectUrl = new URL("project.html", window.location.href);
  projectUrl.searchParams.set("project", params.get("project"));
  backLink.href = projectUrl.href;
}
resizePreview();
if (modelPath) loadModel();
else setStatus("Choose a GLB eyewear model or open a project model to begin.");
