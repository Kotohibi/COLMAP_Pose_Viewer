const statusEl = document.getElementById("status");
const imageEl = document.getElementById("mainImage");
const imageMetaEl = document.getElementById("imageMeta");
const viewerFrameEl = document.getElementById("viewerFrame");
const scrollPadEl = document.getElementById("scrollPad");

const PAD_CENTER = 470;
const PAD_STEP = 80;

let images = [];
let currentIndex = 0;
let imagesDirPath = "";
let isNavigating = false;
let isDragging = false;
let dragLastX = 0;
let dragLastY = 0;
let dragAccumX = 0;
let dragAccumY = 0;

function normalize(vec) {
  const mag = Math.hypot(vec[0], vec[1], vec[2]) || 1;
  return [vec[0] / mag, vec[1] / mag, vec[2] / mag];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mulMatVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function transpose(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function quatToRot(qw, qx, qy, qz) {
  return [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
  ];
}

function parseImagesTxt(content) {
  const lines = content.split(/\r?\n/);
  const parsed = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 10) {
      continue;
    }

    const imageId = Number(parts[0]);
    const qw = Number(parts[1]);
    const qx = Number(parts[2]);
    const qy = Number(parts[3]);
    const qz = Number(parts[4]);
    const tx = Number(parts[5]);
    const ty = Number(parts[6]);
    const tz = Number(parts[7]);
    const cameraId = Number(parts[8]);
    const name = parts.slice(9).join(" ");

    const rotationW2C = quatToRot(qw, qx, qy, qz);
    const rotationC2W = transpose(rotationW2C);
    const t = [tx, ty, tz];
    const cameraCenter = mulMatVec(rotationC2W, [-t[0], -t[1], -t[2]]);

    const right = normalize(mulMatVec(rotationC2W, [1, 0, 0]));
    const up = normalize(mulMatVec(rotationC2W, [0, -1, 0]));
    const forward = normalize(mulMatVec(rotationC2W, [0, 0, 1]));

    parsed.push({
      imageId,
      cameraId,
      name,
      center: cameraCenter,
      right,
      up,
      forward,
    });

    lineIndex += 1;
  }

  return parsed;
}

