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
  const vfcRef = useRef<number | null>(null);
  const videoSizeRef = useRef({ width: 1920, height: 1080 });

  // 离屏 Canvas 用于缓存静态层（背景 + 阴影窗口背景）
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // 绘制/刷新离屏静态层
  const updateOffscreen = (vw: number, vh: number) => {
    if (!bgImageRef.current) return;
    
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
      offscreenRef.current.width = EDITOR_CANVAS_SIZE.width;
      offscreenRef.current.height = EDITOR_CANVAS_SIZE.height;
    }

    const img = bgImageRef.current;
    const canvas = offscreenRef.current;
    const oCtx = canvas.getContext('2d');
    if (!oCtx) return;

    const { width: W, height: H } = EDITOR_CANVAS_SIZE;
    oCtx.clearRect(0, 0, W, H);
    
    // 1. 绘制底图
    oCtx.drawImage(img, 0, 0, W, H);
    
    // 2. 根据视频比例计算布局并绘制窗口阴影 + 黑底
    const layout = calculateLayout(W, H, vw, vh);
    const { dx, dy, dw, dh, r } = layout;

    oCtx.save();
    oCtx.shadowColor = 'rgba(0,0,0,0.6)';
    oCtx.shadowBlur = 60;
    oCtx.shadowOffsetY = 30;
    oCtx.fillStyle = '#111'; // 使用接近全黑的深灰色作为窗口底色
    oCtx.beginPath();
    oCtx.roundRect(dx, dy, dw, dh, r);
    oCtx.fill();
    oCtx.restore();
  };

  // 加载背景图
  useEffect(() => {
    const img = new Image();
    img.src = `/backgrounds/${bgCategory}/${bgFile}`;
    img.onload = () => {
      bgImageRef.current = img;
      updateOffscreen(videoSizeRef.current.width, videoSizeRef.current.height);

      if (isFirstLoadRef.current) {
        setIsReady(true);
        isFirstLoadRef.current = false;
      }
      
      const video = videoRef.current;
      if (video) requestAnimationFrame(() => renderFrame(video.currentTime * 1000));
    };
  }, [bgCategory, bgFile]);

  // 监听视频元数据变化
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        videoSizeRef.current = { width: video.videoWidth, height: video.videoHeight };
        updateOffscreen(video.videoWidth, video.videoHeight);
        // 元数据加载后强制刷新一帧
        requestAnimationFrame(() => renderFrame(video.currentTime * 1000));
      }
    };

    video.addEventListener('loadedmetadata', onMetadata);
    if (video.readyState >= 1) onMetadata();

    return () => video.removeEventListener('loadedmetadata', onMetadata);
  }, [videoRef, isReady]);

  // 辅助函数：计算布局
  const calculateLayout = (W: number, H: number, videoW: number, videoH: number) => {
    const videoAspect = videoW / videoH;
    const canvasAspect = W / H;
    let dw: number, dh: number;
    if (videoAspect > canvasAspect) {
      dw = W * 0.85;
      dh = dw / videoAspect;
    } else {
      dh = H * 0.85;
      dw = dh * videoAspect;
    }
    return {
      dw, dh,
      dx: (W - dw) / 2,
      dy: (H - dh) / 2,
      r: 32
    };
  };

  // 核心渲染逻辑 (可重复调用)
  // 注意：调用前需确保 canvas.width/height 已正确设置
  const renderFrame = (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width: W, height: H } = EDITOR_CANVAS_SIZE;
    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    // --- A. 绘制预渲染的背景层 ---
    ctx.drawImage(offscreenRef.current, 0, 0);

    // --- B. 动态布局 ---
    const { dx, dy, dw, dh, r } = calculateLayout(W, H, video.videoWidth || 1920, video.videoHeight || 1080);

    // --- C. 内容层 ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.clip();
    
    // 内容变换
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.scale(s, s);
    ctx.translate(-camera.cx * dw, -camera.cy * dh);

    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, dw, dh);
      drawSmoothMouse(ctx, camera.mx * dw, camera.my * dh, renderGraph, timestampMs);
    }
    ctx.restore();

    // --- D. 窗口阴影边框 ---
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // 预览渲染：用 requestVideoFrameCallback 绑定到“真实显示帧”的 mediaTime，避免播放时光标抖动/重影。
  useEffect(() => {
    if (!isReady) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = EDITOR_CANVAS_SIZE.width;
      canvas.height = EDITOR_CANVAS_SIZE.height;
    }

    const video = videoRef.current;
    if (!video) return;

    let stopped = false;

    const renderFromCurrentTime = () => {
      if (stopped) return;
      renderFrame(video.currentTime * 1000);
    };

    // 暂停/拖动进度条时没有新帧，事件触发时手动重绘一次。
    const onSeeked = () => requestAnimationFrame(renderFromCurrentTime);
    const onPause = () => requestAnimationFrame(renderFromCurrentTime);
    const onLoadedData = () => requestAnimationFrame(renderFromCurrentTime);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadeddata', onLoadedData);

    const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';
    if (hasVfc) {
      const onVfc = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (stopped) return;
        renderFrame(metadata.mediaTime * 1000);
        vfcRef.current = (video as any).requestVideoFrameCallback(onVfc);
      };
      vfcRef.current = (video as any).requestVideoFrameCallback(onVfc);
    } else {
      const tick = () => {
        if (stopped) return;
        renderFromCurrentTime();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    // Initial paint
    requestAnimationFrame(renderFromCurrentTime);

    return () => {
      stopped = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadeddata', onLoadedData);

      if (vfcRef.current != null && typeof (video as any).cancelVideoFrameCallback === 'function') {
        try { (video as any).cancelVideoFrameCallback(vfcRef.current); } catch {}
        vfcRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, videoRef, canvasRef, renderGraph]);

  // --- 光标路径预设 ---
  const CURSORS = {
    macOS: new Path2D('M0,0 L0,18.5 L5,14 L9,22 L11.5,21 L7.5,13.5 L13,13.5 Z'),
    Circle: null, // 圆形直接用 arc 效率更高
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
        const radius = progress * size * 1.5;

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

  return { isReady, renderFrame };
}
