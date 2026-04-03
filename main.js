import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js";

// Блок 1: Включаем современный цветовой менеджмент Three.js для более реалистичной передачи оттенков.
THREE.ColorManagement.enabled = true;

// Блок 2: DOM-элементы SPA-навигации.
const navButtons = document.querySelectorAll(".nav-btn");
const quickNavButtons = document.querySelectorAll("[data-target-page]");
const sitePages = document.querySelectorAll(".site-page");
const homePage = document.getElementById("page-home");
const revealElements = document.querySelectorAll("#page-home .reveal");

// Блок 3: DOM-элементы 3D-конфигуратора.
const canvasContainer = document.getElementById("canvas-container");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.querySelector("[data-loading-text]");

const modelButtons = document.querySelectorAll(".model-btn");
const viewButtons = document.querySelectorAll(".view-btn");
const partButtons = document.querySelectorAll(".part-btn");
const rotateStartButton = document.getElementById("btn-rotate-start");
const rotateStopButton = document.getElementById("btn-rotate-stop");

const colorWheelContainer = document.getElementById("color-wheel");
const colorValueLabel = document.getElementById("color-value");

// Блок 4: Константы путей моделей.
const MODEL_PATHS = {
  long: "models/rashguard.glb",      // приоритет: основной файл продукта
  short: "models/rashguard_short.glb"
};
const MODEL_FALLBACK_PATHS = {
  long: "models/rashguard_long.glb", // запасной путь, если rashguard.glb не найден
  short: null
};
const MANNEQUIN_PATH = "models/human.glb";

// Блок 5: Базовые состояния приложения.
let isConfigPageActive = false;
let currentModelType = "long";
let currentViewMode = "gear";
let currentPart = "torso";
let autoRotateEnabled = false;

// Блок 6: Хранилище выбранных цветов по зонам.
// Такой подход позволяет независимо красить торс/рукава/воротник и сохранять выбор при переключении зон.
const partColorState = {
  torso: "#FF4500",
  sleeves: "#FF4500"
};

// Блок 7: Core-объекты Three.js.
let scene;
let camera;
let renderer;
let controls;
let gearRoot = null;
let mannequinRoot = null;
let mannequinLoadPromise = null;
let colorPicker = null;
let gearLoadToken = 0;

// Блок 8: Лоадеры.
const gltfLoader = new GLTFLoader();

// Блок 9: Коллекции материалов по логическим частям изделия.
// Здесь храним ссылки на материалы, чтобы красить только выбранную часть без тяжелых проходов каждый кадр.
const partMaterials = {
  torso: new Set(),
  sleeves: new Set()
};
const allMaterials = new Set();

// Блок 10: Параметры камеры по умолчанию.
const cameraDefaults = {
  position: new THREE.Vector3(2.0, 1.5, 2.8),
  target: new THREE.Vector3(0, 1.0, 0)
};

// Блок 11: Вспомогательные функции UI-статуса загрузки.
function showLoading(text) {
  if (loadingText && text) {
    loadingText.textContent = text;
  }
  loadingOverlay?.classList.add("active");
}

function hideLoading() {
  loadingOverlay?.classList.remove("active");
}

// Блок 12: Логика SPA-табов (без длинного скролла между разделами).
function activatePage(targetId) {
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });

  sitePages.forEach((page) => {
    page.classList.toggle("active", page.id === targetId);
  });

  isConfigPageActive = targetId === "page-config";

  // При входе в конструктор обязательно пересчитываем размер canvas,
  // иначе после hidden/display-переключений Three.js может рендерить со старым размером.
  if (isConfigPageActive) {
    requestAnimationFrame(() => {
      updateRendererSize();
      updateColorWheelSize();
      controls?.update();
      renderer?.render(scene, camera);
    });
  }
}

function setupNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      if (!targetId) return;
      activatePage(targetId);
    });
  });

  quickNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.targetPage;
      if (!targetId) return;
      activatePage(targetId);
    });
  });
}

