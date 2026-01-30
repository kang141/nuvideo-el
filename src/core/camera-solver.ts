import {
  RenderGraph,
  CameraIntent,
  MouseEvent as NuMouseEvent,
} from "../types";

interface CameraState {
  cx: number;
  cy: number;
  scale: number;
  vx: number;
  vy: number;
  vs: number;
  mx: number;
  my: number;
  mvx: number;
  mvy: number;
}

const defaultIntent: CameraIntent = {
  t: 0,
  targetCx: 0.5,
  targetCy: 0.5,
  targetScale: 1.0,
};

// Deadzone：放大时鼠标可以在这个区域内自由移动而不触发镜头跟随
// 数值越大，放大后画面越稳定（鼠标需要移动到更靠近边缘才会拖动镜头）
const DEADZONE_W = 0.15; // 横向死区（占画面宽度的 15%）
const DEADZONE_H = 0.12; // 纵向死区（占画面高度的 12%）

// 自动对焦时的缩放力度
const AUTO_ZOOM_SCALE = 2.0; // Screen Studio 风格：更大幅度的局部特写

// ============ 增量缓存系统 ============
// 用于导出时避免 O(n²) 重复计算
interface CameraSolverCache {
  lastT: number;
  state: CameraState;
  mouseIdx: number;
}

let incrementalCache: CameraSolverCache | null = null;

/**
 * 重置增量缓存。导出开始前调用一次。
 */
export function resetCameraCache(): void {
  incrementalCache = null;
}

/**
 * 启用增量模式。调用后 computeCameraState 会从上次 t 继续积分，
 * 而非每次都从 0 开始。
 */
export function enableIncrementalMode(): void {
  incrementalCache = {
    lastT: 0,
    state: {
      cx: 0.5, cy: 0.5, scale: 1.0,
      vx: 0, vy: 0, vs: 0,
      mx: 0.5, my: 0.5, mvx: 0, mvy: 0,
    },
    mouseIdx: 0,
  };
}
// ============ 增量缓存系统结束 ============

function findActiveIntent(intents: CameraIntent[], t: number): CameraIntent {
  if (intents.length === 0) return defaultIntent;
  let active = defaultIntent;
  for (let i = 0; i < intents.length; i++) {
    if (intents[i].t <= t) active = intents[i];
    else break;
  }
  return { ...active };
}

// 缓存查找结果，优化性能
let lastMouseIdx = 0;
function findMousePos(
  events: NuMouseEvent[],
  t: number,
): { x: number; y: number } | null {
  if (!events || events.length === 0) return null;

  // 简单的指针搜索，因为 currentT 是单调递增的
  let best: NuMouseEvent | null = null;
  for (let i = lastMouseIdx; i < events.length; i++) {
    if (events[i].t <= t) {
      best = events[i];
      lastMouseIdx = i;
    } else {
      break;
    }
  }

  if (!best) {
    const first = events[0];
    return { x: first.x, y: first.y };
  }

  const next = events[lastMouseIdx + 1];
  if (!next || next.t <= best.t) {
    return { x: best.x, y: best.y };
  }

  const span = next.t - best.t;
  if (span <= 1e-6) return { x: best.x, y: best.y };

  const ratio = Math.min(1, Math.max(0, (t - best.t) / span));
  return {
    x: best.x + (next.x - best.x) * ratio,
    y: best.y + (next.y - best.y) * ratio,
  };
}

