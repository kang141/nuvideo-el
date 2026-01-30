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
  const macButtonsRef = useRef<HTMLImageElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isFirstLoadRef = useRef(true);
  const rafRef = useRef<number>();
  const vfcRef = useRef<number | null>(null);
  const videoSizeRef = useRef({ width: 1920, height: 1080 });
  const layoutRef = useRef({ dx: 0, dy: 0, dw: 0, dh: 0, totalW: 0, totalH: 0, r: 16 });
  const frameManagerRef = useRef<VideoFrameManager | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastDrawnTsRef = useRef<number>(-1);
  // Webcam 帧缓存备份，防止 seek 时的黑屏闪烁
  const webcamCacheRef = useRef<HTMLCanvasElement | null>(null);

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

    // 2. 根据视频比例计算布局并绘制窗口阴影 + 窗口主体
    const layout = calculateLayout(W, H, vw, vh);
    layoutRef.current = layout; 
    const { dx, dy, totalW, totalH, r } = layout;

    oCtx.save();
    oCtx.shadowColor = 'rgba(0,0,0,0.6)';
    oCtx.shadowBlur = 60;
    oCtx.shadowOffsetY = 30;
    oCtx.fillStyle = '#1e1e1e'; // 专业深色座舱
    oCtx.beginPath();
    oCtx.roundRect(dx, dy, totalW, totalH, r);
    oCtx.fill();
    oCtx.restore();
  };

  // 加载背景图与窗口装饰
  useEffect(() => {
    // 加载控制按钮 SVG
    const btnImg = new Image();
    btnImg.src = '/window-controls.svg';
    btnImg.onload = () => { macButtonsRef.current = btnImg; };

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

  // 初始化隐藏的 Webcam 视频播放器 (直接使用原生 Video 以支持 WebM)
  useEffect(() => {
    const webcamSource = renderGraph.webcamSource;
    if (!webcamSource) {
      webcamVideoRef.current = null;
      return;
    }

    const video = document.createElement('video');
    video.src = webcamSource;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    webcamVideoRef.current = video;

    // 状态同步逻辑：让摄像头播放器跟随主视频状态
    const mainVideo = videoRef.current;
    
    const syncState = () => {
      if (!mainVideo || !video) return;
      video.playbackRate = mainVideo.playbackRate;
      if (mainVideo.paused && !video.paused) video.pause();
      if (!mainVideo.paused && video.paused) video.play().catch(() => {});
    };

    if (mainVideo) {
      mainVideo.addEventListener('play', syncState);
      mainVideo.addEventListener('pause', syncState);
      mainVideo.addEventListener('ratechange', syncState);
      // 初始化状态
      syncState();
    }

    console.log('[useVideoRenderer] Webcam native player initialized:', webcamSource);

    return () => {
      if (mainVideo) {
        mainVideo.removeEventListener('play', syncState);
        mainVideo.removeEventListener('pause', syncState);
        mainVideo.removeEventListener('ratechange', syncState);
      }
      video.pause();
      video.src = '';
      video.load();
      webcamVideoRef.current = null;
    };
  }, [renderGraph.webcamSource, videoRef]);

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

  // 辅助函数：计算布局 (简约专业风：不留边黑框)
  const calculateLayout = (W: number, H: number, videoW: number, videoH: number) => {
    const TB_H = 34;   // 稍微压缩标题栏高度
    const videoAspect = videoW / videoH;
    const padding = 0.85;
    
    let dw = W * padding;
    let dh = dw / videoAspect;
    
    // 检查总高度是否超限
    if (dh + TB_H > H * padding) {
      dh = H * padding - TB_H;
      dw = dh * videoAspect;
    }

    const totalW = dw;
    const totalH = dh + TB_H; 

    return {
      dw, dh, totalW, totalH,
      dx: (W - totalW) / 2,
      dy: (H - totalH) / 2,
      r: 16
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

    // --- A. 绘制预渲染的背景层 (保持静止以防止漏黑) ---
    ctx.save();
    ctx.drawImage(offscreenRef.current, 0, 0);
    ctx.restore();

    // --- B. 布局参数 ---
    const TB_H = 34;
    const { dx, dy, dw, dh, totalW, totalH, r } = layoutRef.current;

    // --- C. 窗口装饰与剪裁 ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, totalW, totalH, r);
    ctx.clip();

    // 1. 窗口主体色
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(dx, dy, totalW, totalH);

    // 2. 专业深色标题栏渐变
    const headerGradient = ctx.createLinearGradient(dx, dy, dx, dy + TB_H);
    headerGradient.addColorStop(0, '#333333');
    headerGradient.addColorStop(1, '#252525');
    ctx.fillStyle = headerGradient;
    ctx.fillRect(dx, dy, totalW, TB_H);

    // 3. 绘制中间占位文本 (极致低调)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = 'bold 9px "Inter", "SF Pro Display", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1px';

    // 4. 绘制控制按钮 (红黄绿)
    if (macButtonsRef.current) {
      const btnW = 32;
      const btnH = btnW * (12 / 40);
      const btnX = dx + 12; 
      const btnY = dy + (TB_H - btnH) / 2;
      ctx.drawImage(macButtonsRef.current, btnX, btnY, btnW, btnH);
    }

    // --- 增加 Mac 风格功能内容 ---
    ctx.save();
    
    // 5. 绘制后退前进按钮 ( < > )
    const navX = dx + 64;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // < 按钮
    ctx.beginPath();
    ctx.moveTo(navX, dy + TB_H/2 - 4);
    ctx.lineTo(navX - 4, dy + TB_H/2);
    ctx.lineTo(navX, dy + TB_H/2 + 4);
    ctx.stroke();
    
    // > 按钮
    ctx.beginPath();
    ctx.moveTo(navX + 16, dy + TB_H/2 - 4);
    ctx.lineTo(navX + 20, dy + TB_H/2);
    ctx.lineTo(navX + 16, dy + TB_H/2 + 4);
    ctx.stroke();

    // 6. 中央地址栏 (Search/URL Bar)
    const barW = Math.min(totalW * 0.45, 400); // 居中且限宽
    const barH = 20;
    const barX = dx + (totalW - barW) / 2;
    const barY = dy + (TB_H - barH) / 2;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();
    
    // 地址栏内的微小“锁”图标 (Security Icon)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.font = '10px "Inter"';
    ctx.fillText('🔒 nuvideo.dev', barX + barW / 2, barY + barH / 2 + 1);

    // 7. 右侧功能图标阵列 (Share, Plus, Search)
    const iconBaseX = dx + totalW - 24;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    
    // 放大镜图标
    ctx.beginPath();
    ctx.arc(iconBaseX - 40, dy + TB_H/2, 3, 0, Math.PI * 2);
    ctx.moveTo(iconBaseX - 38, dy + TB_H/2 + 2);
    ctx.lineTo(iconBaseX - 36, dy + TB_H/2 + 4);
    ctx.stroke();
    
    // 加号图标
    ctx.beginPath();
    ctx.moveTo(iconBaseX - 20, dy + TB_H/2 - 4);
    ctx.lineTo(iconBaseX - 20, dy + TB_H/2 + 4);
    ctx.moveTo(iconBaseX - 24, dy + TB_H/2);
    ctx.lineTo(iconBaseX - 16, dy + TB_H/2);
    ctx.stroke();
    
    // 更多图标
    ctx.beginPath();
    ctx.arc(iconBaseX, dy + TB_H/2 - 6, 1, 0, Math.PI * 2);
    ctx.arc(iconBaseX, dy + TB_H/2, 1, 0, Math.PI * 2);
    ctx.arc(iconBaseX, dy + TB_H/2 + 6, 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // 5. 视频内容层 (边到边)
    const videoX = dx;
    const contentY = dy + TB_H;
    
    // 6. 裁剪视频区域
    ctx.save();
    ctx.beginPath();
    ctx.rect(videoX, contentY, dw, dh);
    ctx.clip();

    // 修正变换中心点
    ctx.translate(videoX + dw / 2, contentY + dh / 2);
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
            ctx.drawImage(frame, 0, 0, dw, dh);
            lastDrawnTsRef.current = requestedTs;
          } else if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, dw, dh);
          }
        }
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

    ctx.restore(); // 视频层
    ctx.restore(); // 窗口 clip

    // --- D. 窗口细节描边 (极致简约) ---
    ctx.beginPath();
    ctx.roundRect(dx, dy, totalW, totalH, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 标题栏底部分界线
    ctx.beginPath();
    ctx.moveTo(dx, dy + TB_H);
    ctx.lineTo(dx + totalW, dy + TB_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();

    // --- F. 摄像头画中画 (Webcam PiP) 层 ---
    const webcamVideo = webcamVideoRef.current;
    if (webcamVideo && renderGraph.webcamSource && renderGraph.webcam?.isEnabled) {
      const targetTimeSec = timestampMs / 1000;
      const drift = Math.abs(webcamVideo.currentTime - targetTimeSec);
      
      // 优化同步策略：
      // 1. 导出模式必须硬同步
      // 2. 只有当偏差较大（播放时 > 0.3s，暂停时 > 0.05s）才触发 seek，防止频繁 seek 导致的 ReadyState 降级
      const syncThreshold = (isExporting || video.paused) ? 0.05 : 0.3;
      const needsHardSync = drift > syncThreshold && !webcamVideo.seeking;

      if (needsHardSync) {
        // 边界检查，防止 seek 到超限位置
        const duration = webcamVideo.duration;
        const safeTarget = isFinite(duration) ? Math.min(targetTimeSec, duration - 0.01) : targetTimeSec;
        webcamVideo.currentTime = Math.max(0, safeTarget);
      }

      // 准备缓存画布
      if (!webcamCacheRef.current) {
        webcamCacheRef.current = document.createElement('canvas');
      }

      const cacheCanvas = webcamCacheRef.current;
      const isReady = webcamVideo.readyState >= 2;

      // 如果当前视频帧就绪，则更新备份缓存
      if (isReady && webcamVideo.videoWidth > 0) {
        if (cacheCanvas.width !== webcamVideo.videoWidth) {
           cacheCanvas.width = webcamVideo.videoWidth;
           cacheCanvas.height = webcamVideo.videoHeight;
        }
        const cacheCtx = cacheCanvas.getContext('2d');
        cacheCtx?.drawImage(webcamVideo, 0, 0);
      }

      // 只要有任何可用的图像（当前帧或备份缓存），就执行绘制
      if (isReady || (cacheCanvas.width > 0)) {
        // PiP 布局配置 (Screen Studio 风格)
        const pipSize = renderGraph.webcam?.size ?? 360; 
        const padding = 60;   
        const px = EDITOR_CANVAS_SIZE.width - pipSize/2 - padding;
        const py = EDITOR_CANVAS_SIZE.height - pipSize/2 - padding;

        ctx.save();
        
        // --- 绘制流程 (同一套逻辑应用于当前帧或缓存) ---
        const drawPip = (source: CanvasImageSource) => {
          // 1. 阴影
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 40;
          ctx.shadowOffsetY = 15;
          ctx.beginPath();
          if (renderGraph.webcam?.shape === 'rect') {
            ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
          } else {
            ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.shadowColor = 'transparent';

          // 2. 裁切
          ctx.save();
          ctx.beginPath();
          if (renderGraph.webcam?.shape === 'rect') {
            ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
          } else {
            ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
          }
          ctx.clip();

          // 3. 画面
          ctx.translate(px, py);
          ctx.scale(-1, 1);
          
          const vw = isReady ? webcamVideo.videoWidth : cacheCanvas.width;
          const vh = isReady ? webcamVideo.videoHeight : cacheCanvas.height;
          const minSide = Math.min(vw, vh);
          const sx = (vw - minSide) / 2;
          const sy = (vh - minSide) / 2;

          ctx.drawImage(
            source, 
            sx, sy, minSide, minSide,
            -pipSize/2, -pipSize/2, pipSize, pipSize
          );
          ctx.restore();

          // 4. 边框
          ctx.beginPath();
          if (renderGraph.webcam?.shape === 'rect') {
            ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
          } else {
            ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 3;
          ctx.stroke();
        };

        // 优先绘制当前实时帧，否则使用缓存帧备选
        drawPip(isReady ? webcamVideo : cacheCanvas);
        ctx.restore();
      }
    }
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