// Блок 12.1: Observer для reveal-анимаций внутри скролл-контейнера HOME.
function setupHomeRevealObserver() {
  if (!revealElements.length) return;

  // Fallback для старых браузеров: просто показать все блоки без анимации.
  if (!("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("active"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, io) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("active");
        io.unobserve(entry.target);
      });
    },
    {
      root: homePage || null,
      threshold: 0.18,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  revealElements.forEach((element) => observer.observe(element));
}

// Блок 13: Инициализация сцены, рендера, камеры и controls.
function initThreeScene() {
  if (!canvasContainer) {
    console.error("RST61: контейнер #canvas-container не найден.");
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f2f7);

  const { width, height } = getContainerSize();
  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
  camera.position.copy(cameraDefaults.position);

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  canvasContainer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.minPolarAngle = Math.PI * 0.05;
  controls.maxPolarAngle = Math.PI * 0.82;
  controls.minDistance = 2;
  controls.maxDistance = 5;
  controls.target.copy(cameraDefaults.target);

  // Явно задаем поведение мыши:
  // ЛКМ — вращение, ПКМ — панорамирование, СКМ — зум.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  // Поддержка touch-жестов для мобильных браузеров.
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };

  setupStudioLighting();
  createStudioFloor();
  setupEnvironmentMap();
  console.log("Студийное окружение инициализировано");
}

// Блок 15: Apple-store студийное освещение — равномерное, мягкое, без резких теней.
function setupStudioLighting() {
  // HemisphereLight: верх чисто-белый, низ очень светлый серый.
  // Заполняет сцену ненаправленным рассеянным светом, имитируя диффузное отражение
  // от белых стен студии. Нет резких теней — только мягкий объём.
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe5e5e5, 0.8);
  scene.add(hemiLight);

  // Key Light: DirectionalLight высоко и немного сбоку — мягкое "солнце" над студией.
  // shadow.radius = 6: PCFSoftShadowMap использует этот радиус для размытия карты теней.
  // Результат — тень темнее и чётче у основания модели, плавно рассеивается к краям
  // (эффект контактной тени без дополнительных библиотек).
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(2.5, 5.5, 3.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.radius = 6;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.left = -3;
  keyLight.shadow.camera.right = 3;
  keyLight.shadow.camera.top = 4.5;
  keyLight.shadow.camera.bottom = -0.5;
  keyLight.shadow.bias = -0.0003;
  scene.add(keyLight);

  // Fill Light: DirectionalLight слева-спереди, без теней.
  // Заменяет PointLight — нет затухания по расстоянию, свет равномерный как в лайтбоксе.
  const fillLight = new THREE.DirectionalLight(0xeef2ff, 1.0);
  fillLight.position.set(-3.5, 3.0, 2.0);
  fillLight.castShadow = false;
  scene.add(fillLight);

  // Back Light: тихий контровой свет сзади-сверху — обозначает силуэт модели
  // без пересвета на молочном фоне.
  const backLight = new THREE.DirectionalLight(0xffffff, 0.45);
  backLight.position.set(-0.5, 4.0, -4.5);
  backLight.castShadow = false;
  scene.add(backLight);
}

// Блок 16: Невидимый студийный пол — принимает тени, сливается с фоном #F2F2F7.
// Градиентная сфера удалена: однородный scene.background даёт чистый Apple-store вид.
function createStudioFloor() {
  // ShadowMaterial полностью прозрачен везде, кроме областей тени,
  // поэтому пол идеально сливается с scene.background (#F2F2F7).
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({
      opacity: 0.18,
      transparent: true,
      shadowSide: THREE.FrontSide
    })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.001;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
}

// Блок 18: Процедурное окружение через RoomEnvironment — работает без сетевых запросов.
// Создаёт мягкое нейтральное отражение на ткани (имитация диффузной студийной среды).
function setupEnvironmentMap() {
  if (!renderer) return;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const roomEnv = new RoomEnvironment();
  scene.environment = pmrem.fromScene(roomEnv, 0.02).texture;

  roomEnv.dispose();
  pmrem.dispose();
}

// Блок 19: Обертка Promise для GLTFLoader (удобно для async/await пайплайна загрузки).
function loadGLTF(path) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => resolve(gltf),
      undefined,
      (error) => reject(error)
    );
  });
}

