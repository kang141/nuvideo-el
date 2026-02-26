import {
  RenderGraph,
  CameraIntent,
  CameraState,
  MouseEvent as NuMouseEvent,
} from "../types";

// 扩展CameraState接口以包含鼠标相关属性
export interface ExtendedCameraState extends CameraState {
  mx: number;
  my: number;
  mvx: number;
  mvy: number;
  vs: number;
}

const defaultIntent: CameraIntent = {
  t: 0,
  targetCx: 0.5,
  targetCy: 0.5,
  targetScale: 1.0,
};

// 极致响应：缩小死区，让鼠标微动更灵敏地驱动镜头
const DEADZONE_W = 0.08;
const DEADZONE_H = 0.06;

// 自动对焦时的缩放力度
const AUTO_ZOOM_SCALE = 1.5; // 与 auto-zoom.ts 保持一致

// ============ 增量缓存系统 ============
// 用于导出时避免 O(n²) 重复计算
interface CameraSolverCache {
  lastT: number;
  state: ExtendedCameraState;
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
      t: 0,
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

/**
 * 核心优化：高阶鼠标位置插值 (Catmull-Rom 变体)
 * 相比线性插值，它能显著消除在离散采集点之间移动时的“折线感”
 */
let lastMouseIdx = 0;
function findMousePos(
  events: NuMouseEvent[],
  t: number,
): { x: number; y: number } | null {
  if (!events || events.length === 0) return null;

  // 1. 找到当前时间点的事件索引（使用缓存优化）
  let idx = -1;
  for (let i = lastMouseIdx; i < events.length; i++) {
    if (events[i].t <= t) {
      idx = i;
      lastMouseIdx = i;
    } else {
      break;
    }
  }

  if (idx === -1) {
    return { x: events[0].x, y: events[0].y };
  }

  // 2. 如果是最后一个点，直接返回
  if (idx >= events.length - 1) {
    return { x: events[idx].x, y: events[idx].y };
  }

  // 3. 获取插值所需的上下文点 (p0, p1, p2, p3)
  const p1 = events[idx];
  const p2 = events[idx + 1];

  const span = p2.t - p1.t;

  // 🎯 优化：对于极短时间跨度（<1ms），直接返回 p1，避免数值不稳定
  if (span <= 1.0) return { x: p1.x, y: p1.y };

  const ratio = Math.max(0, Math.min(1, (t - p1.t) / span));

  // 🎯 优化：使用 Catmull-Rom 样条插值（四点插值）
  // 这是业界标准的平滑曲线算法，广泛用于动画和图形学
  const p0 = events[Math.max(0, idx - 1)];
  const p3 = events[Math.min(events.length - 1, idx + 2)];

  // Catmull-Rom 张力参数（0.5 是标准值，产生最平滑的曲线）
  const tension = 0.5;

  // 计算切线 (Tangents) - 使用相邻点的差值
  const m1x = (p2.x - p0.x) * tension;
  const m1y = (p2.y - p0.y) * tension;
  const m2x = (p3.x - p1.x) * tension;
  const m2y = (p3.y - p1.y) * tension;

  // Hermite Basis Functions（三次多项式基函数）
  const r2 = ratio * ratio;
  const r3 = r2 * ratio;
  const h1 = 2 * r3 - 3 * r2 + 1;      // p1 的权重
  const h2 = -2 * r3 + 3 * r2;         // p2 的权重
  const h3 = r3 - 2 * r2 + ratio;      // m1 的权重
  const h4 = r3 - r2;                  // m2 的权重

  // 🎯 最终插值结果
  const x = h1 * p1.x + h2 * p2.x + h3 * m1x + h4 * m2x;
  const y = h1 * p1.y + h2 * p2.y + h3 * m1y + h4 * m2y;

  // 🎯 边界保护：确保插值结果不会超出 [0, 1] 范围
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y))
  };
}