function joinPath(base, name) {
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalizedBase}/${name}`;
}

function updateDisplayedImage() {
  const current = images[currentIndex];
  const imgPath = joinPath(imagesDirPath, current.name);

  imageEl.src = imgPath;
  imageMetaEl.textContent = `index: ${currentIndex + 1}/${images.length} | image_id: ${current.imageId} | file: ${current.name}`;
  statusEl.textContent = `表示中: ${current.name}`;
}

function findNextIndex(direction) {
  const current = images[currentIndex];

  let primaryAxis;
  let lateralAxis;
  if (direction === "up") {
    primaryAxis = current.up;
    lateralAxis = current.right;
  } else if (direction === "down") {
    primaryAxis = current.up.map((v) => -v);
    lateralAxis = current.right;
  } else if (direction === "left") {
    primaryAxis = current.right.map((v) => -v);
    lateralAxis = current.up;
  } else {
    primaryAxis = current.right;
    lateralAxis = current.up;
  }

  let bestIndex = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < images.length; i += 1) {
    if (i === currentIndex) {
      continue;
    }

    const candidate = images[i];
    const delta = sub(candidate.center, current.center);
    const distance = Math.hypot(delta[0], delta[1], delta[2]);
    if (distance < 1e-6) {
      continue;
    }

    const primary = dot(delta, primaryAxis);
    if (primary <= 0) {
      continue;
    }

    const lateral = Math.abs(dot(delta, lateralAxis));
    const depth = Math.abs(dot(delta, current.forward));

    const alignment = primary / distance;
    const sidePenalty = lateral / distance;
    const depthPenalty = depth / distance;
    const score = alignment - 0.3 * sidePenalty - 0.2 * depthPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function navigate(direction) {
  if (isNavigating || images.length < 2) {
    return;
  }

  isNavigating = true;
  const nextIndex = findNextIndex(direction);

  if (nextIndex === -1) {
    statusEl.textContent = `これ以上 ${direction} 方向に移動できる画像がありません`;
    isNavigating = false;
    return;
  }

  currentIndex = nextIndex;
  updateDisplayedImage();
  isNavigating = false;
}

function resetScrollPadToCenter() {
  scrollPadEl.scrollLeft = PAD_CENTER;
  scrollPadEl.scrollTop = PAD_CENTER;
}

function applyScrollDelta(deltaX, deltaY) {
  const xSteps = Math.trunc(deltaX / PAD_STEP);
  const ySteps = Math.trunc(deltaY / PAD_STEP);

  if (xSteps > 0) {
    for (let i = 0; i < xSteps; i += 1) {
      navigate("left");
    }
  } else if (xSteps < 0) {
    for (let i = 0; i < Math.abs(xSteps); i += 1) {
      navigate("right");
    }
  }

  if (ySteps > 0) {
    for (let i = 0; i < ySteps; i += 1) {
      navigate("down");
    }
  } else if (ySteps < 0) {
    for (let i = 0; i < Math.abs(ySteps); i += 1) {
      navigate("up");
    }
  }
}

function setupInputHandlers() {
  resetScrollPadToCenter();

  imageEl.draggable = false;

  scrollPadEl.addEventListener("scroll", () => {
    const dx = scrollPadEl.scrollLeft - PAD_CENTER;
    const dy = scrollPadEl.scrollTop - PAD_CENTER;

    if (Math.abs(dx) < PAD_STEP && Math.abs(dy) < PAD_STEP) {
      return;
    }

    applyScrollDelta(dx, dy);
    resetScrollPadToCenter();
  });

  viewerFrameEl.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      applyScrollDelta(event.deltaX, event.deltaY);
    },
    { passive: false }
  );

  viewerFrameEl.addEventListener("mousedown", (event) => {
    isDragging = true;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    dragAccumX = 0;
    dragAccumY = 0;
    viewerFrameEl.classList.add("dragging");
  });

  window.addEventListener("mousemove", (event) => {
    if (!isDragging) {
      return;
    }

    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;

    dragAccumX += dx;
    dragAccumY += dy;

    const xSteps = Math.trunc(dragAccumX / PAD_STEP);
    const ySteps = Math.trunc(dragAccumY / PAD_STEP);

    if (xSteps !== 0 || ySteps !== 0) {
      applyScrollDelta(xSteps * PAD_STEP, ySteps * PAD_STEP);
      dragAccumX -= xSteps * PAD_STEP;
      dragAccumY -= ySteps * PAD_STEP;
    }
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    viewerFrameEl.classList.remove("dragging");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      navigate("up");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      navigate("down");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate("right");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigate("left");
    }
  });
}

async function loadConfig() {
  const response = await fetch("config.json");
  if (!response.ok) {
    throw new Error("config.json の読み込みに失敗しました");
  }
  return response.json();
}

async function initialize() {
  try {
    const config = await loadConfig();
    imagesDirPath = config.imagesDirPath;

    const imagesTxtResponse = await fetch(config.imagesTxtPath);
    if (!imagesTxtResponse.ok) {
      throw new Error(`images.txt の読み込みに失敗: ${config.imagesTxtPath}`);
    }

    const content = await imagesTxtResponse.text();
    images = parseImagesTxt(content);

    if (!images.length) {
      throw new Error("images.txt から姿勢情報を取得できませんでした");
    }

    currentIndex = 0;
    updateDisplayedImage();
    setupInputHandlers();
  } catch (error) {
    statusEl.textContent = `エラー: ${error.message}`;
    imageMetaEl.textContent = "config.json のパス設定とローカルサーバー起動状態を確認してください。";
  }
}

initialize();
