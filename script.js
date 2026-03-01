const statusEl = document.getElementById("status");
const imageEl = document.getElementById("mainImage");
const imageMetaEl = document.getElementById("imageMeta");
const viewerFrameEl = document.getElementById("viewerFrame");

const PAD_STEP_X = 20; // 横方向（左右）感度
const PAD_STEP_Y = 80; // 縦方向（上下）感度

let images = [];
let currentIndex = 0;
let imagesDirPath = "";
let isNavigating = false;
let isDragging = false;
let dragLastX = 0;
let dragLastY = 0;
let dragAccumX = 0;
let dragAccumY = 0;

// Zoom state
let zoomLevel = 1;
let zoomMin = 0.5;
let zoomMax = 10;
let zoomStep = 0.1;
let panX = 0;
let panY = 0;
let isPanning = false;

// Touch state
let touchStartX = 0;
let touchStartY = 0;
let touchAccumX = 0;
let touchAccumY = 0;
let isTouching = false;
let touchPanning = false;
let lastPinchDist = 0;
let isPinching = false;
let lastTapTime = 0;

// Orbit navigation state
let navigationMode = "orbit"; // "orbit" or "local"
let sceneCenter = [0, 0, 0];
let worldUpVec = [0, 1, 0];
let horizAxis1 = [1, 0, 0];
let horizAxis2 = [0, 0, 1];

function normalize(vec) {
  const mag = Math.hypot(vec[0], vec[1], vec[2]) || 1;
  return [vec[0] / mag, vec[1] / mag, vec[2] / mag];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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
  statusEl.textContent = `Showing: ${current.name}`;

  // Reset zoom/pan on image change
  resetZoom();
}

function resetZoom() {
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyZoomTransform();
}

function applyZoomTransform() {
  imageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  imageEl.style.transformOrigin = "center center";
}

// ─── Orbit navigation helpers ───

function computeOrbitParams() {
  // Compute scene center (centroid of all camera positions)
  let cx = 0, cy = 0, cz = 0;
  for (const img of images) {
    cx += img.center[0];
    cy += img.center[1];
    cz += img.center[2];
  }
  const n = images.length;
  sceneCenter = [cx / n, cy / n, cz / n];

  // Auto-detect world up from average camera up vectors
  let ux = 0, uy = 0, uz = 0;
  for (const img of images) {
    ux += img.up[0];
    uy += img.up[1];
    uz += img.up[2];
  }
  const mag = Math.hypot(ux, uy, uz);
  if (mag > 0.01) {
    worldUpVec = [ux / mag, uy / mag, uz / mag];
  } else {
    worldUpVec = [0, 1, 0];
  }

  // Compute two orthogonal horizontal reference axes
  let ref = [1, 0, 0];
  if (Math.abs(dot(worldUpVec, ref)) > 0.9) {
    ref = [0, 0, 1];
  }
  horizAxis1 = normalize(cross(worldUpVec, ref));
  horizAxis2 = normalize(cross(worldUpVec, horizAxis1));

  console.log("[Orbit] center:", sceneCenter, "worldUp:", worldUpVec);
}

