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
  const webcamFrameManagerRef = useRef<VideoFrameManager | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  // 核心修复：视频帧缓存备份，彻底消除 seek 时的黑屏闪烁
  const mainVideoCacheRef = useRef<HTMLCanvasElement | null>(null); 
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

    const canvas = offscreenRef.current;
    const oCtx = canvas.getContext('2d');
    if (!oCtx) return;

    const { width: W, height: H } = EDITOR_CANVAS_SIZE;
    oCtx.clearRect(0, 0, W, H);

    // 1. 导出模式下必须在 Canvas 中绘制背景图，否则最终视频将是黑底
    if (isExporting && bgImageRef.current) {
       oCtx.drawImage(bgImageRef.current, 0, 0, W, H);
    }

    // 2. 根据视频比例计算布局并绘制窗口阴影 + 窗口主体
    const layout = calculateLayout(W, H, vw, vh);
    layoutRef.current = layout; 
    const { dx, dy, totalW, totalH, r } = layout;

    oCtx.save();
    oCtx.shadowColor = 'rgba(0,0,0,0.6)';
    oCtx.shadowBlur = 60;
    oCtx.shadowOffsetY = 30;
    oCtx.fillStyle = '#1e1e1e';
    oCtx.beginPath();
    oCtx.roundRect(dx, dy, totalW, totalH, r);
    oCtx.fill();
    oCtx.restore();

    // 3. 预渲染浏览器边框与标题栏 (原本在 renderFrame 中，非常耗时)
    const TB_H = 34;
    const headerGradient = oCtx.createLinearGradient(dx, dy, dx, dy + TB_H);
    headerGradient.addColorStop(0, '#333333');
    headerGradient.addColorStop(1, '#252525');
    oCtx.fillStyle = headerGradient;
    oCtx.beginPath();
    oCtx.roundRect(dx, dy, totalW, TB_H, [r, r, 0, 0]);
    oCtx.fill();

    if (macButtonsRef.current) {
      const btnW = 32;
      const btnH = btnW * (12 / 40);
      oCtx.drawImage(macButtonsRef.current, dx + 12, dy + (TB_H - btnH) / 2, btnW, btnH);
    }

    // 绘制地址栏装饰
    const barW = Math.min(totalW * 0.45, 400); 
    const barH = 20;
    const barX = dx + (totalW - barW) / 2;
    const barY = dy + (TB_H - barH) / 2;
    oCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    oCtx.beginPath(); oCtx.roundRect(barX, barY, barW, barH, 4); oCtx.fill();
    oCtx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    oCtx.font = '10px "Inter"'; oCtx.textAlign = 'center';
    oCtx.fillText('🔒 nuvideo.dev', barX + barW / 2, barY + barH / 2 + 1);
    
    // 绘制功能图标
    const navX = dx + 64;
    oCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    oCtx.lineWidth = 1.5;
    oCtx.lineCap = 'round';
    oCtx.beginPath(); 
    oCtx.moveTo(navX, dy + TB_H/2 - 4); oCtx.lineTo(navX - 4, dy + TB_H/2); oCtx.lineTo(navX, dy + TB_H/2 + 4); 
    oCtx.moveTo(navX + 16, dy + TB_H/2 - 4); oCtx.lineTo(navX + 20, dy + TB_H/2); oCtx.lineTo(navX + 16, dy + TB_H/2 + 4); 
    oCtx.stroke();
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
  }, [bgCategory, bgFile, isExporting]); // 增加 isExporting 依赖，确保导出开始时重绘离屏层

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

  // 启动摄像头 WebCodecs FrameManager
  useEffect(() => {
    const webcamSource = renderGraph.webcamSource;
    if (!webcamSource) return;

    const manager = new VideoFrameManager();
    webcamFrameManagerRef.current = manager;

    // 注意：摄像头视频通常是 720p 甚至更低，解码压力很小
    manager.initialize(webcamSource).then(() => {
      console.log('[useVideoRenderer] Webcam WebCodecs Manager initialized');
    });

    return () => {
      manager.destroy();
      webcamFrameManagerRef.current = null;
    };
  }, [renderGraph.webcamSource]);

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
    
    // 状态切换同步：处理播放、暂停、速率
    const syncState = () => {
      if (!mainVideo || !video) return;
      video.playbackRate = mainVideo.playbackRate;
      if (mainVideo.paused && !video.paused) video.pause();
      if (!mainVideo.paused && video.paused) video.play().catch(() => {});
    };

    // 强校准：仅在进度拖动或开始播放时对齐时间轴
    const hardSync = (tolerance = 0.1) => {
      if (!mainVideo || !video) return;
      const delay = (renderGraph.webcamDelay || 0) / 1000;
      const targetTime = Math.max(0, mainVideo.currentTime - delay);
      
      // 容差判定：如果偏差过大，执行一次 Seek。
      // 注意：Seek 操作非常昂贵且是同步的，减少它能极大提升播放响应速度。
      if (Math.abs(video.currentTime - targetTime) > tolerance) {
        video.currentTime = targetTime;
      }
      syncState();
    };

    const onPlay = () => hardSync(0.3);
    const onSeeked = () => hardSync(0.1);
    const onRateChange = () => syncState();
    const onPause = () => syncState();

    if (mainVideo) {
      mainVideo.addEventListener('play', onPlay);
      mainVideo.addEventListener('pause', onPause);
      mainVideo.addEventListener('ratechange', onRateChange);
      mainVideo.addEventListener('seeked', onSeeked);
      // 初始化状态
      hardSync(0.1);
    }

    console.log('[useVideoRenderer] Webcam sync optimized (Low-overhead mode)');

    return () => {
      if (mainVideo) {
        mainVideo.removeEventListener('play', onPlay);
        mainVideo.removeEventListener('pause', onPause);
        mainVideo.removeEventListener('ratechange', onRateChange);
        mainVideo.removeEventListener('seeked', onSeeked);
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
  const renderFrame = async (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    
    // 关键修正：必须每一帧手动清空画布，否则由于开启了 alpha 模式且背景由 CSS 提供，
    // 每一帧的绘制都会在上一帧的基础上叠加，导致画面“糊掉”或出现重影。
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const renderGraph = renderGraphRef.current;
    if (!renderGraph) return;

    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    // --- A. 绘制预渲染的背景/窗口层 ---
    ctx.save();
    // 如果正在导出，offscreen 已经包含了壁纸；如果是预览，offscreen 只有窗口装饰
    ctx.drawImage(offscreenRef.current, 0, 0);
    ctx.restore();

    // --- B. 布局参数 ---
    const TB_H = 34;
    const { dx, dy, dw, dh, totalW, totalH, r } = layoutRef.current;

    // --- C. 剪裁内容区 ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, totalW, totalH, r);
    ctx.clip();

    // 视频内容层
    const videoX = dx;
    const contentY = dy + TB_H;
    ctx.save(); ctx.beginPath(); ctx.rect(videoX, contentY, dw, dh); ctx.clip();
    ctx.translate(videoX + dw / 2, contentY + dh / 2);
    ctx.scale(s, s);
    ctx.translate(-camera.cx * dw, -camera.cy * dh);

    const manager = frameManagerRef.current;
    let frameRendered = false;

    // --- 核心性能决策策略 ---
    // 1. 如果正在导出，则必须使用 WebCodecs 解码以保证帧精准度和最高画质
    if (isExporting && manager) {
      try {
        const frame = await manager.getFrame(timestampMs);
        if (frame) {
          ctx.drawImage(frame, 0, 0, dw, dh);
          frameRendered = true;
          // 更新缓存供预览瞬间回退
          if (!mainVideoCacheRef.current) mainVideoCacheRef.current = document.createElement('canvas');
          if (mainVideoCacheRef.current.width !== dw) mainVideoCacheRef.current.width = dw;
          if (mainVideoCacheRef.current.height !== dh) mainVideoCacheRef.current.height = dh;
          mainVideoCacheRef.current.getContext('2d')?.drawImage(frame, 0, 0, dw, dh);
        }
      } catch (e) {
        console.warn('[Renderer] WebCodecs export frame failed:', e);
      }
    } 
    // 2. 如果是实时预览，则优先使用原生 Video 标签进行绘制
    // 原生 Video 走硬件解码管线，且由浏览器高度优化，不会阻塞 JS 主线程
    else if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, dw, dh);
      frameRendered = true;
      
      // 在预览间隔中尝试预加载帧缓存
      if (!mainVideoCacheRef.current) mainVideoCacheRef.current = document.createElement('canvas');
      if (mainVideoCacheRef.current.width !== dw) {
         mainVideoCacheRef.current.width = dw; 
         mainVideoCacheRef.current.height = dh;
      }
    }

    // 3. 核心跳转兜底：如果在 Seek 过程中或解码掉帧，回退到最后一帧有效缓存，彻底消除黑屏
    if (!frameRendered && mainVideoCacheRef.current) {
      ctx.drawImage(mainVideoCacheRef.current, 0, 0, dw, dh);
    }
    drawSmoothMouse(ctx, camera, dw, dh, renderGraph, timestampMs);
    ctx.restore(); ctx.restore(); ctx.restore();

    // 细节描边
    ctx.beginPath(); ctx.roundRect(dx, dy, totalW, totalH, r); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx, dy + TB_H); ctx.lineTo(dx + totalW, dy + TB_H); ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.stroke();

    // --- F. 摄像头画中画 (Webcam PiP) 层 ---
    const webcamVideo = webcamVideoRef.current;
    if (webcamVideo && renderGraph.webcamSource && renderGraph.webcam?.isEnabled) {
      const pipSize = renderGraph.webcam?.size ?? 360; 
      const padding = 60;   
      const px = EDITOR_CANVAS_SIZE.width - pipSize/2 - padding;
      const py = EDITOR_CANVAS_SIZE.height - pipSize/2 - padding;

      // 计算摄像头采样时间戳：减去延迟量。如果结果为负，说明摄像头还没开始录制
      const webcamDelay = renderGraph.webcamDelay || 0;
      const adjWebcamTs = timestampMs - webcamDelay;

      const drawPip = (source: CanvasImageSource) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
        ctx.fill();

        ctx.save(); ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
        ctx.clip();

        ctx.translate(px, py); ctx.scale(-1, 1);
        const vw = (source instanceof HTMLVideoElement) ? source.videoWidth : (source as HTMLCanvasElement).width;
        const vh = (source instanceof HTMLVideoElement) ? source.videoHeight : (source as HTMLCanvasElement).height;
        const minSide = Math.min(vw, vh);
        ctx.drawImage(source, (vw - minSide) / 2, (vh - minSide) / 2, minSide, minSide, -pipSize/2, -pipSize/2, pipSize, pipSize);
        ctx.restore();

        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize/2, py - pipSize/2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize/2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
      };

      if (adjWebcamTs >= 0) {
        const isReady = webcamVideo.readyState >= 2;
        if (isReady && webcamVideo.videoWidth > 0) {
          drawPip(webcamVideo);
        } else if (webcamCacheRef.current && webcamCacheRef.current.width > 0) {
          // 兜底使用缓存
          drawPip(webcamCacheRef.current);
        }
      }
    }
  };

  // 预览渲染
  useEffect(() => {
    if (!isReady || isExporting) return;
    const canvas = canvasRef.current;
    if (canvas) { 
      // 性能优化：在预览模式下使用 1.0 DPR。
      // 因为 CSS 已经应用了 max-width[1024px]，2.5K 的画布会导致严重的像素填充率瓶颈和下采样开销。
      const dpr = 1.0;
      canvas.width = EDITOR_CANVAS_SIZE.width * dpr; 
      canvas.height = EDITOR_CANVAS_SIZE.height * dpr;
      const ctx = canvas.getContext('2d', { 
        alpha: true,
        willReadFrequently: false 
      }); 
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
      }
    }
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    const renderFromCurrentTime = () => { if (!stopped) void renderFrame(video.currentTime * 1000); };
    const onSync = () => requestAnimationFrame(renderFromCurrentTime);
    video.addEventListener('seeked', onSync);
    video.addEventListener('pause', onSync);
    video.addEventListener('loadeddata', onSync);

    const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';
    if (hasVfc) {
      const onVfc = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (!stopped) { void renderFrame(metadata.mediaTime * 1000); vfcRef.current = (video as any).requestVideoFrameCallback(onVfc); }
      };
      vfcRef.current = (video as any).requestVideoFrameCallback(onVfc);
    } else {
      const tick = () => { if (!stopped) { renderFromCurrentTime(); rafRef.current = requestAnimationFrame(tick); } };
      rafRef.current = requestAnimationFrame(tick);
    }
    
    // 关键修正：无论是否有 VFC，在进入预览模式的一瞬间强制重绘当前时刻。
    // 这解决了导出结束后，由于视频处于暂停状态且没有新帧产生，导致的预览区变黑/挂起的问题。
    renderFromCurrentTime();

    return () => {
      stopped = true;
      video.removeEventListener('seeked', onSync);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, videoRef, canvasRef, isExporting]); // 关键修复：移除了 renderGraph 依赖，防止拖拽时的 Effect 重置闪烁

  // 保持 renderGraphRef 最新，供 renderFrame 内部读取
  const renderGraphRef = useRef(renderGraph);
  useEffect(() => { renderGraphRef.current = renderGraph; }, [renderGraph]);

  // --- 光标路径 ---
  const CURSORS = { macOS: new Path2D('M0,0 L0,18.5 L5,14 L9,22 L11.5,21 L7.5,13.5 L13,13.5 Z') };

  // 二分查找当前时刻对应的最后一个鼠标事件索引
  function findLastEventIndex(events: any[], t: number) {
    let low = 0, high = events.length - 1;
    let ans = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (events[mid].t <= t) {
        ans = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return ans;
  }

  function drawSmoothMouse(ctx: CanvasRenderingContext2D, camera: any, dw: number, dh: number, graph: RenderGraph, t: number) {
    const events = graph.mouse;
    if (!events || events.length === 0) return;
    const { style, showRipple, size } = graph.mouseTheme;
    
    const mx = camera.mx * dw;
    const my = camera.my * dh;

    // --- 动态运动残影 ---
    const speedX = camera.mvx * dw * 0.01; 
    const speedY = camera.mvy * dh * 0.01;
    const speed = Math.sqrt(speedX * speedX + speedY * speedY);

    if (speed > 2.0) {
      const trailCount = 3;
      ctx.save();
      for (let i = 1; i <= trailCount; i++) {
        const tax = mx - speedX * i * 3.0;
        const tay = my - speedY * i * 3.0;
        const opacity = 0.25 * (1 - i / (trailCount + 1));
        ctx.beginPath();
        ctx.arc(tax, tay, size * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
        ctx.fill();
      }
      ctx.restore();
    }
    
    // --- 性能优化核心：定位当前时刻的事件 ---
    const lastIdx = findLastEventIndex(events, t);
    if (lastIdx === -1) return;

    let isDown = false;
    // 往前搜索找到最近的 down/up 决定状态
    for (let i = lastIdx; i >= 0; i--) {
      if (events[i].type === 'down') { isDown = true; break; }
      if (events[i].type === 'up') { isDown = false; break; }
    }

    // 涟漪效果：仅处理最近 600ms 的事件
    if (showRipple) {
      ctx.save();
      for (let i = lastIdx; i >= 0; i--) {
        const ev = events[i];
        if (t - ev.t > 600) break; // 超出涟漪寿命，停止遍历
        if (ev.type === 'down') {
          const age = t - ev.t;
          const progress = age / 600;
          ctx.beginPath();
          ctx.arc(ev.x * dw, ev.y * dh, progress * size * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.pow(1 - progress, 2) * 0.4})`;
          ctx.lineWidth = 2 * (1 - progress);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.save();
    const visualSize = size * (isDown ? 0.85 : 1.0);
    ctx.translate(mx, my);
    if (style === 'Circle') {
      ctx.beginPath(); ctx.arc(0, 0, visualSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
    } else {
      ctx.scale(visualSize / 22, visualSize / 22);
      ctx.rotate(-Math.PI / 180 * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke(CURSORS.macOS);
      ctx.fillStyle = isDown ? '#e0e0e0' : 'white';
      ctx.fill(CURSORS.macOS);
    }
    ctx.restore();
  }

  return { isReady, renderFrame };
}
