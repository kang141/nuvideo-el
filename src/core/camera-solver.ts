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

// 灵敏死区参数：大幅缩小死区，从 0.15 降为 0.05，让镜头反应更快
const DEADZONE_W = 0.05;
const DEADZONE_H = 0.04;

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

  // 镜头配置 - 强制使用极慢的丝滑参数（ScreenStudio 风格）
  // 注意：这里暂时忽略 graph.camera.springConfig，确保旧项目也能立刻享受到如丝般顺滑
  const camConfig = {
    stiffness: 40,   // 从 80 再降到 40，极慢，像电影镜头一样
    damping: 20,     // 配合 stiffness 40 的过阻尼 (Ratio ~1.58)，无回弹
  };

  // 鼠标物理配置优化（核心：确保过阻尼，消除震荡）
  const mouseConfig = (() => {
    // 刚度随平滑度降低而增加
    const stiffness = 2800 - sm * 1600;
    // 阻尼比：必须 >= 1.0 (临界阻尼) 才能保证没有回弹晃动
    const dampingRatio = 1.15 + sm * 1.5;
    const damping = 2 * Math.sqrt(stiffness) * dampingRatio;

    const outW = graph.config.outputWidth || 1920;
    const speedLimitPx = graph.mousePhysics.speedLimit || 6000;
    const maxSpeed = Math.max(0.25, speedLimitPx / outW);

    return { stiffness, damping, maxSpeed };
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

        // 过远补偿：如果落后太远（>40% 屏幕），直接同步，防止产生幻影
        if (dist > 0.4) {
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
    const targetScale = active.targetScale;
    let targetCx = state.cx;
    let targetCy = state.cy;

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

    // 3. 镜头物理
    const fS =
      -camConfig.stiffness * (state.scale - targetScale) -
      camConfig.damping * state.vs;
    state.vs += fS * factor;
    state.scale += state.vs * factor;

    const fX =
      -camConfig.stiffness * (state.cx - targetCx) -
      camConfig.damping * state.vx;
    state.vx += fX * factor;
    state.cx += state.vx * factor;

    const fY =
      -camConfig.stiffness * (state.cy - targetCy) -
      camConfig.damping * state.vy;
    state.vy += fY * factor;
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