// Блок 20: Получение текущего размера контейнера (с защитой от нулевых значений).
function getContainerSize() {
  const width = Math.max(canvasContainer?.clientWidth || 1, 1);
  const height = Math.max(canvasContainer?.clientHeight || 1, 1);
  return { width, height };
}

// Блок 21: Resize-логика для правильной математики проекции камеры.
function updateRendererSize() {
  if (!renderer || !camera) return;
  const { width, height } = getContainerSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// Блок 22: Служебные функции для выделения/сброса активных кнопок.
function setActiveByData(nodeList, dataKey, value) {
  nodeList.forEach((node) => {
    node.classList.toggle("active", node.dataset[dataKey] === value);
  });
}

function updateRotationButtons() {
  rotateStartButton?.classList.toggle("active", autoRotateEnabled);
  rotateStopButton?.classList.toggle("active", !autoRotateEnabled);
}

function updateColorLabel(hex) {
  if (colorValueLabel) {
    colorValueLabel.textContent = hex.toUpperCase();
  }
}

// Блок 23: Инициализация профессионального Color Wheel через iro.js.
function initIroPicker() {
  if (!colorWheelContainer) return;

  if (!window.iro) {
    console.error("iro.js не найден. Проверьте подключение CDN.");
    return;
  }

  const wheelSize = getColorWheelSize();

  colorPicker = new window.iro.ColorPicker(colorWheelContainer, {
    width: wheelSize,
    color: partColorState[currentPart],
    borderWidth: 1,
    borderColor: "#2d2d2d",
    layout: [
      {
        component: window.iro.ui.Wheel
      },
      {
        component: window.iro.ui.Slider,
        options: {
          sliderType: "value"
        }
      }
    ]
  });

  // При любом изменении колеса обновляем цвет именно выбранной зоны изделия.
  colorPicker.on("color:change", (iroColor) => {
    const hex = iroColor.hexString.toUpperCase();
    changeColor(hex);
  });

  updateColorLabel(partColorState[currentPart]);
}

function getColorWheelSize() {
  const raw = colorWheelContainer?.clientWidth ? colorWheelContainer.clientWidth - 16 : 260;
  return Math.min(Math.max(raw, 210), 300);
}

function updateColorWheelSize() {
  if (!colorPicker) return;
  const nextSize = getColorWheelSize();
  if (typeof colorPicker.resize === "function") {
    colorPicker.resize(nextSize);
  }
}

function syncPickerToCurrentPart() {
  const hex = partColorState[currentPart] || "#FF4500";
  updateColorLabel(hex);

  if (!colorPicker) return;
  const pickerHex = colorPicker.color.hexString.toUpperCase();
  if (pickerHex !== hex.toUpperCase()) {
    colorPicker.color.hexString = hex;
  }
}

// Блок 24: Материал-утилиты и аккуратное освобождение памяти.
function collectMaterials(root) {
  const set = new Set();
  root?.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material) set.add(material);
    });
  });
  return Array.from(set);
}

function disposeObject(root) {
  if (!root) return;

  root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function clearPartMaterialMaps() {
  partMaterials.torso.clear();
  partMaterials.sleeves.clear();
  allMaterials.clear();
}

function applyFabricMaterialLook(material) {
  // Тяжёлый бифлекс под ярким молочным светом: roughness 0.65 исключает шиноподобный
  // блеск, metalness 0.05 даёт ровно столько холодного отблеска, сколько нужно
  // для читаемости фактуры на светлом фоне.
  material.roughness = 0.65;
  material.metalness = 0.05;
  material.envMapIntensity = 0.9;
  material.needsUpdate = true;
}

// Блок 25: Плавное исчезновение старой модели перед переключением.
function fadeOutAndDispose(root, duration = 220) {
  return new Promise((resolve) => {
    if (!root) {
      resolve();
      return;
    }

    const materials = collectMaterials(root);
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 1;
    });

    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const alpha = 1 - progress;

      materials.forEach((material) => {
        material.opacity = alpha;
      });

      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }

      scene.remove(root);
      disposeObject(root);
      resolve();
    };

    requestAnimationFrame(step);
  });
}

