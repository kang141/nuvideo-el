import { useEffect, useRef, RefObject, useState } from 'react';
import { EDITOR_CANVAS_SIZE } from '../../constants/editor';
import { RenderGraph } from '../../types';
import { computeCameraState } from '../../core/camera-solver';

interface UseVideoRendererOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  renderGraph: RenderGraph;
  bgCategory: string;
  bgFile: string;
}

export function useVideoRenderer({
  videoRef,
  canvasRef,
  renderGraph,
  bgCategory,
  bgFile,
}: UseVideoRendererOptions) {
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isFirstLoadRef = useRef(true);
  const rafRef = useRef<number>();

  // 加载背景图
  useEffect(() => {
    const img = new Image();
    img.src = `/backgrounds/${bgCategory}/${bgFile}`;
    img.onload = () => {
      bgImageRef.current = img;
      if (isFirstLoadRef.current) {
        setIsReady(true);
        isFirstLoadRef.current = false;
      }
    };
  }, [bgCategory, bgFile]);

  // 核心渲染逻辑 (可重复调用)
  // 注意：调用前需确保 canvas.width/height 已正确设置
  const renderFrame = (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !bgImageRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width: W, height: H } = EDITOR_CANVAS_SIZE;

    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // --- A. 基础背景 ---
    ctx.drawImage(bgImageRef.current, 0, 0, W, H);

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
      drawSmoothMouse(ctx, mx, my, renderGraph, timestampMs);
    }
    ctx.restore();

    // --- D. 窗口阴影边框 ---
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // 渲染循环 (仅在播放时或空闲时运行)
  useEffect(() => {
    if (!isReady) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = EDITOR_CANVAS_SIZE.width;
      canvas.height = EDITOR_CANVAS_SIZE.height;
    }

    const render = () => {
      const video = videoRef.current;
      if (video) {
        renderFrame(video.currentTime * 1000);
      }
      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, videoRef, canvasRef, renderGraph]);

  // --- 光标路径预设 ---
  const CURSORS = {
    macOS: new Path2D('M0,0 L0,18.5 L5,14 L9,22 L11.5,21 L7.5,13.5 L13,13.5 Z'),
    Circle: null // 圆形直接画 arc 效率更高
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
    
    // --- A. 点击涟漪效果 (Ripple) ---
    if (showRipple) {
      const age = t - lastDownT;
      if (age >= 0 && age < 600) {
          const progress = age / 600;
          const opacity = Math.pow(1 - progress, 2);
          const radius = progress * size * 1.5; // 基于光标大小
          
          ctx.beginPath();
          ctx.arc(mx, my, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.5})`;
          ctx.lineWidth = 3 * (1 - progress);
          ctx.stroke();
      }
    }

    // --- B. 绘制光标 ---
    const clickScale = isDown ? 0.85 : 1.0;
    const visualSize = size * clickScale;
    
    ctx.translate(mx, my);
    
    if (style === 'Circle') {
      // 简约圆形
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
      // macOS 指针 (Path2D)
      const path = CURSORS.macOS;
      // 默认路径大概是 22px 高，我们需要缩放它
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

  return { isReady, renderFrame };
}