export function computeCameraState(graph: RenderGraph, t: number) {
  const intents = graph.camera.intents || [];
  const mouseEvents = graph.mouse || [];

  // 1. 获取平滑度参数
  const sm = Math.max(0, Math.min(1, graph.mousePhysics.smoothing));
  const isInstantMouse = sm < 0.001;

  // 镜头配置：优先使用 graph.camera.springConfig
  const camConfig = (() => {
    const cfg = graph.camera?.springConfig;
    
    // Screen Studio 核心调校：临界阻尼 (Critically Damped)
    // 刚度 320 提供足够的加速度 (快)，阻尼 36 确保准确停车 (无回弹/震荡)
    // 2 * sqrt(320) ≈ 35.77，取 36 略微过阻尼，实现"如丝般顺滑且精准"的停顿
    const fallback = { stiffness: 320, damping: 36 };
    
    const stiffness = typeof cfg?.stiffness === 'number' ? cfg.stiffness : fallback.stiffness;
    const damping = typeof cfg?.damping === 'number' ? cfg.damping : fallback.damping;
    return {
      stiffness: Math.max(1, stiffness),
      damping: Math.max(0, damping),
    };
  })();

  // 鼠标物理配置优化
  const mouseConfig = (() => {
    // 降低一点刚度，增加"重量感"，让鼠标像是在流体中运动一样平滑
    const stiffness = 2500 - sm * 1500;
    // 保持过阻尼，过滤掉所有手抖
    const dampingRatio = 1.2 + sm * 1.5;
    const damping = 2 * Math.sqrt(Math.max(1, stiffness)) * dampingRatio;

    const outW = graph.config.outputWidth || 1920;
    const speedLimitPx = graph.mousePhysics.speedLimit || 8000;
    const maxSpeed = Math.max(0.15, (speedLimitPx / outW) * 0.9);

    return { stiffness: Math.max(1, stiffness), damping: Math.max(0, damping), maxSpeed };
  })();

  // ============ 增量模式：从缓存继续积分 ============
  let state: CameraState;
  let currentT: number;

  if (incrementalCache && t >= incrementalCache.lastT) {
    // 增量模式：从上次位置继续
    state = { ...incrementalCache.state };
    currentT = incrementalCache.lastT;
    lastMouseIdx = incrementalCache.mouseIdx;
  } else {
    // 非增量模式或时间回退：从头开始
    state = {
      cx: 0.5,
      cy: 0.5,
      scale: 1.0,
      vx: 0,
      vy: 0,
      vs: 0,
      mx: 0.5,
      my: 0.5,
      mvx: 0,
      mvy: 0,
    };
    currentT = 0;
    lastMouseIdx = 0;
  }

  // 子步长优化：将 16.6ms 拆解为 2ms 的小步长，极大提升数值稳定性
  const dt = 2.0;

  while (currentT < t) {
    const nextT = Math.min(currentT + dt, t);
    const stepDt = nextT - currentT;
    const factor = stepDt / 1000;

    const active = findActiveIntent(intents, currentT);
    const rawMouse = findMousePos(mouseEvents, currentT);

    // 1. 鼠标物理计算
    if (rawMouse) {
      if (isInstantMouse) {
        state.mx = rawMouse.x;
        state.my = rawMouse.y;
        state.mvx = 0;
        state.mvy = 0;
      } else {
        const dxm = rawMouse.x - state.mx;
        const dym = rawMouse.y - state.my;
        const dist = Math.sqrt(dxm * dxm + dym * dym);

        // 过远补偿：阈值从 0.4 缩小到 0.12，防止在大幅移动时产生明显的拖后感
        if (dist > 0.12) {
          state.mx = rawMouse.x;
          state.my = rawMouse.y;
          state.mvx = 0;
          state.mvy = 0;
        } else {
          const fMx =
            -mouseConfig.stiffness * (state.mx - rawMouse.x) -
            mouseConfig.damping * state.mvx;
          const fMy =
            -mouseConfig.stiffness * (state.my - rawMouse.y) -
            mouseConfig.damping * state.mvy;
          state.mvx += fMx * factor;
          state.mvy += fMy * factor;

          const speed = Math.sqrt(
            state.mvx * state.mvx + state.mvy * state.mvy,
          );
          if (speed > mouseConfig.maxSpeed) {
            state.mvx = (state.mvx / speed) * mouseConfig.maxSpeed;
            state.mvy = (state.mvy / speed) * mouseConfig.maxSpeed;
          }
          state.mx += state.mvx * factor;
          state.my += state.mvy * factor;
        }
      }
    }

    // 2. 镜头跟随
    // 如果开启了 autoZoom 且当前没有强制覆盖的 intent（或者只有全局 intent），则应用自动逻辑
    const hasManualIntent = intents.some(i => i.t > 10); // 简单判定：T>10ms 的通常是手动添加的

    let targetScale = active.targetScale;
    let targetCx = state.cx;
    let targetCy = state.cy;

    // 自动缩放逻辑：当开启了全局 autoZoom 且当前没有活跃的手动覆盖意图时生效
    if (graph.autoZoom && !hasManualIntent && rawMouse) {
      targetScale = AUTO_ZOOM_SCALE;
    }

    if (targetScale > 1.01 && rawMouse) {
      const marginX = 0.5 / targetScale;
      const marginY = 0.5 / targetScale;

      const left = state.cx - DEADZONE_W;
      const right = state.cx + DEADZONE_W;
      const top = state.cy - DEADZONE_H;
      const bottom = state.cy + DEADZONE_H;

      if (rawMouse.x < left) targetCx = rawMouse.x + DEADZONE_W;
      else if (rawMouse.x > right) targetCx = rawMouse.x - DEADZONE_W;

      if (rawMouse.y < top) targetCy = rawMouse.y + DEADZONE_H;
      else if (rawMouse.y > bottom) targetCy = rawMouse.y - DEADZONE_H;

      targetCx = Math.max(marginX, Math.min(1 - marginX, targetCx));
      targetCy = Math.max(marginY, Math.min(1 - marginY, targetCy));
    } else {
      targetCx = 0.5;
      targetCy = 0.5;
    }

    // 3. 镜头物理（Scale 使用独立的更快参数）
    // Scale 专用：快速但绝对稳定（临界阻尼）
    const scaleStiffness = camConfig.stiffness * 1.8; // 进一步提速
    // 临界阻尼公式：D = 2 * sqrt(k)，确保零震荡
    const scaleDamping = 2 * Math.sqrt(scaleStiffness);
    
    const fS =
      -scaleStiffness * (state.scale - targetScale) -
      scaleDamping * state.vs;
    state.vs += fS * factor;
    {
      const maxVs = 3.0; // 提高速度上限以配合更高刚度
      if (state.vs > maxVs) state.vs = maxVs;
      else if (state.vs < -maxVs) state.vs = -maxVs;
    }
    state.scale += state.vs * factor;

    // Position 保持原有的平滑参数
    const fX =
      -camConfig.stiffness * (state.cx - targetCx) -
      camConfig.damping * state.vx;
    state.vx += fX * factor;
    {
      const maxV = 2.8;
      if (state.vx > maxV) state.vx = maxV;
      else if (state.vx < -maxV) state.vx = -maxV;
    }
    state.cx += state.vx * factor;

    const fY =
      -camConfig.stiffness * (state.cy - targetCy) -
      camConfig.damping * state.vy;
    state.vy += fY * factor;
    {
      const maxV = 2.8;
      if (state.vy > maxV) state.vy = maxV;
      else if (state.vy < -maxV) state.vy = -maxV;
    }
    state.cy += state.vy * factor;

    currentT = nextT;
  }

  // ============ 更新增量缓存 ============
  if (incrementalCache) {
    incrementalCache.lastT = t;
    incrementalCache.state = { ...state };
    incrementalCache.mouseIdx = lastMouseIdx;
  }

  return {
    cx: state.cx,
    cy: state.cy,
    scale: state.scale,
    mx: state.mx,
    my: state.my,
  };
}