// Блок 26: Плавное появление новой модели (fade-in).
function fadeInObject(root, duration = 280, finalOpacity = 1) {
  return new Promise((resolve) => {
    if (!root) {
      resolve();
      return;
    }

    const materials = collectMaterials(root);
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0;
    });

    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const alpha = finalOpacity * progress;

      materials.forEach((material) => {
        material.opacity = alpha;
      });

      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }

      materials.forEach((material) => {
        material.opacity = finalOpacity;
        material.transparent = finalOpacity < 1;
        material.needsUpdate = true;
      });

      resolve();
    };

    requestAnimationFrame(step);
  });
}

// Блок 27: Нормализация позиции модели (центр + опора на пол).
function placeModelOnStudioFloor(root) {
  if (!root) return;

  const initialBox = new THREE.Box3().setFromObject(root);
  const initialCenter = initialBox.getCenter(new THREE.Vector3());

  // Центрируем модель по X/Z, чтобы управление камерой было стабильным.
  root.position.x -= initialCenter.x;
  root.position.z -= initialCenter.z;

  const correctedBox = new THREE.Box3().setFromObject(root);
  root.position.y -= correctedBox.min.y;
  root.position.y += 0.01;
}

// Блок 28: Подгонка камеры под текущую модель.
function fitCameraToGear() {
  if (!gearRoot || !camera || !controls) return;

  const box = new THREE.Box3().setFromObject(gearRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(2.2, maxDim * 1.9);

  camera.position.set(center.x + distance * 0.6, center.y + maxDim * 0.5, center.z + distance);
  controls.target.set(center.x, center.y + maxDim * 0.15, center.z);
  controls.minDistance = Math.max(0.8, maxDim * 0.6);
  controls.maxDistance = Math.max(4, maxDim * 4.5);
  controls.update();
}

// Блок 29: Классификация материалов по именам mesh для зон окрашивания.
function collectPartMaterials(root) {
  clearPartMaterialMaps();

  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;

    const meshName = String(node.name || "").toLowerCase();
    const materials = Array.isArray(node.material) ? node.material : [node.material];

    materials.forEach((material) => {
      if (!material || !material.color) return;

      applyFabricMaterialLook(material);
      allMaterials.add(material);

      if (meshName.includes("torso") || meshName.includes("body") || meshName.includes("chest") || meshName.includes("front") || meshName.includes("back")) {
        partMaterials.torso.add(material);
      }

      if (meshName.includes("sleeve") || meshName.includes("arm") || meshName.includes("left") || meshName.includes("right")) {
        partMaterials.sleeves.add(material);
      }

    });
  });

  // Если модель не имеет ожидаемых имен, оставляем управление рабочим через fallback-классификацию.
  if (allMaterials.size > 0) {
    if (partMaterials.torso.size === 0) {
      allMaterials.forEach((material) => partMaterials.torso.add(material));
    }
    if (partMaterials.sleeves.size === 0) {
      allMaterials.forEach((material) => partMaterials.sleeves.add(material));
    }
  }
}

// Блок 30: Покраска конкретной зоны.
function applyColorToPart(partName, hex) {
  const targetSet = partMaterials[partName];
  const materials = targetSet && targetSet.size > 0 ? targetSet : allMaterials;

  materials.forEach((material) => {
    if (!material?.color) return;
    material.color.set(hex);
    material.needsUpdate = true;
  });
}

function applyAllPartColors() {
  applyColorToPart("torso", partColorState.torso);
  applyColorToPart("sleeves", partColorState.sleeves);
}

// Блок 30.1: Динамическое ценообразование.
// Базовая цена рашгарда: 4500₽. Каждое изменение цвета зоны от дефолта добавляет наценку.
const BASE_PRICE = 4500;
const COLOR_CHANGE_INCREMENT = 500;
const DEFAULT_PART_COLOR = "#FF4500";
const priceValueElement = document.getElementById("price-value");

function calculatePrice() {
  let price = BASE_PRICE;
  for (const part in partColorState) {
    if (partColorState[part] !== DEFAULT_PART_COLOR) {
      price += COLOR_CHANGE_INCREMENT;
    }
  }
  return price;
}

