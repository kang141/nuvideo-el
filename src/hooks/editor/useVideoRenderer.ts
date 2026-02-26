import { useEffect, useRef, RefObject, useState } from 'react';
import { EDITOR_CANVAS_SIZE, AVAILABLE_CURSORS } from '../../constants/editor';
import { RenderGraph, MouseEvent } from '../../types';
import { computeCameraState } from '../../core/camera-solver';
import type { ExtendedCameraState } from '../../core/camera-solver';
import { ModernVideoRenderer } from '../../core/modern-video-renderer';
import { applyRenderConfig, getRenderConfig } from '../../core/render-config';
import { logger } from '../../utils/logger';

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
  const videoSizeRef = useRef({ width: 1920, height: 1080 });
  const layoutRef = useRef({ dx: 0, dy: 0, dw: 0, dh: 0, totalW: 0, totalH: 0, r: 16 });
  const rendererRef = useRef<ModernVideoRenderer | null>(null);
  const webcamRendererRef = useRef<ModernVideoRenderer | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  // 核心修复：视频帧缓存备份，彻底消除 seek 时的黑屏闪烁
  const mainVideoCacheRef = useRef<HTMLCanvasElement | null>(null);
  const webcamCacheRef = useRef<HTMLCanvasElement | null>(null);

  // 离屏 Canvas 用于缓存静态层（背景 + 阴影窗口背景）
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // 🎯 使用 Ref 跟踪导出状态，确保 renderFrame 闭包始终能获取最新值
  const isExportingRef = useRef(isExporting);
  useEffect(() => { isExportingRef.current = isExporting; }, [isExporting]);

  // 预加载光标资源
  const cursorImagesRef = useRef<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    // 预加载所有箭头样式的光标
    AVAILABLE_CURSORS.forEach(file => {
      const img = new Image();
      img.src = `/cursors/${file}`;
      img.onload = () => { cursorImagesRef.current[`cursor:${file}`] = img; };
    });

    // 固定加载 text 类型
    const textImg = new Image();
    textImg.src = '/cursors/text.svg';
    textImg.onload = () => { cursorImagesRef.current['text'] = textImg; };
  }, []);

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

    // 🎯 预览和导出模式都绘制背景
    if (bgImageRef.current) {
      oCtx.imageSmoothingEnabled = true;
      oCtx.imageSmoothingQuality = 'high';
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
    oCtx.moveTo(navX, dy + TB_H / 2 - 4); oCtx.lineTo(navX - 4, dy + TB_H / 2); oCtx.lineTo(navX, dy + TB_H / 2 + 4);
    oCtx.moveTo(navX + 16, dy + TB_H / 2 - 4); oCtx.lineTo(navX + 20, dy + TB_H / 2); oCtx.lineTo(navX + 16, dy + TB_H / 2 + 4);
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
  }, [bgCategory, bgFile]); // 移除 isExporting 依赖，背景图加载与是否导出无关

  // 启动现代化渲染器
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const renderer = new ModernVideoRenderer(video);
    rendererRef.current = renderer;

    renderer.initialize().then(() => {
      logger.debug('Modern renderer initialized');
      if (isExporting) {
        requestAnimationFrame(() => void renderFrame(video.currentTime * 1000));
      }
    });

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [videoRef]); // 移除 isExporting 依赖，避免导出开始时销毁并重建渲染器

  // 启动摄像头渲染器
  useEffect(() => {
    const webcamSource = renderGraph?.webcamSource;
    if (!webcamSource) return;

    const video = document.createElement('video');
    video.src = webcamSource;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    webcamVideoRef.current = video;

    const renderer = new ModernVideoRenderer(video);
    webcamRendererRef.current = renderer;

    renderer.initialize().then(() => {
      logger.debug('Webcam renderer initialized');
    });

    // 状态同步逻辑：让摄像头播放器跟随主视频状态
    const mainVideo = videoRef.current;

    // 状态切换同步：处理播放、暂停、速率
    const syncState = () => {
      if (!mainVideo || !video) return;
      video.playbackRate = mainVideo.playbackRate;
      if (mainVideo.paused && !video.paused) video.pause();
      if (!mainVideo.paused && video.paused) video.play().catch(() => { });
    };

    // 强校准：仅在进度拖动或开始播放时对齐时间轴
    const hardSync = (tolerance = 0.1) => {
      if (!mainVideo || !video || !renderGraph) return;
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

    logger.debug('Webcam sync optimized (Low-overhead mode)');

    return () => {
      if (mainVideo) {
        mainVideo.removeEventListener('play', onPlay);
        mainVideo.removeEventListener('pause', onPause);
        mainVideo.removeEventListener('ratechange', onRateChange);
        mainVideo.removeEventListener('seeked', onSeeked);
      }
      renderer.destroy();
      webcamRendererRef.current = null;
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

  // 核心渲染 logic (可重复调用)
  const renderFrame = async (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    const isExportingNow = isExportingRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) {
      if (isExportingNow) {
        logger.warn('帧被跳过:', {
          hasVideo: !!video,
          hasCanvas: !!canvas,
          isReady,
          hasOffscreen: !!offscreenRef.current
        });
      }
      return;
    }

    // 🎯 统一获取 context：确保预览和导出使用相同的配置
    const ctx = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: false
    });
    if (!ctx) return;



    const renderGraph = renderGraphRef.current;
    if (!renderGraph) {
      if (isExporting) logger.warn('renderGraph 为空！');
      return;
    }

    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    // 🎯 性能优化：移除冗余的 clearRect 与黑色填充。
    // 背景由 offscreenRef 完整覆盖，且 canvas 开启了 alpha: false。
    ctx.drawImage(offscreenRef.current, 0, 0, EDITOR_CANVAS_SIZE.width, EDITOR_CANVAS_SIZE.height);

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

    const renderer = rendererRef.current;
    let frameRendered = false;

    // --- 统一的现代化渲染策略 ---
    if (renderer) {
      // 🎯 核心优化：导出模式且视频正在播放时（VFC模式），不使用 seek 模式的 getFrameAt
      // 而是直接使用捕获当前帧，避免 seek 导致的黑屏。
      const isActuallyPlaying = video && !video.paused;

      // 🎯 诊断日志
      if (isExportingNow && timestampMs < 100) {
        logger.debug('渲染路径选择:', {
          isExportingNow,
          isActuallyPlaying,
          videoPaused: video.paused,
          videoCurrentTime: video.currentTime,
          videoReadyState: video.readyState,
          timestampMs
        });
      }

      if (!isExportingNow || isActuallyPlaying) {
        // 预览模式或正在播放的导出，直接从视频层抽取
        frameRendered = renderer.drawToCanvas(ctx, 0, 0, dw, dh);

        if (isExportingNow && timestampMs < 100) {
          logger.debug('drawToCanvas 结果:', { frameRendered, videoReadyState: video.readyState });
        }

        // 更新缓存（用于丢帧时的兜底）
        if (frameRendered) {
          if (!mainVideoCacheRef.current) mainVideoCacheRef.current = document.createElement('canvas');
          if (mainVideoCacheRef.current.width !== dw) {
            mainVideoCacheRef.current.width = dw;
            mainVideoCacheRef.current.height = dh;
          }
          const cacheCtx = mainVideoCacheRef.current.getContext('2d');
          if (cacheCtx) {
            try {
              cacheCtx.drawImage(video, 0, 0, dw, dh);
            } catch (e) { /* ignore */ }
          }
        }
      }
      else {
        // 导出模式且视频暂停（手动 Seek 模式）：使用精确帧获取
        if (timestampMs < 100) {
          logger.debug('使用 getFrameAt 模式');
        }
        try {
          const frame = await renderer.getFrameAt(timestampMs, true);
          if (frame) {
            ctx.drawImage(frame, 0, 0, dw, dh);
            frameRendered = true;

            // 更新缓存
            if (!mainVideoCacheRef.current) mainVideoCacheRef.current = document.createElement('canvas');
            if (mainVideoCacheRef.current.width !== dw) {
              mainVideoCacheRef.current.width = dw;
              mainVideoCacheRef.current.height = dh;
            }
            const cacheCtx = mainVideoCacheRef.current.getContext('2d');
            if (cacheCtx) cacheCtx.drawImage(frame, 0, 0, dw, dh);

            frame.close();
          } else {
            if (isExportingNow) logger.warn('getFrameAt 返回空, 时间戳:', timestampMs);
          }
        } catch (e) {
          logger.warn('获取精确帧失败:', e);
        }
      }
    }

    // 兜底：如果渲染失败，使用缓存
    if (!frameRendered && mainVideoCacheRef.current) {
      ctx.drawImage(mainVideoCacheRef.current, 0, 0, dw, dh);
    }
    drawSmoothMouse(ctx, camera as ExtendedCameraState, dw, dh, renderGraph, timestampMs);
    ctx.restore(); ctx.restore(); ctx.restore();

    // 细节描边
    ctx.beginPath(); ctx.roundRect(dx, dy, totalW, totalH, r); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx, dy + TB_H); ctx.lineTo(dx + totalW, dy + TB_H); ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.stroke();

    // --- F. 摄像头画中画 (Webcam PiP) 层 ---
    const webcamVideo = webcamVideoRef.current;
    const webcamRenderer = webcamRendererRef.current;
    if (webcamVideo && webcamRenderer && renderGraph.webcamSource && renderGraph.webcam?.isEnabled) {
      const pipSize = renderGraph.webcam?.size ?? 360;
      const padding = 60;
      const px = EDITOR_CANVAS_SIZE.width - pipSize / 2 - padding;
      const py = EDITOR_CANVAS_SIZE.height - pipSize / 2 - padding;

      // 计算摄像头采样时间戳：减去延迟量。如果结果为负，说明摄像头还没开始录制
      const webcamDelay = renderGraph.webcamDelay || 0;
      const adjWebcamTs = timestampMs - webcamDelay;

      const drawPip = (source: CanvasImageSource) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize / 2, py - pipSize / 2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.save(); ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize / 2, py - pipSize / 2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize / 2, 0, Math.PI * 2);
        ctx.clip();

        ctx.translate(px, py); ctx.scale(-1, 1);
        const vw = (source instanceof HTMLVideoElement) ? source.videoWidth : (source as HTMLCanvasElement).width;
        const vh = (source instanceof HTMLVideoElement) ? source.videoHeight : (source as HTMLCanvasElement).height;
        const minSide = Math.min(vw, vh);
        ctx.drawImage(source, (vw - minSide) / 2, (vh - minSide) / 2, minSide, minSide, -pipSize / 2, -pipSize / 2, pipSize, pipSize);
        ctx.restore();

        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') ctx.roundRect(px - pipSize / 2, py - pipSize / 2, pipSize, pipSize, 40);
        else ctx.arc(px, py, pipSize / 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
      };

      if (adjWebcamTs >= 0) {
        // 预览模式：直接绘制
        if (!isExporting && webcamVideo.readyState >= 2 && webcamVideo.videoWidth > 0) {
          drawPip(webcamVideo);
        }
        // 导出模式：获取精确帧
        else if (isExporting) {
          try {
            const webcamFrame = await webcamRenderer.getFrameAt(adjWebcamTs);
            if (webcamFrame) {
              // 创建临时 canvas 来绘制 VideoFrame
              if (!webcamCacheRef.current) {
                webcamCacheRef.current = document.createElement('canvas');
              }
              const { width, height } = webcamRenderer.getVideoSize();
              if (webcamCacheRef.current.width !== width) {
                webcamCacheRef.current.width = width;
                webcamCacheRef.current.height = height;
              }
              const cacheCtx = webcamCacheRef.current.getContext('2d');
              if (cacheCtx) {
                cacheCtx.drawImage(webcamFrame, 0, 0);
                drawPip(webcamCacheRef.current);
              }
              webcamFrame.close();
            } else if (webcamCacheRef.current && webcamCacheRef.current.width > 0) {
              drawPip(webcamCacheRef.current);
            }
          } catch (e) {
            logger.warn('摄像头帧获取失败:', e);
            if (webcamCacheRef.current && webcamCacheRef.current.width > 0) {
              drawPip(webcamCacheRef.current);
            }
          }
        }
        // 兜底：使用缓存
        else if (webcamCacheRef.current && webcamCacheRef.current.width > 0) {
          drawPip(webcamCacheRef.current);
        }
      }
    }
  };

  // 🚀 现代化预览渲染：强制使用 RAF 实现 60fps 流畅预览
  useEffect(() => {
    if (!isReady || isExporting) return;
    const canvas = canvasRef.current;
    if (canvas) {
      // 🎯 使用统一的渲染配置
      const config = getRenderConfig(false); // 预览模式
      applyRenderConfig(canvas, config);
    }
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let lastFrameTime = 0;
    const TARGET_FPS = 60;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    // 🚀 核心优化：使用节流的 RAF 循环，确保 60fps 流畅预览
    // 不再依赖 VFC（它会被视频解码器锁定在低帧率）
    const tick = (now: number) => {
      if (stopped) return;

      // 节流：确保帧间隔不小于 16.67ms (60fps)
      if (now - lastFrameTime >= FRAME_INTERVAL) {
        lastFrameTime = now;
        void renderFrame(video.currentTime * 1000);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    // 🚀 关键：监听视频事件，但不阻塞渲染循环
    const onSync = () => {
      // 立即渲染一帧，确保响应性
      void renderFrame(video.currentTime * 1000);
    };

    video.addEventListener('seeked', onSync);
    video.addEventListener('pause', onSync);
    video.addEventListener('play', onSync);
    video.addEventListener('loadeddata', onSync);

    // 启动渲染循环
    rafRef.current = requestAnimationFrame(tick);

    // 立即渲染第一帧
    onSync();

    return () => {
      stopped = true;
      video.removeEventListener('seeked', onSync);
      video.removeEventListener('pause', onSync);
      video.removeEventListener('play', onSync);
      video.removeEventListener('loadeddata', onSync);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, videoRef, canvasRef, isExporting]);

  // 保持 renderGraphRef 最新，供 renderFrame 内部读取
  const renderGraphRef = useRef(renderGraph);
  useEffect(() => { renderGraphRef.current = renderGraph; }, [renderGraph]);

  // --- 光标路径定义 (Path2D) ---
  // 二分查找当前时刻对应的最后一个鼠标事件索引
  function findLastEventIndex(events: MouseEvent[], t: number) {
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

  function drawSmoothMouse(ctx: CanvasRenderingContext2D, camera: ExtendedCameraState, dw: number, dh: number, graph: RenderGraph, t: number) {
    const events = graph.mouse;
    if (!events || events.length === 0) return;
    const { style, size } = graph.mouseTheme;

    // --- 性能优化核心：定位当前时刻的事件 ---
    const lastIdx = findLastEventIndex(events, t);
    if (lastIdx === -1) return;

    // 获取当前的数据点（用于位置插值）和形态
    const ev = events[lastIdx];
    const currentShape = ev.shape || 'default';

    const mx = camera.mx * dw;
    const my = camera.my * dh;


    let isDown = false;
    // 往前搜索找到最近的 down/up 决定状态
    for (let i = lastIdx; i >= 0; i--) {
      if (events[i].type === 'down') { isDown = true; break; }
      if (events[i].type === 'up') { isDown = false; break; }
    }



    ctx.save();
    const visualSize = size * (isDown ? 0.85 : 1.0);

    // 动态决定使用的图片资源
    let cursorImg: HTMLImageElement | undefined;
    if (currentShape === 'text') {
      cursorImg = cursorImagesRef.current['text'];
    } else if (currentShape === 'pointer') {
      const file = graph.mouseTheme.pointerFile || 'pointer-1.svg';
      cursorImg = cursorImagesRef.current[`pointer:${file}`];
    } else {
      const file = graph.mouseTheme.cursorFile || 'arrow-1.svg';
      cursorImg = cursorImagesRef.current[`cursor:${file}`];
    }

    if (cursorImg) {
      ctx.translate(mx, my);

      // 根据光标类型动态校准热点偏移
      let ox = 0, oy = 0;
      if (currentShape === 'text') {
        ox = -16; oy = -16;
      } else if (currentShape === 'pointer') {
        // 由于用户下载的 SVG 格式不一，这里尝试一个通用的手型热点偏移（食指大概在中间靠上）
        ox = -12; oy = -2;
      } else {
        // 默认箭头热点在左上角稍微偏一点
        ox = -4; oy = -2;
      }

      const scale = visualSize / 32;
      ctx.scale(scale, scale);

      // 核心修复：强制指定绘制宽高为 32x32
      // 这样无论原始 SVG 是 512 还是 1024，都会被缩放到我们定义的逻辑网格内
      ctx.drawImage(cursorImg, ox, oy, 32, 32);
    } else if (style === 'Circle') {
      ctx.translate(mx, my);
      ctx.beginPath(); ctx.arc(0, 0, visualSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
    }
    ctx.restore();
  }

  return { isReady, renderFrame };
}
