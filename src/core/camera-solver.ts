import { RenderGraph, CameraIntent, MouseEvent as NuMouseEvent } from '../types';

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
function findMousePos(events: NuMouseEvent[], t: number): { x: number, y: number } | null {
  if (!events || events.length === 0) return null;
  
  // 简单的指针搜索，因为 currentT 是单调递增的
  let best = events[0];
  for (let i = lastMouseIdx; i < events.length; i++) {
    if (events[i].t <= t) {
      best = events[i];
      lastMouseIdx = i;
    } else {
      break;
    }
  }
  return { x: best.x, y: best.y };
}

export function computeCameraState(graph: RenderGraph, t: number) {
  const intents = graph.camera.intents || [];
  const mouseEvents = graph.mouse || [];
  lastMouseIdx = 0; // 每次重新模拟重置指针
  
  // 提高刚度，加强“奶油”感和跟随感
  const camConfig = graph.camera.springConfig || { stiffness: 260, damping: 35 };
    const mouseConfig = (() => {
    const sm = graph.mousePhysics.smoothing;
    const stiffness = Math.max(20, 1000 * Math.pow(1 - sm, 1.5));
    const damping = 2 * Math.sqrt(stiffness) * 0.8;
    return { stiffness, damping, maxSpeed: 6.0 };
  })();

  let state: CameraState = {
    cx: 0.5, cy: 0.5, scale: 1.0,
    vx: 0, vy: 0, vs: 0,
    mx: 0.5, my: 0.5, mvx: 0, mvy: 0
  };

  const dt = 16.67; 
  let currentT = 0;
  
  while (currentT < t) {
    const nextT = Math.min(currentT + dt, t);
    const stepDt = nextT - currentT;
    const factor = stepDt / 1000;
    
    const active = findActiveIntent(intents, currentT);
    const rawMouse = findMousePos(mouseEvents, currentT);

    // 1. 鼠标物理
    if (rawMouse) {
      const fMx = -mouseConfig.stiffness * (state.mx - rawMouse.x) - mouseConfig.damping * state.mvx;
      const fMy = -mouseConfig.stiffness * (state.my - rawMouse.y) - mouseConfig.damping * state.mvy;
      state.mvx += fMx * factor;
      state.mvy += fMy * factor;

      const speed = Math.sqrt(state.mvx * state.mvx + state.mvy * state.mvy);
      if (speed > mouseConfig.maxSpeed) {
        state.mvx = (state.mvx / speed) * mouseConfig.maxSpeed;
        state.mvy = (state.mvy / speed) * mouseConfig.maxSpeed;
      }
      state.mx += state.mvx * factor;
      state.my += state.mvy * factor;
    }

    // 2. 镜头跟随（核心点）
    const targetScale = active.targetScale;
    let targetCx = state.cx; 
    let targetCy = state.cy;

    if (targetScale > 1.01 && rawMouse) {
      // 获取当前可视半径 (0.5 / scale)
      const marginX = 0.5 / targetScale;
      const marginY = 0.5 / targetScale;

      // 如果鼠标跑出了当前的 DEADZONE 框
      const left = state.cx - DEADZONE_W;
      const right = state.cx + DEADZONE_W;
      const top = state.cy - DEADZONE_H;
      const bottom = state.cy + DEADZONE_H;

      if (rawMouse.x < left) targetCx = rawMouse.x + DEADZONE_W;
      else if (rawMouse.x > right) targetCx = rawMouse.x - DEADZONE_W;

      if (rawMouse.y < top) targetCy = rawMouse.y + DEADZONE_H;
      else if (rawMouse.y > bottom) targetCy = rawMouse.y - DEADZONE_H;

      // 强制边界约束：绝对杜绝黑边
      targetCx = Math.max(marginX, Math.min(1 - marginX, targetCx));
      targetCy = Math.max(marginY, Math.min(1 - marginY, targetCy));
    } else {
      targetCx = 0.5; targetCy = 0.5;
    }

    // 3. 镜头物理
    const fS = -camConfig.stiffness * (state.scale - targetScale) - camConfig.damping * state.vs;
    state.vs += fS * factor;
    state.scale += state.vs * factor;

    const fX = -camConfig.stiffness * (state.cx - targetCx) - camConfig.damping * state.vx;
    state.vx += fX * factor;
    state.cx += state.vx * factor;

    const fY = -camConfig.stiffness * (state.cy - targetCy) - camConfig.damping * state.vy;
    state.vy += fY * factor;
    state.cy += state.vy * factor;

    currentT = nextT;
  }

  return { cx: state.cx, cy: state.cy, scale: state.scale, mx: state.mx, my: state.my };
}