export function computeCameraState(graph: RenderGraph, t: number): ExtendedCameraState {
  const intents = graph.camera.intents || [];
  const mouseEvents = graph.mouse || [];

  // 1. 获取平滑度参数
  const sm = Math.max(0, Math.min(1, graph.mousePhysics.smoothing));
  const isInstantMouse = sm < 0.001;

  // 镜头配置：优先使用 graph.camera.springConfig
  const camConfig = (() => {
    const cfg = graph.camera?.springConfig;

    // 极致凌厉调校：Stiffness 1800 配合 85 阻尼，提供瞬间位移感
    const fallback = { stiffness: 1800, damping: 85 };

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
  let state: ExtendedCameraState;
  let currentT: number;

  if (incrementalCache && t >= incrementalCache.lastT) {
    // 增量模式：从上次位置继续
    state = { ...incrementalCache.state };
    currentT = incrementalCache.lastT;
    lastMouseIdx = incrementalCache.mouseIdx;

    // 重点：如果是增量模式的第一帧（t=0 或第一次积分），确保位置从首帧开始而非中心点
    if (currentT === 0 && mouseEvents.length > 0) {
      state.mx = mouseEvents[0].x;
      state.my = mouseEvents[0].y;
    }
  } else {
    // 非增量模式或时间回退：从头开始
    const firstMouse = mouseEvents[0];
    state = {
      t: 0,
      cx: 0.5,
      cy: 0.5,
      scale: 1.0,
      vx: 0,
      vy: 0,
      vs: 0,
      mx: firstMouse ? firstMouse.x : 0.5,
      my: firstMouse ? firstMouse.y : 0.5,
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

    // 1. 镜头意图与桥接优化 (Bridging)
    // 场景：当两个缩放块挨得很近时，中间会产生一个瞬间回到 1.0x 的“空隙”。
    // 这会导致镜头目标在 (x, y, 1.0) 和 (next_x, next_y, 2.0) 之间剧烈抖动。
    // 方案：如果当前是 1.0x（准备回归），但 80ms 内有下一个放大意愿，则进行“桥接插值”。
    const BRIDGE_MS = 80;
    const nextIdx = intents.findIndex(i => i.t > currentT);
    const next = intents[nextIdx];

    let targetScale = active.targetScale;
    let targetCx = active.targetCx;
    let targetCy = active.targetCy;

    if (active.targetScale <= 1.01 && next && next.targetScale > 1.01) {
      const waitTime = next.t - currentT;
      if (waitTime < BRIDGE_MS) {
        // 处于桥接区：计算桥接比例 (0.0 -> 1.0)
        const t_ratio = 1.0 - (waitTime / BRIDGE_MS);
        // 使用简单的 ease-in-out 让桥接更自然
        const ease_ratio = t_ratio * t_ratio * (3 - 2 * t_ratio);

        targetScale = 1.0 + (next.targetScale - 1.0) * ease_ratio;
        targetCx = active.targetCx + (next.targetCx - active.targetCx) * ease_ratio;
        targetCy = active.targetCy + (next.targetCy - active.targetCy) * ease_ratio;
      }
    }

    // 2. 鼠标物理计算
    if (rawMouse) {
      if (isInstantMouse) {
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

    // 3. 镜头跟随与自动对焦
    const isManualZooming = targetScale > 1.01;

    // 自动缩放激活条件：全局开关开启 + 当前非手动缩放时段 + 鼠标存在
    if (graph.autoZoom && !isManualZooming && rawMouse) {
      targetScale = AUTO_ZOOM_SCALE;
    }

    if (targetScale > 1.01 && rawMouse) {
      const marginX = 0.5 / targetScale;
      const marginY = 0.5 / targetScale;

      const left = targetCx - DEADZONE_W;
      const right = targetCx + DEADZONE_W;
      const top = targetCy - DEADZONE_H;
      const bottom = targetCy + DEADZONE_H;

      if (rawMouse.x < left) targetCx = rawMouse.x + DEADZONE_W;
      else if (rawMouse.x > right) targetCx = rawMouse.x - DEADZONE_W;

      if (rawMouse.y < top) targetCy = rawMouse.y + DEADZONE_H;
      else if (rawMouse.y > bottom) targetCy = rawMouse.y - DEADZONE_H;

      targetCx = Math.max(marginX, Math.min(1 - marginX, targetCx));
      targetCy = Math.max(marginY, Math.min(1 - marginY, targetCy));
    } else if (!isManualZooming) {
      targetCx = 0.5;
      targetCy = 0.5;
    }

    // 3. 镜头物理 (Scale 与 Position 异步，创造高级电影感)

    // --- Scale 物理优化 ---
    // 刚度倍率统一拉升，追求瞬时响应
    const currentScaleStiffness = camConfig.stiffness * 2.0;
    const currentScaleDamping = 2 * Math.sqrt(currentScaleStiffness);

    const fS =
      -currentScaleStiffness * (state.scale - targetScale) -
      currentScaleDamping * state.vs;
    state.vs += fS * factor;
    state.scale += state.vs * factor;

    // --- Position 物理优化 ---
    // 100% 同步：位移与倍率完全同频，消除任何肉眼可见的先后滞后感
    const posStiffness = currentScaleStiffness;
    const posDamping = currentScaleDamping;

    const fX =
      -posStiffness * (state.cx - targetCx) -
      posDamping * (state.vx || 0);
    state.vx = (state.vx || 0) + fX * factor;
    state.cx += (state.vx || 0) * factor;

    const fY =
      -posStiffness * (state.cy - targetCy) -
      posDamping * (state.vy || 0);
    state.vy = (state.vy || 0) + fY * factor;
    state.cy += (state.vy || 0) * factor;

    // --- 核心修复：实时几何软约束 (Dynamic Geometric Clamping) ---
    // 确保 state.cx/cy 永远在当前 state.scale 下的合法范围内。
    // 逻辑：可见区域的左边界 cx - 0.5/scale 必须 >= 0，右边界 cx + 0.5/scale 必须 <= 1
    // 这能彻底杜绝因为物理异步/惯性导致画面露出黑色底板的问题。
    const safeMarginX = 0.5 / Math.max(1.0, state.scale);
    const safeMarginY = 0.5 / Math.max(1.0, state.scale);

    const clampedCx = Math.max(safeMarginX, Math.min(1 - safeMarginX, state.cx));
    const clampedCy = Math.max(safeMarginY, Math.min(1 - safeMarginY, state.cy));

    // 如果发生了截断，说明物理系统试图越界，同步重置速度以防止“弹跳”手感
    if (clampedCx !== state.cx) state.vx = 0;
    if (clampedCy !== state.cy) state.vy = 0;

    state.cx = clampedCx;
    state.cy = clampedCy;

    currentT = nextT;
  }

  // ============ 更新增量缓存 ============
  if (incrementalCache) {
    incrementalCache.lastT = t;
    incrementalCache.state = { ...state };
    incrementalCache.mouseIdx = lastMouseIdx;
  }

  return {
    t: t,
    cx: state.cx,
    cy: state.cy,
    scale: state.scale,
    vx: state.vx || 0,
    vy: state.vy || 0,
    vScale: state.vs || 0,
    mx: state.mx,
    my: state.my,
    mvx: state.mvx,
    mvy: state.mvy,
    vs: state.vs,
  };
}