function updatePriceDisplay() {
  if (!priceValueElement) return;
  const price = calculatePrice();
  // Форматируем число с пробелами: 4 500 ₽
  priceValueElement.textContent = price.toLocaleString("ru-RU") + " ₽";
}

function changeColor(hex) {
  partColorState[currentPart] = hex.toUpperCase();
  applyColorToPart(currentPart, partColorState[currentPart]);
  updateColorLabel(partColorState[currentPart]);
  updatePriceDisplay();
}

// Блок 31: Управление прозрачностью экипа в режиме "На манекене".
function updateGearTransparencyForViewMode() {
  if (!gearRoot) return;

  const targetOpacity = currentViewMode === "human" ? 0.9 : 1;
  const materials = collectMaterials(gearRoot);

  materials.forEach((material) => {
    material.opacity = targetOpacity;
    material.transparent = targetOpacity < 1;
    material.needsUpdate = true;
  });
}

// Блок 32: Fallback-модель рашгарда — скруглённые CapsuleGeometry вместо коробок.
// Округлые формы дают естественный градиент освещения и реалистичный тест теней.
function createRashguardFallback(modelType) {
  const group = new THREE.Group();
  group.name = "RST61_Fallback_Rashguard";

  const torsoMaterial  = new THREE.MeshStandardMaterial({ color: partColorState.torso });
  const sleevesMaterial = new THREE.MeshStandardMaterial({ color: partColorState.sleeves });

  applyFabricMaterialLook(torsoMaterial);
  applyFabricMaterialLook(sleevesMaterial);

  // Торс: вертикальная капсула, приплюснута по Z для пропорций тела.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.82, 8, 24), torsoMaterial);
  torso.name = "mesh_torso";
  torso.position.set(0, 1.04, 0);
  torso.scale.set(1.0, 1.0, 0.58); // передне-задняя плоскость тела

  // Рукава: горизонтальные капсулы (поворот PI/2 по Z → лежат вдоль X).
  const armLength = modelType === "short" ? 0.46 : 0.70;
  const armOffsetX = 0.58; // расстояние от оси до плеча

  const sleeveLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, armLength, 6, 16), sleevesMaterial);
  sleeveLeft.name = "mesh_sleeves";
  sleeveLeft.rotation.z = Math.PI / 2;
  sleeveLeft.position.set(-(armOffsetX + armLength * 0.5), 1.22, 0);

  const sleeveRight = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, armLength, 6, 16), sleevesMaterial);
  sleeveRight.name = "mesh_sleeves";
  sleeveRight.rotation.z = Math.PI / 2;
  sleeveRight.position.set(armOffsetX + armLength * 0.5, 1.22, 0);

  group.add(torso, sleeveLeft, sleeveRight);
  group.userData.isFallback = true;

  return group;
}

// Блок 33: Подготовка загруженной модели экипа (тени/материалы/позиция).
function prepareGearModel(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;

    node.castShadow = true;
    node.receiveShadow = false;

    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      // Отключаем vertex colors, чтобы цветовой пикер не перекрывался данными из GLB.
      material.vertexColors = false;
      if (material.color) {
        applyFabricMaterialLook(material);
      }
    });
  });

  // Коррекция оси: Blender экспортирует модель лёжа (ось Z вверх),
  // а Three.js использует ось Y вверх — поворачиваем на -90° по X.
  if (!root.userData.isFallback) {
    root.rotation.x = -Math.PI / 2;
  }

  placeModelOnStudioFloor(root);
}

