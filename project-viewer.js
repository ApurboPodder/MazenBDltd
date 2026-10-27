import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { boostModelColor, enhanceMetalReflections, setupStudioEnvironment } from "./three-studio.js";

export async function initProjectModelViewer(canvas, status, modelPath) {
  let renderer;
  let controls;
  let resizeObserver;
  let animationFrame;
  let studioEnvironment;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
  } catch (error) {
    status.textContent = "3D preview is unavailable in this browser.";
    console.error("Could not create the project model preview renderer", error);
    return;
  }

  const scene = new THREE.Scene();
  studioEnvironment = setupStudioEnvironment(renderer, scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7069, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-3, 5, 6);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xd9e4ed, 1);
  fillLight.position.set(4, 1, -3);
  scene.add(fillLight);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
  camera.position.set(0, 0, 3);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1;

  try {
    const modelUrl = new URL(modelPath, window.location.href);
    modelUrl.searchParams.set("_glbRefresh", String(Date.now()));
    const gltf = await new GLTFLoader().loadAsync(modelUrl.href);
    const model = gltf.scene;
    enhanceMetalReflections(model);
    boostModelColor(model, 0);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error("The GLB contains no visible model geometry.");

    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    model.position.sub(center);
    scene.add(model);
    controls.target.set(0, 0, 0);
    const fitDistance = (sphere.radius * 1.35) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = fitDistance / 2;
    camera.position.set(distance * 0.35, distance * 0.2, distance);
    camera.near = Math.max(sphere.radius / 1000, 0.001);
    camera.far = distance + sphere.radius * 5;
    camera.updateProjectionMatrix();
    controls.update();
    status.textContent = "";
  } catch (error) {
    status.textContent = "The 3D model preview could not be loaded.";
    console.error("Could not load the project GLB preview", error);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }

  function render() {
    animationFrame = window.requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  }

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  render();
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.dispose();
    studioEnvironment.dispose();
    renderer.dispose();
  }, { once: true });
}
