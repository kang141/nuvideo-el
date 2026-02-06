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
  const statsRef = useRef({ lastTime: performance.now(), frames: 0, totalMs: 0 }); 
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
  const exportBufferRef = useRef<HTMLCanvasElement | null>(null);
  const exportLayoutCacheRef = useRef<any>(null);

  // 绘制/刷新离屏静态层
  const updateOffscreen = (W: number, H: number, vw: number, vh: number) => {
    if (!bgImageRef.current) return;

    if (!offscreenRef.current || offscreenRef.current.width !== W || offscreenRef.current.height !== H) {
      offscreenRef.current = document.createElement('canvas');
      offscreenRef.current.width = W;
      offscreenRef.current.height = H;
    }

    const canvas = offscreenRef.current;
    const oCtx = canvas.getContext('2d');
    if (!oCtx) return;

    oCtx.clearRect(0, 0, W, H);

    // 1. 绘制背景层 (预览与导出均改用 Canvas 绘制以开启高质量平滑)
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
    oCtx.moveTo(navX, dy + TB_H/2 - 4); oCtx.lineTo(navX - 4, dy + TB_H/2); oCtx.lineTo(navX, dy + TB_H/2 + 4); 
    oCtx.moveTo(navX + 16, dy + TB_H/2 - 4); oCtx.lineTo(navX + 20, dy + TB_H/2); oCtx.lineTo(navX + 16, dy + TB_H/2 + 4); 
    oCtx.stroke();

    // 🎯 优化核心：将原本在 renderFrame 中的静态装饰也移到离屏层
    oCtx.beginPath(); 
    oCtx.roundRect(dx, dy, totalW, totalH, r); 
    oCtx.strokeStyle = 'rgba(255,255,255,0.08)'; 
    oCtx.lineWidth = 1; 
    oCtx.stroke();
    
    oCtx.beginPath(); 
    oCtx.moveTo(dx, dy + TB_H); 
    oCtx.lineTo(dx + totalW, dy + TB_H); 
    oCtx.strokeStyle = 'rgba(255,255,255,0.05)'; 
    oCtx.stroke();
  };

  // 加载背景图与窗口装饰
  useEffect(() => {
    // 将 updateOffscreen 暴露给 window，以便导出逻辑可以调用它
    (window as any).updateOffscreen = updateOffscreen;

    // 加载控制按钮 SVG
    const btnImg = new Image();
    btnImg.src = '/window-controls.svg';
    btnImg.onload = () => { macButtonsRef.current = btnImg; };

    const img = new Image();
    img.src = `asset://backgrounds/${bgCategory}/${bgFile}`;
    img.onload = () => {
      bgImageRef.current = img;
      const { width: W, height: H } = EDITOR_CANVAS_SIZE;
      updateOffscreen(W, H, videoSizeRef.current.width, videoSizeRef.current.height);

      if (isFirstLoadRef.current) {
        setIsReady(true);
        isFirstLoadRef.current = false;
      }

      const video = videoRef.current;
      if (video) requestAnimationFrame(() => void renderFrame(video.currentTime * 1000));
    };
  }, [bgCategory, bgFile, isExporting]); // 增加 isExporting 依赖，确保导出开始时重绘离屏层

  // 启动 WebCodecs FrameManager (保持全时就绪，以便即时导出)
  useEffect(() => {
    const videoSource = renderGraph.videoSource;
    if (!videoSource) return;

    const manager = new VideoFrameManager();
    frameManagerRef.current = manager;

    manager.initialize(videoSource).then(() => {
      console.log('[useVideoRenderer] WebCodecs Manager ready');
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

    manager.initialize(webcamSource).then(() => {
      console.log('[useVideoRenderer] Webcam WebCodecs Manager ready');
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
    
    // 🎯 核心修复：禁用摄像头视频的自动播放和同步
    // 改为仅在需要时才读取当前帧，避免阻塞主渲染
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    
    webcamVideoRef.current = video;

    // 🎯 监听加载状态
    video.addEventListener('loadedmetadata', () => {
      // 视频加载成功
    });
    video.addEventListener('error', (e) => {
      console.error('[Webcam] Load error:', video.error);
    });
    video.addEventListener('canplay', () => {
      // 视频可以播放
    });

    const mainVideo = videoRef.current;
    
    // 🎯 优化同步逻辑：主动同步播放状态和时间位置
    const syncState = () => {
      if (!mainVideo || !video) return;
      video.playbackRate = mainVideo.playbackRate;
      if (mainVideo.paused && !video.paused) {
        video.pause();
      }
      if (!mainVideo.paused && video.paused) {
        video.play().catch(() => {});
      }
    };

    // 🎯 关键修复：同步时间位置（更激进的同步策略）
    const syncTime = () => {
      if (!mainVideo || !video) return;
      const timeDiff = Math.abs(video.currentTime - mainVideo.currentTime);
      // 降低阈值到 0.05 秒，更频繁地同步时间
      if (timeDiff > 0.05) {
        video.currentTime = mainVideo.currentTime;
      }
    };

    const onPlay = () => {
      syncState();
      syncTime(); // 播放时也同步时间
      // 强制启动摄像头播放
      if (video.paused) {
        video.play().catch(() => {});
      }
    };
    const onPause = () => {
      syncState();
    };
    const onRateChange = () => {
      syncState();
    };
    
    // 🎯 关键修复：监听 seek 事件，确保摄像头视频跟随主视频跳转
    const onSeeked = () => {
      syncTime();
      // Seek 后立即更新缓存
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        try {
          if (!webcamCacheRef.current) {
            webcamCacheRef.current = document.createElement('canvas');
          }
          const cache = webcamCacheRef.current;
          if (cache.width !== video.videoWidth || cache.height !== video.videoHeight) {
            cache.width = video.videoWidth;
            cache.height = video.videoHeight;
          }
          const cacheCtx = cache.getContext('2d', { alpha: false });
          if (cacheCtx) {
            cacheCtx.drawImage(video, 0, 0);
          }
        } catch (e) {
          // 忽略绘制错误
        }
      }
    };
    
    // 🎯 新增：监听主视频的 timeupdate，持续同步时间
    const onTimeUpdate = () => {
      syncTime();
    };

    // 🎯 核心优化：使用 requestVideoFrameCallback 精确捕获每一帧
    // 如果不支持，回退到 RAF 高频轮询（确保流畅）
    const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';
    
    let cleanupFunc: (() => void) | null = null;
    
    if (hasVfc) {
      let vfcId: number | null = null;
      const onVideoFrame = () => {
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          try {
            // 每帧都更新缓存
            if (!webcamCacheRef.current) {
              webcamCacheRef.current = document.createElement('canvas');
            }
            const cache = webcamCacheRef.current;
            if (cache.width !== video.videoWidth || cache.height !== video.videoHeight) {
              cache.width = video.videoWidth;
              cache.height = video.videoHeight;
            }
            const cacheCtx = cache.getContext('2d', { alpha: false });
            if (cacheCtx) {
              cacheCtx.drawImage(video, 0, 0);
            }
          } catch (e) {
            // 忽略绘制错误
          }
        }
        
        // 继续下一帧
        if (webcamVideoRef.current === video) {
          vfcId = (video as any).requestVideoFrameCallback(onVideoFrame);
        }
      };
      
      vfcId = (video as any).requestVideoFrameCallback(onVideoFrame);
      
      cleanupFunc = () => {
        if (vfcId !== null) {
          (video as any).cancelVideoFrameCallback(vfcId);
        }
      };
    } else {
      // 回退方案：使用 RAF 高频轮询，确保摄像头画面流畅
      let rafId: number | null = null;
      const updateCache = () => {
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          try {
            // 缓存当前帧到离屏 Canvas
            if (!webcamCacheRef.current) {
              webcamCacheRef.current = document.createElement('canvas');
            }
            const cache = webcamCacheRef.current;
            if (cache.width !== video.videoWidth || cache.height !== video.videoHeight) {
              cache.width = video.videoWidth;
              cache.height = video.videoHeight;
            }
            const cacheCtx = cache.getContext('2d', { alpha: false });
            if (cacheCtx) {
              cacheCtx.drawImage(video, 0, 0);
            }
          } catch (e) {
            // 忽略绘制错误
          }
        }
        
        // 继续下一帧
        if (webcamVideoRef.current === video) {
          rafId = requestAnimationFrame(updateCache);
        }
      };
      
      rafId = requestAnimationFrame(updateCache);
      
      cleanupFunc = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
      };
    }

    if (mainVideo) {
      mainVideo.addEventListener('play', onPlay);
      mainVideo.addEventListener('pause', onPause);
      mainVideo.addEventListener('ratechange', onRateChange);
      mainVideo.addEventListener('seeked', onSeeked);
      mainVideo.addEventListener('timeupdate', onTimeUpdate); // 🎯 持续同步时间
      
      // 初始化：让摄像头视频加载并同步初始状态
      video.load();
      video.addEventListener('loadeddata', () => {
        syncTime();
        syncState();
      });
    }

    return () => {
      if (mainVideo) {
        mainVideo.removeEventListener('play', onPlay);
        mainVideo.removeEventListener('pause', onPause);
        mainVideo.removeEventListener('ratechange', onRateChange);
        mainVideo.removeEventListener('seeked', onSeeked);
        mainVideo.removeEventListener('timeupdate', onTimeUpdate);
      }
      
      // 清理帧捕获
      if (cleanupFunc) {
        cleanupFunc();
      }
      
      video.pause();
      video.removeAttribute('src');
      webcamVideoRef.current = null;
    };
  }, [renderGraph.webcamSource, isExporting]);

  // 监听视频元数据变化 (保持兼容性，用于获取尺寸和初始触发)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        videoSizeRef.current = { width: video.videoWidth, height: video.videoHeight };
        const { width: W, height: H } = EDITOR_CANVAS_SIZE;
        updateOffscreen(W, H, video.videoWidth, video.videoHeight);
        requestAnimationFrame(() => void renderFrame(video.currentTime * 1000));
      }
    };

    video.addEventListener('loadedmetadata', onMetadata);
    if (video.readyState >= 1) onMetadata();

    return () => video.removeEventListener('loadedmetadata', onMetadata);
  }, [videoRef, isReady, renderGraph.videoSource]);

  // 辅助函数：计算布局 (简约专业风：不留边黑框)
  // 🎯 布局算法优化：基于当前画布尺寸 (W, H) 动态适配视频流比例
  const calculateLayout = (W: number, H: number, vw: number, vh: number) => {
    // 基础参数：保持 16 像素圆角和 34 像素工具栏高度
    const TB_H = 34;
    const r = 16;
    
    // 计算视频本身的比例
    const videoAspect = (vw && vh) ? vw / vh : 16 / 9;
    
    // 窗口适配策略：在画布内预留 12% 的安全边距，并根据视频比例调整 dw/dh
    const PADDING_FACTOR = 0.88;
    const maxW = W * PADDING_FACTOR;
    const maxH = H * PADDING_FACTOR;
    
    let dw: number, dh: number;
    
    // 采用“Contain”缩放逻辑
    if (maxW / maxH > videoAspect) {
      dh = maxH;
      dw = dh * videoAspect;
    } else {
      dw = maxW;
      dh = dw / videoAspect;
    }

    // 补偿工具栏高度：由于 dw/dh 是视频画面的尺寸，我们需要整体包裹在一个圆角窗口里
    const totalW = Math.round(dw);
    const totalH = Math.round(dh + TB_H);
    
    const dx = Math.round((W - totalW) / 2);
    const dy = Math.round((H - totalH) / 2);

    return { dx, dy, dw: Math.round(dw), dh: Math.round(dh), totalW, totalH, r };
  };

  // 核心渲染逻辑 (可重复调用)
  const renderFrame = (timestampMs: number) => {
    // 硬锁：一旦进入导出模式，预览渲染必须立刻停止，防止 Canvas 抢占
    if (isExporting) return;

    const t0 = performance.now();
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    
  
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 预览缩放处理器
    const previewScale = isExporting ? 1.0 : (canvas.width / EDITOR_CANVAS_SIZE.width);
    if (previewScale !== 1.0) {
      ctx.scale(previewScale, previewScale);
    }

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

    // --- 预览模式：使用原生 Video 标签进行同步绘制 ---
    // 原生 Video 走硬件解码管线，且由浏览器高度优化，不会阻塞 JS 主线程
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, dw, dh);
    } else if (mainVideoCacheRef.current) {
      // 兜底：如果在 Seek 过程中或解码掉帧，回退到最后一帧有效缓存
      ctx.drawImage(mainVideoCacheRef.current, 0, 0, dw, dh);
    }

    drawSmoothMouse(ctx, camera, dw, dh, renderGraph, timestampMs);
    ctx.restore(); // 恢复视频内容层的 save
    ctx.restore(); // 恢复剪裁内容区的 save

    // --- F. 摄像头画中画 (Webcam PiP) 层 ---
    const webcamVideo = webcamVideoRef.current;
    if (webcamVideo && renderGraph.webcamSource && renderGraph.webcam?.isEnabled) {
      const pipSize = renderGraph.webcam?.size ?? 360; 
      const padding = 60;   
      const px = EDITOR_CANVAS_SIZE.width - pipSize/2 - padding;
      const py = EDITOR_CANVAS_SIZE.height - pipSize/2 - padding;

      // 计算摄像头采样时间戳：减去延迟量
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
        // 🎯 优化：优先使用缓存，但如果缓存为空则直接读取 video
        const hasCache = webcamCacheRef.current && webcamCacheRef.current.width > 0;
        const isVideoReady = webcamVideo.readyState >= webcamVideo.HAVE_CURRENT_DATA && webcamVideo.videoWidth > 0;
        
        if (hasCache) {
          // 使用缓存的帧
          drawPip(webcamCacheRef.current);
        } else if (isVideoReady) {
          // 缓存未就绪时，直接使用 video 元素（首次加载或 seek 后）
          try {
            drawPip(webcamVideo);
            // 同时更新缓存，避免下次再直接读取
            if (!webcamCacheRef.current) {
              webcamCacheRef.current = document.createElement('canvas');
            }
            const cache = webcamCacheRef.current;
            if (cache.width !== webcamVideo.videoWidth || cache.height !== webcamVideo.videoHeight) {
              cache.width = webcamVideo.videoWidth;
              cache.height = webcamVideo.videoHeight;
            }
            const cacheCtx = cache.getContext('2d', { alpha: false });
            if (cacheCtx) {
              cacheCtx.drawImage(webcamVideo, 0, 0);
            }
          } catch (e) {
            // 忽略绘制错误
          }
        }
      }
    }
    const t2 = performance.now();

    // --- 性能统计（生产环境可注释）---
    // const t1 = performance.now();
    // statsRef.current.frames++;
    // statsRef.current.totalMs += (t1 - t0);
    // if (statsRef.current.frames >= 60) {
    //   const avgFps = Math.round(statsRef.current.frames / ((t1 - statsRef.current.lastTime) / 1000));
    //   const avgRender = (statsRef.current.totalMs / statsRef.current.frames).toFixed(2);
    //   console.log(`[Renderer] FPS: ${avgFps}, Avg render: ${avgRender}ms, Webcam: ${webcamTime.toFixed(2)}ms`);
    //   statsRef.current = { lastTime: t1, frames: 0, totalMs: 0 };
    // }
  };

  // 预览渲染
  useEffect(() => {
    if (!isReady || isExporting) return;
    const canvas = canvasRef.current;
    if (canvas) { 
      // 性能优化：在预览模式下尽量保持 2K 清晰度
      // 如果用户反馈卡顿，可以将 previewScale 调低至 0.75
      const previewScale = 1.0; 
      canvas.width = EDITOR_CANVAS_SIZE.width * previewScale; 
      canvas.height = EDITOR_CANVAS_SIZE.height * previewScale;
      const ctx = canvas.getContext('2d', { 
        alpha: true,
        willReadFrequently: false
      }); 
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high'; // 恢复为 high 以获得最佳清晰度
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

    // 即使环境支持 VFC，在预览模式下我们也优先使用 RAF（requestAnimationFrame）。
    // 原因是：对于高码率/Raw 视频，VFC 会被解码器的低帧率锁定（如 20fps）。
    // 使用 RAF 可以确保虽然视频帧可能在滞后，但鼠标、镜头动画和 UI 依然能跑满 60fps 丝滑状态。
    const forceRafForPreview = !isExporting;

    const hasVfc = typeof (video as any).requestVideoFrameCallback === 'function';
    if (hasVfc && !forceRafForPreview) {
      console.log('%c[Renderer] 🚀 Using Modern Web API: requestVideoFrameCallback (VFC)', 'color: #34d399; font-weight: bold;');
      const onVfc = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (!stopped) { void renderFrame(metadata.mediaTime * 1000); vfcRef.current = (video as any).requestVideoFrameCallback(onVfc); }
      };
      vfcRef.current = (video as any).requestVideoFrameCallback(onVfc);
    } else {
      console.log(`%c[Renderer] ⚡ Running in High-FPS Hybrid Mode (${forceRafForPreview ? 'RAF' : 'VFC Fallback'})`, 'color: #0ea5e9; font-weight: bold;');
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
    
    const mx = Math.round(camera.mx * dw);
    const my = Math.round(camera.my * dh);

    // --- 动态运动残影 ---
    const speedX = camera.mvx * dw * 0.01; 
    const speedY = camera.mvy * dh * 0.01;
    const speed = Math.sqrt(speedX * speedX + speedY * speedY);

    if (speed > 2.0) {
      const trailCount = 3;
      ctx.save();
      for (let i = 1; i <= trailCount; i++) {
        const tax = Math.round(mx - speedX * i * 3.0);
        const tay = Math.round(my - speedY * i * 3.0);
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
      // 优化：从后往前遍历，遇到超时事件立即退出
      for (let i = lastIdx; i >= 0 && i >= lastIdx - 10; i--) { // 最多检查最近 10 个事件
        const ev = events[i];
        const age = t - ev.t;
        if (age > 600) break; // 超出涟漪寿命，停止遍历
        if (ev.type === 'down') {
          const progress = age / 600;
          ctx.beginPath();
          ctx.arc(Math.round(ev.x * dw), Math.round(ev.y * dh), progress * size * 1.5, 0, Math.PI * 2);
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

  // 导出专用渲染函数：使用 WebCodecs 解码保证最高画质
  const renderFrameForExport = async (timestampMs: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady || !offscreenRef.current) return;

    if (!renderGraph) return;

    // 🎯 优化点：复用缓冲 Canvas，避免每帧创建。
    if (!exportBufferRef.current || exportBufferRef.current.width !== canvas.width || exportBufferRef.current.height !== canvas.height) {
      exportBufferRef.current = document.createElement('canvas');
      exportBufferRef.current.width = canvas.width;
      exportBufferRef.current.height = canvas.height;
    }
    const bufferCanvas = exportBufferRef.current;
    const ctx = bufferCanvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);

    const camera = computeCameraState(renderGraph, timestampMs);
    const s = camera.scale;

    // --- A. 绘制背景层 ---
    ctx.save();
    ctx.drawImage(offscreenRef.current, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // --- B. 布局参数 (🎯 优化：如果分辨率没变，复用缓存的布局计算结果)
    const TB_H = 34;
    const videoSize = videoSizeRef.current;
    
    if (!exportLayoutCacheRef.current || 
        exportLayoutCacheRef.current.canvasW !== canvas.width || 
        exportLayoutCacheRef.current.canvasH !== canvas.height ||
        exportLayoutCacheRef.current.videoW !== videoSize.width ||
        exportLayoutCacheRef.current.videoH !== videoSize.height) {
      
      const layout = calculateLayout(canvas.width, canvas.height, videoSize.width, videoSize.height);
      exportLayoutCacheRef.current = {
        ...layout,
        canvasW: canvas.width,
        canvasH: canvas.height,
        videoW: videoSize.width,
        videoH: videoSize.height
      };
    }
    
    const { dx, dy, dw, dh, totalW, totalH, r } = exportLayoutCacheRef.current;

    // --- C. 视频区剪裁 ---
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, totalW, totalH, r);
    ctx.clip();

    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy + TB_H, dw, dh);
    ctx.clip();

    // 应用相机位移 (🎯 优化：对位移进行取整，防止亚像素抖动)
    ctx.translate(Math.round(dx + dw / 2), Math.round(dy + TB_H + dh / 2));
    ctx.scale(s, s);
    ctx.translate(Math.round(-camera.cx * dw), Math.round(-camera.cy * dh));

    // --- D. 核心渲染路径 ---
    const manager = frameManagerRef.current;
    let frameRendered = false;

    if (manager) {
      try {
        const frame = await manager.getFrame(timestampMs);
        if (frame) {
          // 使用坐标取齐防止亚像素闪烁
          ctx.drawImage(frame, 0, 0, frame.codedWidth, frame.codedHeight, 0, 0, Math.floor(dw), Math.floor(dh));
          frameRendered = true;
          frame.close?.();
        }
      } catch (e) {
        // WebCodecs 失败时不做阻塞等待，直接跳到降级
      }
    }

    // 降级策略：如果 WebCodecs 失败，使用视频标签
    if (!frameRendered && video) {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, Math.floor(dw), Math.floor(dh));
      }
    }

    drawSmoothMouse(ctx, camera, dw, dh, renderGraph, timestampMs);
    
    // E. 恢复状态
    ctx.restore(); 
    ctx.restore(); 

    // 摄像头画中画 (🎯 适配隔离管线)
    const webcamVideo = webcamVideoRef.current;
    if (webcamVideo && renderGraph.webcamSource && renderGraph.webcam?.isEnabled) {
      const pipSize = renderGraph.webcam?.size ?? 360; 
      const padding = 60;   
      // 使用当前画布尺寸而非静态尺寸，确保导出分辨率自适应
      const px = canvas.width - pipSize/2 - padding;
      const py = canvas.height - pipSize/2 - padding;

      const webcamDelay = renderGraph.webcamDelay || 0;
      const adjWebcamTs = timestampMs - webcamDelay;

      const drawPip = (source: CanvasImageSource) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') {
          ctx.roundRect(Math.floor(px - pipSize/2), Math.floor(py - pipSize/2), pipSize, pipSize, 40);
        } else {
          ctx.arc(Math.floor(px), Math.floor(py), pipSize/2, 0, Math.PI * 2);
        }
        ctx.fill();

        ctx.save(); 
        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') {
          ctx.roundRect(Math.floor(px - pipSize/2), Math.floor(py - pipSize/2), pipSize, pipSize, 40);
        } else {
          ctx.arc(Math.floor(px), Math.floor(py), pipSize/2, 0, Math.PI * 2);
        }
        ctx.clip();

        ctx.translate(Math.floor(px), Math.floor(py)); 
        ctx.scale(-1, 1);
        
        const vw = (source instanceof HTMLVideoElement) ? source.videoWidth : (source as any).codedWidth || (source as HTMLCanvasElement).width;
        const vh = (source instanceof HTMLVideoElement) ? source.videoHeight : (source as any).codedHeight || (source as HTMLCanvasElement).height;
        
        const minSide = Math.min(vw, vh);
        ctx.drawImage(source, (vw - minSide) / 2, (vh - minSide) / 2, minSide, minSide, -pipSize/2, -pipSize/2, pipSize, pipSize);
        ctx.restore();

        ctx.beginPath();
        if (renderGraph.webcam?.shape === 'rect') {
          ctx.roundRect(Math.floor(px - pipSize/2), Math.floor(py - pipSize/2), pipSize, pipSize, 40);
        } else {
          ctx.arc(Math.floor(px), Math.floor(py), pipSize/2, 0, Math.PI * 2);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; 
        ctx.lineWidth = 3; 
        ctx.stroke();
        ctx.restore();
      };

      if (adjWebcamTs >= 0) {
        let webcamFrameRendered = false;
        const webcamManager = webcamFrameManagerRef.current;
        
        if (webcamManager) {
          try {
            const frame = await webcamManager.getFrame(adjWebcamTs);
            if (frame) {
              drawPip(frame);
              frame.close();
              webcamFrameRendered = true;
            }
          } catch (e) {}
        }

        if (!webcamFrameRendered && webcamVideo && webcamVideo.readyState >= 2) {
           drawPip(webcamVideo);
        }
      }
    }

    // 🎯 核心方案：导出时不触碰主 Canvas (canvas)，直接返回 bufferCanvas
    // 这样就彻底断绝了预览循环(RAF)对导出画面的干扰
    return bufferCanvas;
  };

  return { isReady, renderFrame, renderFrameForExport: renderFrameForExport as any };
}