// Блок 34: Основной пайплайн переключения long/short с защитой от гонок загрузки.
async function loadGearModel(modelType) {
  currentModelType = modelType;
  setActiveByData(modelButtons, "model", modelType);

  const token = ++gearLoadToken;
  showLoading("ЗАГРУЗКА ЭКИПИРОВКИ...");

  const previousGear = gearRoot;
  gearRoot = null;
  clearPartMaterialMaps();

  await fadeOutAndDispose(previousGear, 220);

  if (token !== gearLoadToken) return;

  let nextRoot;
  const modelPath = MODEL_PATHS[modelType];
  const fallbackPath = MODEL_FALLBACK_PATHS[modelType];

  try {
    const gltf = await loadGLTF(modelPath);
    console.log("Модель загружена:", modelPath);
    nextRoot = gltf.scene;
  } catch {
    if (fallbackPath) {
      try {
        const gltf = await loadGLTF(fallbackPath);
        console.log("Модель загружена (запасной путь):", fallbackPath);
        nextRoot = gltf.scene;
      } catch (err) {
        console.error("Ошибка загрузки модели:", fallbackPath, err);
        nextRoot = createRashguardFallback(modelType);
      }
    } else {
      console.warn("Модель не найдена, используем процедурную геометрию:", modelPath);
      nextRoot = createRashguardFallback(modelType);
    }
  }

  if (token !== gearLoadToken) {
    disposeObject(nextRoot);
    return;
  }

  gearRoot = nextRoot;
  prepareGearModel(gearRoot);
  scene.add(gearRoot);
  collectPartMaterials(gearRoot);
  applyAllPartColors();
  updateGearTransparencyForViewMode();
  fitCameraToGear();

  const finalOpacity = currentViewMode === "human" ? 0.9 : 1;
  await fadeInObject(gearRoot, 280, finalOpacity);

  if (currentViewMode === "human") {
    await ensureMannequinLoaded();
    alignMannequinToGear();
    if (mannequinRoot) {
      mannequinRoot.visible = true;
    }
  }

  hideLoading();
}

// Блок 35: Создание fallback-манекена, если models/human.glb отсутствует.
function createMannequinFallback() {
  const group = new THREE.Group();
  group.name = "RST61_Fallback_Mannequin";

  const material = new THREE.MeshStandardMaterial({
    color: "#8a8a8a",
    roughness: 0.92,
    metalness: 0.02,
    transparent: true,
    opacity: 0.5
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.85, 8, 16), material);
  torso.position.set(0, 1.08, 0);

  const armLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.62, 6, 12), material);
  armLeft.position.set(-0.45, 1.1, 0);
  armLeft.rotation.z = 0.3;

  const armRight = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.62, 6, 12), material);
  armRight.position.set(0.45, 1.1, 0);
  armRight.rotation.z = -0.3;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 20), material);
  neck.position.set(0, 1.7, 0);

  group.add(torso, armLeft, armRight, neck);
  return group;
}

// Блок 36: Подготовка материалов манекена для режима "On Mannequin".
function prepareMannequin(root) {
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;

    node.castShadow = true;
    node.receiveShadow = true;

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;

      if (material.color) {
        material.color.set("#7f7f7f");
      }
      material.roughness = 0.9;
      material.metalness = 0.02;
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
      material.needsUpdate = true;
    });
  });
}

// Блок 37: Ленивая загрузка human.glb (по требованию, только когда включают режим манекена).
async function ensureMannequinLoaded() {
  if (mannequinRoot) return mannequinRoot;
  if (mannequinLoadPromise) return mannequinLoadPromise;

  mannequinLoadPromise = (async () => {
    let loadedRoot;

    try {
      console.log("Загрузка манекена...");
      const gltf = await loadGLTF(MANNEQUIN_PATH);
      console.log("Манекен загружен:", MANNEQUIN_PATH);
      loadedRoot = gltf.scene;
    } catch (error) {
      console.error("Ошибка загрузки манекена:", MANNEQUIN_PATH, error);
      loadedRoot = createMannequinFallback();
    }

    prepareMannequin(loadedRoot);
    loadedRoot.visible = false;
    scene.add(loadedRoot);
    mannequinRoot = loadedRoot;
    return loadedRoot;
  })();

  const result = await mannequinLoadPromise;
  mannequinLoadPromise = null;
  return result;
}