function getSpherical(position) {
  const rel = sub(position, sceneCenter);
  const upComp = dot(rel, worldUpVec);
  const h1 = dot(rel, horizAxis1);
  const h2 = dot(rel, horizAxis2);
  const rHoriz = Math.hypot(h1, h2);
  return {
    r: Math.hypot(rel[0], rel[1], rel[2]),
    elevation: Math.atan2(upComp, rHoriz),
    azimuth: Math.atan2(h2, h1),
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function findNextIndexOrbit(direction) {
  const curSph = getSpherical(images[currentIndex].center);

  let bestIndex = -1;
  let bestDist = Infinity;

  for (let i = 0; i < images.length; i += 1) {
    if (i === currentIndex) continue;

    const candSph = getSpherical(images[i].center);
    const dAz = angleDiff(candSph.azimuth, curSph.azimuth);
    const dEl = candSph.elevation - curSph.elevation;

    let primary, lateral;
    switch (direction) {
      case "left":  primary =  dAz; lateral = dEl; break;
      case "right": primary = -dAz; lateral = dEl; break;
      case "up":    primary =  dEl; lateral = dAz; break;
      case "down":  primary = -dEl; lateral = dAz; break;
    }

    // Must move in the desired direction
    if (primary < 0.001) continue;

    // Alignment check: primary should dominate (~60° cone)
    const angularDist = Math.hypot(primary, lateral);
    const alignment = primary / angularDist;
    if (alignment < 0.5) continue;

    // Pick the nearest camera in this direction
    if (angularDist < bestDist) {
      bestDist = angularDist;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ─── Local navigation (original) ───

function findNextIndexLocal(direction) {
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

function findNextIndex(direction) {
  if (navigationMode === "orbit") {
    return findNextIndexOrbit(direction);
  }
  return findNextIndexLocal(direction);
}

function navigate(direction) {
  if (isNavigating || images.length < 2) {
    return;
  }

  isNavigating = true;
  const nextIndex = findNextIndex(direction);

  if (nextIndex === -1) {
    statusEl.textContent = `No more images available in the ${direction} direction`;
    isNavigating = false;
    return;
  }

  currentIndex = nextIndex;
  updateDisplayedImage();
  isNavigating = false;
}

function applyScrollDelta(deltaX, deltaY) {
  const xSteps = Math.trunc(deltaX / PAD_STEP_X);
  const ySteps = Math.trunc(deltaY / PAD_STEP_Y);

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
  imageEl.draggable = false;

  // Wheel: zoom in/out
  viewerFrameEl.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      if (event.ctrlKey) {
        // Ctrl+Wheel: navigate (original behavior)
        applyScrollDelta(event.deltaX, event.deltaY);
        return;
      }

      const delta = event.deltaY > 0 ? -zoomStep : zoomStep;
      const newZoom = Math.min(zoomMax, Math.max(zoomMin, zoomLevel + delta * zoomLevel));

      // Zoom toward cursor position
      const rect = viewerFrameEl.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;

      const scaleFactor = newZoom / zoomLevel;
      panX = cx - scaleFactor * (cx - panX);
      panY = cy - scaleFactor * (cy - panY);

      zoomLevel = newZoom;
      applyZoomTransform();
    },
    { passive: false }
  );

  // Double-click: reset zoom
  viewerFrameEl.addEventListener("dblclick", () => {
    resetZoom();
  });

  viewerFrameEl.addEventListener("mousedown", (event) => {
    if (zoomLevel > 1.05) {
      // Zoomed in: drag to pan
      isPanning = true;
      isDragging = false;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      viewerFrameEl.classList.add("dragging");
    } else {
      // Normal zoom: drag to navigate
      isPanning = false;
      isDragging = true;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      dragAccumX = 0;
      dragAccumY = 0;
      viewerFrameEl.classList.add("dragging");
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (isPanning) {
      const dx = event.clientX - dragLastX;
      const dy = event.clientY - dragLastY;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      panX += dx;
      panY += dy;
      applyZoomTransform();
      return;
    }

    if (!isDragging) {
      return;
    }

    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;

    dragAccumX += dx;
    dragAccumY += dy;

    const xSteps = Math.trunc(dragAccumX / PAD_STEP_X);
    const ySteps = Math.trunc(dragAccumY / PAD_STEP_Y);

    if (xSteps !== 0 || ySteps !== 0) {
      applyScrollDelta(xSteps * PAD_STEP_X, ySteps * PAD_STEP_Y);
      dragAccumX -= xSteps * PAD_STEP_X;
      dragAccumY -= ySteps * PAD_STEP_Y;
    }
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      viewerFrameEl.classList.remove("dragging");
      return;
    }

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

  // ─── Touch events (iPad / mobile) ───

  function getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function getPinchCenter(touches) {
    const rect = viewerFrameEl.getBoundingClientRect();
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left - rect.width / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top - rect.height / 2,
    };
  }

  viewerFrameEl.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        // Pinch start
        event.preventDefault();
        isPinching = true;
        isTouching = false;
        touchPanning = false;
        lastPinchDist = getPinchDist(event.touches);
        return;
      }

      if (event.touches.length === 1) {
        event.preventDefault();
        const touch = event.touches[0];

        // Double-tap detection
        const now = Date.now();
        if (now - lastTapTime < 300) {
          resetZoom();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;

        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchAccumX = 0;
        touchAccumY = 0;

        if (zoomLevel > 1.05) {
          touchPanning = true;
          isTouching = false;
        } else {
          isTouching = true;
          touchPanning = false;
        }
      }
    },
    { passive: false }
  );

  viewerFrameEl.addEventListener(
    "touchmove",
    (event) => {
      if (isPinching && event.touches.length === 2) {
        event.preventDefault();
        const newDist = getPinchDist(event.touches);
        const scale = newDist / lastPinchDist;
        const newZoom = Math.min(zoomMax, Math.max(zoomMin, zoomLevel * scale));

        const center = getPinchCenter(event.touches);
        const scaleFactor = newZoom / zoomLevel;
        panX = center.x - scaleFactor * (center.x - panX);
        panY = center.y - scaleFactor * (center.y - panY);

        zoomLevel = newZoom;
        lastPinchDist = newDist;
        applyZoomTransform();
        return;
      }

      if (event.touches.length !== 1) return;
      event.preventDefault();
      const touch = event.touches[0];

      if (touchPanning) {
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        panX += dx;
        panY += dy;
        applyZoomTransform();
        return;
      }

      if (isTouching) {
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;

        touchAccumX += dx;
        touchAccumY += dy;

        const xSteps = Math.trunc(touchAccumX / PAD_STEP_X);
        const ySteps = Math.trunc(touchAccumY / PAD_STEP_Y);

        if (xSteps !== 0 || ySteps !== 0) {
          applyScrollDelta(xSteps * PAD_STEP_X, ySteps * PAD_STEP_Y);
          touchAccumX -= xSteps * PAD_STEP_X;
          touchAccumY -= ySteps * PAD_STEP_Y;
        }
      }
    },
    { passive: false }
  );

  viewerFrameEl.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) {
      isPinching = false;
    }
    if (event.touches.length === 0) {
      isTouching = false;
      touchPanning = false;
    }
  });

  viewerFrameEl.addEventListener("touchcancel", () => {
    isTouching = false;
    touchPanning = false;
    isPinching = false;
  });
}

async function loadConfig() {
  const response = await fetch("config.json");
  if (!response.ok) {
    throw new Error("Failed to load config.json");
  }
  return response.json();
}

async function initialize() {
  try {
    const config = await loadConfig();
    imagesDirPath = config.imagesDirPath;
    navigationMode = config.navigationMode || "orbit";

    const imagesTxtResponse = await fetch(config.imagesTxtPath);
    if (!imagesTxtResponse.ok) {
      throw new Error(`Failed to load images.txt: ${config.imagesTxtPath}`);
    }

    const content = await imagesTxtResponse.text();
    images = parseImagesTxt(content);

    if (!images.length) {
      throw new Error("Failed to parse pose data from images.txt");
    }

    if (navigationMode === "orbit") {
      computeOrbitParams();
    }

    currentIndex = 0;
    updateDisplayedImage();
    setupInputHandlers();
    statusEl.textContent = `Loaded (${images.length} images, mode: ${navigationMode})`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
    imageMetaEl.textContent = "Please check config.json paths and ensure the local server is running.";
  }
}

initialize();
