import { RenderGraph } from '../types';
import { computeCameraState } from './camera-solver';

export interface RenderFrameOptions {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  renderGraph: RenderGraph;
  bgImage: HTMLImageElement | null;
  width: number;
  height: number;
  currentTimeMs: number;
}

export function drawFrame({
  ctx,
  video,
  renderGraph,
  bgImage,
  width: W,
  height: H,
  currentTimeMs,
}: RenderFrameOptions) {
  if (!bgImage) return;

  const camera = computeCameraState(renderGraph, currentTimeMs);
  const s = camera.scale;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // --- A. 基础背景 ---
  ctx.drawImage(bgImage, 0, 0, W, H);

  // --- B. 核心布局计算 (1:1 适配录屏比例) ---
  const videoW = video.videoWidth || 1920;
  const videoH = video.videoHeight || 1080;
  const videoAspect = videoW / videoH;
  const canvasAspect = W / H;

  let dw, dh;
  if (videoAspect > canvasAspect) {
    dw = W * 0.85;
    dh = dw / videoAspect;
  } else {
    dh = H * 0.85;
    dw = dh * videoAspect;
  }

  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;
  const r = 32;

  // 1. 绘制容器阴影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, r);
  ctx.fill();
  ctx.restore();

  // --- C. 内容层 ---
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, r);
  ctx.clip();

  ctx.translate(dx, dy);
  ctx.translate(dw / 2, dh / 2);
  ctx.scale(s, s);
  ctx.translate(-camera.cx * dw, -camera.cy * dh);

  if (video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, dw, dh);
    const mx = camera.mx * dw;
    const my = camera.my * dh;
    drawSmoothMouse(ctx, mx, my, renderGraph, currentTimeMs);
  }
  ctx.restore();

  // --- D. 窗口阴影边框 ---
  ctx.beginPath();
  ctx.roundRect(dx, dy, dw, dh, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

const CURSORS = {
  macOS: new Path2D('M0,0 L0,18.5 L5,14 L9,22 L11.5,21 L7.5,13.5 L13,13.5 Z'),
};

function drawSmoothMouse(ctx: CanvasRenderingContext2D, mx: number, my: number, graph: RenderGraph, t: number) {
  const events = graph.mouse;
  const { style, showRipple, size } = graph.mouseTheme;
  if (!events || events.length === 0) return;

  let isDown = false;
  let lastDownT = -9999;
  for (let i = 0; i < events.length; i++) {
    if (events[i].t <= t) {
      if (events[i].type === 'down') {
        isDown = true;
        lastDownT = events[i].t;
      }
      if (events[i].type === 'up') isDown = false;
    } else break;
  }

  ctx.save();

  if (showRipple) {
    const age = t - lastDownT;
    if (age >= 0 && age < 600) {
      const progress = age / 600;
      const opacity = Math.pow(1 - progress, 2);
      const radius = progress * size * 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.5})`;
      ctx.lineWidth = 3 * (1 - progress);
      ctx.stroke();
    }
  }

  const clickScale = isDown ? 0.85 : 1.0;
  const visualSize = size * clickScale;
  ctx.translate(mx, my);

  if (style === 'Circle') {
    ctx.beginPath();
    ctx.arc(0, 0, visualSize / 2, 0, Math.PI * 2);
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    const path = CURSORS.macOS;
    const scale = visualSize / 22;
    ctx.scale(scale, scale);
    ctx.rotate(-Math.PI / 180 * 2);
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowOffsetY = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.fillStyle = isDown ? '#e0e0e0' : 'white';
    ctx.fill(path);
  }
  ctx.restore();
}