// Блок 38: Точное позиционирование манекена внутрь текущего рашгарда по bounding box.
function alignMannequinToGear() {
  if (!gearRoot || !mannequinRoot) return;

  // Сбрасываем трансформации, чтобы каждый новый расчет начинался с чистой геометрии.
  mannequinRoot.position.set(0, 0, 0);
  mannequinRoot.rotation.set(0, 0, 0);
  mannequinRoot.scale.set(1, 1, 1);

  const gearBox = new THREE.Box3().setFromObject(gearRoot);
  const mannequinBox = new THREE.Box3().setFromObject(mannequinRoot);

  const gearSize = gearBox.getSize(new THREE.Vector3());
  const mannequinSize = mannequinBox.getSize(new THREE.Vector3());

  if (mannequinSize.y <= 0.0001) return;

  // Масштабируем манекен под внутренний объем экипа, чтобы он "сидел" внутри корректно.
  const scale = (gearSize.y / mannequinSize.y) * 0.98;
  mannequinRoot.scale.setScalar(scale);

  const scaledMannequinBox = new THREE.Box3().setFromObject(mannequinRoot);
  const gearCenter = gearBox.getCenter(new THREE.Vector3());
  const mannequinCenter = scaledMannequinBox.getCenter(new THREE.Vector3());

  mannequinRoot.position.x += gearCenter.x - mannequinCenter.x;
  mannequinRoot.position.y += gearCenter.y - mannequinCenter.y - gearSize.y * 0.02;
  mannequinRoot.position.z += gearCenter.z - mannequinCenter.z;
}

// Блок 39: Переключение режима просмотра (только экип / на манекене).
async function setViewMode(mode) {
  currentViewMode = mode;
  setActiveByData(viewButtons, "view", mode);
  updateGearTransparencyForViewMode();

  if (mode === "human") {
    showLoading("ЗАГРУЗКА МАНЕКЕНА...");
    await ensureMannequinLoaded();
    alignMannequinToGear();
    if (mannequinRoot) {
      mannequinRoot.visible = true;
    }
    hideLoading();
  } else if (mannequinRoot) {
    mannequinRoot.visible = false;
    hideLoading();
  }
}

// Блок 40: Управление авто-вращением по кнопкам Start/Stop.
function toggleAutoRotate(forceValue) {
  autoRotateEnabled = typeof forceValue === "boolean" ? forceValue : !autoRotateEnabled;

  if (controls) {
    controls.autoRotate = autoRotateEnabled;
    controls.autoRotateSpeed = 0.5;
  }

  updateRotationButtons();
}

// Блок 41: События панели управления конфигуратором.
function setupConfiguratorEvents() {
  modelButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const modelType = button.dataset.model;
      if (!modelType || modelType === currentModelType) return;
      await loadGearModel(modelType);
    });
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.view;
      if (!mode || mode === currentViewMode) return;
      await setViewMode(mode);
    });
  });

  partButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const part = button.dataset.part;
      if (!part) return;

      currentPart = part;
      setActiveByData(partButtons, "part", part);
      syncPickerToCurrentPart();
    });
  });

  rotateStartButton?.addEventListener("click", () => toggleAutoRotate(true));
  rotateStopButton?.addEventListener("click", () => toggleAutoRotate(false));
}

// Блок 42: Глобальный render-loop.
function animate() {
  requestAnimationFrame(animate);

  if (!renderer || !camera || !scene) return;

  // Для производительности на мобильных не рендерим тяжелую 3D-сцену,
  // когда вкладка "Конструктор" скрыта.
  if (!isConfigPageActive) return;

  controls?.update();
  renderer.render(scene, camera);
}

// Блок 43: Инициализация приложения.
function initApp() {
  setupNavigation();
  setupHomeRevealObserver();
  initThreeScene();
  initIroPicker();
  setupConfiguratorEvents();

  setActiveByData(modelButtons, "model", currentModelType);
  setActiveByData(viewButtons, "view", currentViewMode);
  setActiveByData(partButtons, "part", currentPart);
  syncPickerToCurrentPart();
  toggleAutoRotate(false);
  updatePriceDisplay();

  activatePage("page-home");
  loadGearModel(currentModelType);

  window.addEventListener("resize", () => {
    updateRendererSize();
    updateColorWheelSize();

    if (isConfigPageActive) {
      alignMannequinToGear();
      renderer?.render(scene, camera);
    }
  });

  animate();
}

initApp();
