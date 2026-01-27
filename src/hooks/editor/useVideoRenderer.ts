import { useEffect, useRef, RefObject, useState } from 'react';
import { EDITOR_CANVAS_SIZE } from '../../constants/editor';
import { RenderGraph } from '../../types';
import { computeCameraState } from '../../core/camera-solver';
import { VideoFrameManager } from '../../core/video-decoder';

interface UseVideoRendererOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  renderGraph: RenderGraph;
  bgCategory: string;
  bgFile: string;
  isExporting?: boolean;
}

export function useVideoRenderer({
  videoRef,
  canvasRef,
  renderGraph,
  bgCategory,
  bgFile,
  isExporting = false,
}: UseVideoRendererOptions) {
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isFirstLoadRef = useRef(true);
  const rafRef = useRef<number>();
  const vfcRef = useRef<number | null>(null);
  const videoSizeRef = useRef({ width: 1920, height: 1080 });
  const layoutRef = useRef({ dx: 0, dy: 0, dw: 0, dh: 0, r: 32 });
  const frameManagerRef = useRef<VideoFrameManager | null>(null);
  const lastDrawnTsRef = useRef<number>(-1);

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
    layoutRef.current = layout; // 缓存布局
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
    img.src = `asset://backgrounds/${bgCategory}/${bgFile}`;
    img.onload = () => {
      bgImageRef.current = img;
      updateOffscreen(videoSizeRef.current.width, videoSizeRef.current.height);

      if (isFirstLoadRef.current) {
        setIsReady(true);
        isFirstLoadRef.current = false;
      }

      const video = videoRef.current;
      if (video) requestAnimationFrame(() => void renderFrame(video.currentTime * 1000));
    };
  }, [bgCategory, bgFile]);

  // 启动 WebCodecs FrameManager
  useEffect(() => {
    const videoSource = renderGraph.videoSource;
    if (!videoSource) return;

    const manager = new VideoFrameManager();
    frameManagerRef.current = manager;

    manager.initialize(videoSource).then(() => {
      // 解码器就绪后，我们可能需要根据视频实际尺寸更新布局
      // 注意：WebCodecs 解码器加载后会自动解析尺寸
      console.log('[useVideoRenderer] WebCodecs Manager initialized');
    });

    return () => {
      manager.destroy();
      frameManagerRef.current = null;
    };
  }, [renderGraph.videoSource]);

  // 监听视频元数据变化 (保持兼容性，用于获取尺寸和初始触发)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        videoSizeRef.current = { width: video.videoWidth, height: video.videoHeight };
        updateOffscreen(video.videoWidth, video.videoHeight);
        requestAnimationFrame(() => void renderFrame(video.currentTime * 1000));
      }
    };

    video.addEventListener('loadedmetadata', onMetadata);
    if (video.readyState >= 1) onMetadata();

    return () => video.removeEventListener('loadedmetadata', onMetadata);
  }, [videoRef, isReady, renderGraph.videoSource]);

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
  const renderFrame = async (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    // --- A. 绘制预渲染的背景层 ---
    ctx.drawImage(offscreenRef.current, 0, 0);

    // --- B. 使用缓存的动态布局 ---
    const { dx, dy, dw, dh, r } = layoutRef.current;

    // --- C. 内容层 ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.clip();

    // 内容变换
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.scale(s, s);
    ctx.translate(-camera.cx * dw, -camera.cy * dh);

    // --- WebCodecs 核心渲染逻辑 ---
    const manager = frameManagerRef.current;
    if (manager) {
      const requestedTs = timestampMs;

      try {
        const frame = await manager.getFrame(requestedTs);
        const isStale = requestedTs < lastDrawnTsRef.current;
        if (!isStale) {
          if (frame) {
            // translate/clip 已经处理了坐标系，这里从 0, 0 开始画
            ctx.drawImage(frame, 0, 0, dw, dh);
            lastDrawnTsRef.current = requestedTs;
          } else if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, dw, dh);
          }
        }

        // 无论帧是否过期，鼠标都要画出来，避免闪烁/消失
        drawSmoothMouse(ctx, camera.mx * dw, camera.my * dh, dw, dh, renderGraph, timestampMs);
      } catch {
        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, dw, dh);
          drawSmoothMouse(ctx, camera.mx * dw, camera.my * dh, dw, dh, renderGraph, timestampMs);
        }
      }
    } else if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, dw, dh);
      drawSmoothMouse(ctx, camera.mx * dw, camera.my * dh, dw, dh, renderGraph, timestampMs);
    }
    ctx.restore();

    // --- D. 窗口阴影边框 ---
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // 预览渲染
  useEffect(() => {
    if (!isReady || isExporting) return;

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
      void renderFrame(video.currentTime * 1000);
    };

    // 暂停/拖动进度条时没有新帧，事件触发时手动重绘一次。
    const onSeeked = () => requestAnimationFrame(renderFromCurrentTime);
    const onPause = () => requestAnimationFrame(renderFromCurrentTime);
    const onLoadedData = () => requestAnimationFrame(renderFromCurrentTime);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadeddata', onLoadedData);

    // 优先使用 requestVideoFrameCallback (rVFC) 以获得完美的帧同步和性能
    // 这避免了 "卡卡的感觉" (Jitter)，即 RAF 和视频刷新率不匹配导致的问题
    const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';
    if (hasVfc) {
      const onVfc = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (stopped) return;
        void renderFrame(metadata.mediaTime * 1000);
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
        try { (video as any).cancelVideoFrameCallback(vfcRef.current); } catch { }
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

  function drawSmoothMouse(ctx: CanvasRenderingContext2D, mx: number, my: number, dw: number, dh: number, graph: RenderGraph, t: number) {
    const events = graph.mouse;
    const { style, showRipple, size } = graph.mouseTheme;
    if (!events || events.length === 0) return;

    let isDown = false;

    // --- A. 点击涟漪效果 (Ripple) ---
    // 遍历所有事件以支持多重涟漪 (Rapid Fire)
    // 并且使用事件本身的坐标 (Fixed Position) 而非跟随鼠标
    ctx.save();

    if (showRipple) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.t > t) break; // 已超过当前时间

        if (ev.type === 'down') {
          isDown = true;

          const age = t - ev.t;
          if (age >= 0 && age < 600) {
            const progress = age / 600;
            const opacity = Math.pow(1 - progress, 2);
            const r = progress * size * 1.5;

            // 事件坐标归一化转换到当前画布尺寸
            const rx = ev.x * dw;
            const ry = ev.y * dh;

            ctx.beginPath();
            ctx.arc(rx, ry, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.5})`;
            ctx.lineWidth = 3 * (1 - progress);
            ctx.stroke();
          }
        } else if (ev.type === 'up') {
          isDown = false;
        }
      }
    } else {
      // 如果不显示涟漪，为了计算 isDown 状态仍需遍历
      for (let i = 0; i < events.length; i++) {
        if (events[i].t > t) break;
        if (events[i].type === 'down') isDown = true;
        if (events[i].type === 'up') isDown = false;
      }
    }

    ctx.restore(); // 恢复 context 以绘制光标（防止上面的样式污染）

    // --- B. 绘制光标 (Cursor) ---
    ctx.save(); // 重新 save 为光标绘制

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
