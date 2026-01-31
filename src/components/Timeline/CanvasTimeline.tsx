import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { RenderGraph, CameraIntent } from '../../types';
import { Language } from '@/i18n/translations';

interface CanvasTimelineProps {
  duration: number; // 秒
  currentTime: number; // 秒（仅用于初始化/拖拽反馈）
  videoRef: React.RefObject<HTMLVideoElement>; // 新增：直接引用视频以获取高频进度
  onSeek: (time: number) => void;
  renderGraph: RenderGraph;
  onUpdateIntents: (intents: CameraIntent[]) => void;
  className?: string;
  language: Language;
}

// 拖拽状态类型
type DragMode = 'none' | 'seek' | 'move-zoom' | 'resize-left' | 'resize-right';

// 时间轴布局常量
const TIMELINE_CONSTANTS = {
  PADDING_LEFT: 30,
  TRACK_HEIGHT: 40,
  TRACK_GAP: 8,
  TRACKS_START_Y: 45,
  MIN_INTENT_GAP: 100, // ms
  EDGE_HOTZONE: 12, // px
  ZOOM_BAR_PADDING: 3, // px
  ABSOLUTE_MIN_PPS: 20, // 最小像素/秒，保证操作手感
  MAX_PPS: 2000, // 最大缩放
} as const;

export const CanvasTimeline: React.FC<CanvasTimelineProps> = ({
  duration,
  videoRef,
  onSeek,
  renderGraph,
  onUpdateIntents,
  className,
  language
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  // PPS (Pixels Per Second)
  const [userPPS, setUserPPS] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // 拖拽编辑状态
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragZoomIndex, setDragZoomIndex] = useState<number>(-1);
  const [selectedZoomIndex, setSelectedZoomIndex] = useState<number>(-1); // 新增：选中状态
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartIntents, setDragStartIntents] = useState<CameraIntent[]>([]);
  
  // 音频声纹数据
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const isProcessingAudio = useRef(false);
  
  const minPPS = useMemo(() => {
    if (width <= 0 || duration <= 0) return TIMELINE_CONSTANTS.ABSOLUTE_MIN_PPS;
    // 基础 minPPS 是"刚好铺满全屏"的比例，但不能低于绝对最小值
    return Math.max(TIMELINE_CONSTANTS.ABSOLUTE_MIN_PPS, (width - 60) / duration);
  }, [width, duration]);
  
  const pps = useMemo(() => {
    if (userPPS === null) return minPPS;
    return Math.max(TIMELINE_CONSTANTS.ABSOLUTE_MIN_PPS, userPPS);
  }, [minPPS, userPPS]);

  const totalWidth = useMemo(() => Math.max(width, duration * pps + 100), [width, duration, pps]);

  // 2. 响应尺寸与 DPR 变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawStatic = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    
    // 仅在尺寸变更时才重置 canvas 宽高（重置会导致内容清空）
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); 
    ctx.clearRect(0, 0, width, height);

    const { PADDING_LEFT, TRACK_HEIGHT, TRACK_GAP, TRACKS_START_Y, ZOOM_BAR_PADDING } = TIMELINE_CONSTANTS;
    // 强制 duration 最小值，防止 pps 飙升
    const safeDuration = Math.max(duration, 0.1);
    const timeToX = (t: number) => PADDING_LEFT + t * pps - scrollLeft;
    const xToTime = (x: number) => (x - PADDING_LEFT + scrollLeft) / pps;

    const trackCount = 2;

    // 绘制轨道槽位
    const contentWidth = width - PADDING_LEFT * 2;
    for (let i = 0; i < trackCount; i++) {
        const ty = TRACKS_START_Y + i * (TRACK_HEIGHT + TRACK_GAP);
        ctx.beginPath();
        ctx.roundRect(PADDING_LEFT, ty, contentWidth, TRACK_HEIGHT, 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // 绘制刻度线
    let tickStep = pps < 5 ? 10 : pps < 10 ? 5 : pps < 20 ? 2 : 1;
    const startT = Math.floor(xToTime(0) / tickStep) * tickStep;
    const endT = Math.ceil(xToTime(width) / tickStep) * tickStep;

    for (let t = startT; t <= endT; t += tickStep) {
      if (t < 0 || t > safeDuration) continue;
      const x = Math.round(timeToX(t));
      if (x < PADDING_LEFT || x > width - PADDING_LEFT) continue;

      const isMajor = Math.abs(t % 1) < 0.001 || Math.abs(t - safeDuration) < 0.001;
      if (isMajor) {
        ctx.font = '600 10px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`, x, 15);
        ctx.beginPath(); ctx.arc(x, 30, 1.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, 32); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.stroke();
      }
    }

    // 绘制 Zoom 条
    const zoomTrackY = TRACKS_START_Y;
    
    // --- Clipping: 限制绘制区域，防止溢出 ---
    ctx.save();
    ctx.beginPath();
    // 允许绘制的区域：左边距到右边距之间
    // 加一点点 padding 防止半边被切太硬
    ctx.rect(PADDING_LEFT, 0, width - PADDING_LEFT * 2, height);
    ctx.clip();

    const intents = renderGraph.camera.intents || [];
    intents.forEach((current, i) => {
      const next = intents[i + 1];
      if (current.targetScale > 1.0) {
        const startX = timeToX(current.t / 1000);
        const endX = next ? timeToX(next.t / 1000) : timeToX(duration);
        const rw = Math.max(4, endX - startX);
        const ry = zoomTrackY + ZOOM_BAR_PADDING;
        const rh = TRACK_HEIGHT - ZOOM_BAR_PADDING * 2;
        const isSelected = i === selectedZoomIndex;

        ctx.save();
        const grad = ctx.createLinearGradient(startX, ry, startX, ry + rh);
        grad.addColorStop(0, isSelected ? '#ffbd69' : '#ff9f43');
        grad.addColorStop(1, isSelected ? '#ff8080' : '#ff6b6b');
        ctx.beginPath(); ctx.roundRect(startX, ry, rw, rh, 8);
        ctx.fillStyle = grad;
        ctx.shadowColor = isSelected ? 'rgba(255, 107, 107, 0.8)' : 'rgba(255, 107, 107, 0.4)';
        ctx.shadowBlur = isSelected ? 20 : 12;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();
        if (rw > 50) {
            ctx.font = '900 10px "Inter", sans-serif';
            ctx.fillStyle = isSelected ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.7)';
            ctx.textAlign = 'center';
            ctx.fillText('ZOOM', startX + rw / 2, ry + rh / 2 + 3.5);
        }
        ctx.restore();
      }
    });

    // 退出 Clipping
    ctx.restore();

    // 绘制轨道 2 (视频 + 音频声纹)
    const videoTrackY = TRACKS_START_Y + 1 * (TRACK_HEIGHT + TRACK_GAP);
    const vty = videoTrackY + 4;
    const vth = TRACK_HEIGHT - 8;
    
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PADDING_LEFT, vty, contentWidth, vth, 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.clip(); // 裁剪以确保波形不超出轨道

    ctx.restore();
  }, [width, height, duration, pps, scrollLeft, renderGraph, selectedZoomIndex, language]);

  // 4. 驱动播放头的高频同步循环
  useEffect(() => {
    let raf: number;
    
    const tick = () => {
      const video = videoRef.current;
      const canvas = playheadCanvasRef.current;
      if (!video || !canvas || width <= 0 || height <= 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); 
      ctx.clearRect(0, 0, width, height);

      const { PADDING_LEFT, TRACK_HEIGHT, TRACK_GAP, TRACKS_START_Y } = TIMELINE_CONSTANTS;
      const timeToX = (t: number) => PADDING_LEFT + t * pps - scrollLeft;
      
      const curTime = video.currentTime;
      const phX = Math.round(timeToX(curTime));

      if (phX >= PADDING_LEFT && phX <= width - PADDING_LEFT) {
        const playheadColor = '#ff4757';
        const totalContentH = (TRACK_HEIGHT + TRACK_GAP) * 2;

        // --- 绘制极致精美的红针 ---
        ctx.save();
        
        // 1. 顶部表头 (带有倒角的精密设计)
        ctx.fillStyle = playheadColor;
        const headW = 12;
        const headH = 8;
        ctx.beginPath();
        ctx.roundRect(phX - headW/2, 22, headW, headH, 2);
        ctx.fill();
        
        // 2. 指向三角形
        ctx.beginPath();
        ctx.moveTo(phX - headW/2, 22 + headH);
        ctx.lineTo(phX + headW/2, 22 + headH);
        ctx.lineTo(phX, 22 + headH + 4);
        ctx.closePath();
        ctx.fill();

        // 3. 极细指向针 (1px 物理对齐)
        ctx.beginPath();
        ctx.moveTo(phX, 32);
        ctx.lineTo(phX, TRACKS_START_Y + totalContentH + 10);
        ctx.strokeStyle = playheadColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // 4. 高亮圆点
        ctx.beginPath();
        ctx.arc(phX, 26, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fill();

        ctx.restore();
      }

      // 悬浮预览线
      if (hoverX !== null) {
        const hx = Math.round(Math.max(PADDING_LEFT, Math.min(width - PADDING_LEFT, hoverX)));
        ctx.beginPath();
        ctx.moveTo(hx, TRACKS_START_Y);
        ctx.lineTo(hx, TRACKS_START_Y + (TRACK_HEIGHT + TRACK_GAP) * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [width, height, pps, scrollLeft, hoverX, videoRef]);

  // 加载并解析音频波形
  useEffect(() => {
    const source = renderGraph.audioSource;
    if (!source || isProcessingAudio.current) return;

    const processAudio = async () => {
      isProcessingAudio.current = true;
      try {
        const response = await fetch(source);
        const arrayBuffer = await response.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decodedData = await audioCtx.decodeAudioData(arrayBuffer);
        
        const channelData = decodedData.getChannelData(0);
        const step = Math.ceil(channelData.length / 1500); // 采样 1500 个点
        const peaks = [];
        
        for (let i = 0; i < 1500; i++) {
          let max = 0;
          const start = i * step;
          const end = Math.min(start + step, channelData.length);
          for (let j = start; j < end; j += 10) { // 步进采样提升性能
            const val = Math.abs(channelData[j]);
            if (val > max) max = val;
          }
          // 对 peak 进行一点平滑处理，视觉更美观
          peaks.push(Math.pow(max, 0.8)); 
        }
        
        setWaveformPeaks(peaks);
        await audioCtx.close();
      } catch (err) {
        console.warn('[CanvasTimeline] Waveform generation failed:', err);
      } finally {
        isProcessingAudio.current = false;
      }
    };

    processAudio();
  }, [renderGraph.audioSource]);

  // 这里的关键：所有可能影响静态层的状态变化都要触发重绘
  useEffect(() => {
    drawStatic();
  }, [drawStatic, duration, renderGraph, waveformPeaks]);

  const isDragging = useRef(false);
  const snapMs = useCallback((ms: number) => {
    const fps = renderGraph.config?.fps || 30;
    const step = Math.max(1, Math.round(1000 / fps));
    return Math.round(ms / step) * step;
  }, [renderGraph.config?.fps]);
  const normalizeIntents = useCallback((intents: CameraIntent[]) => {
    const fps = renderGraph.config?.fps || 30;
    const step = Math.max(1, Math.round(1000 / fps));
    const gap = Math.max(step, 50);
    const dur = Math.round(duration * 1000);
    const arr = intents.map(i => ({ ...i, t: Math.max(0, Math.min(dur, Math.round(i.t))) })).sort((a, b) => a.t - b.t);
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      if (cur.t <= prev.t + gap) {
        arr[i] = { ...cur, t: Math.min(dur, prev.t + gap) };
      }
    }
    return arr;
  }, [renderGraph.config?.fps, duration]);

  // 辅助函数：检测点击位置是否在某个缩放条上
  const hitTestZoomBar = useCallback((x: number, y: number): { index: number; edge: 'left' | 'right' | 'center' } | null => {
    const intents = renderGraph.camera.intents || [];
    const { PADDING_LEFT, TRACK_HEIGHT, TRACKS_START_Y, ZOOM_BAR_PADDING, EDGE_HOTZONE } = TIMELINE_CONSTANTS;
    const zoomTrackY = TRACKS_START_Y;
    
    const timeToX = (t: number) => PADDING_LEFT + t * pps - scrollLeft;
    
    for (let i = 0; i < intents.length; i++) {
      const current = intents[i];
      const next = intents[i + 1];
      
      if (current.targetScale > 1.0) {
        const startX = timeToX(current.t / 1000);
        const endX = next ? timeToX(next.t / 1000) : timeToX(duration);
        const ry = zoomTrackY + ZOOM_BAR_PADDING;
        const rh = TRACK_HEIGHT - ZOOM_BAR_PADDING * 2;
        
        // 检查 Y 范围
        if (y >= ry && y <= ry + rh) {
          // 检查左右边缘
          if (Math.abs(x - startX) < EDGE_HOTZONE) return { index: i, edge: 'left' };
          if (Math.abs(x - endX) < EDGE_HOTZONE) return { index: i, edge: 'right' };
          // 检查中间区域
          if (x >= startX && x <= endX) return { index: i, edge: 'center' };
        }
      }
    }
    return null;
  }, [renderGraph.camera.intents, pps, scrollLeft, duration]);

  // 删除选中的 intent
  const deleteSelectedIntent = useCallback(() => {
    if (selectedZoomIndex < 0) return;
    const intents = [...renderGraph.camera.intents];
    
    // 如果删除的是缩放意图，我们通常也要处理它后面的恢复意图(如果是自动生成的)
    // 逻辑：删除当前 i 和 i+1 (如果 i+1 是 1.0)
    const current = intents[selectedZoomIndex];
    if (current && current.targetScale > 1.0) {
      const next = intents[selectedZoomIndex + 1];
      if (next && next.targetScale === 1.0) {
        intents.splice(selectedZoomIndex, 2);
      } else {
        intents.splice(selectedZoomIndex, 1);
      }
      onUpdateIntents(intents);
      setSelectedZoomIndex(-1);
    }
  }, [selectedZoomIndex, renderGraph.camera.intents, onUpdateIntents]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const hit = hitTestZoomBar(x, y);
    
    if (hit) {
      e.preventDefault();
      const intents = [...(renderGraph.camera.intents || [])];
      let finalIndex = hit.index;
      let finalMode: DragMode = 'none';

      // --- 核心修复：解耦逻辑 ---
      // 场景 1: 拖动整个块 或 缩放左边缘
      if (hit.edge === 'center' || hit.edge === 'left') {
        finalMode = hit.edge === 'center' ? 'move-zoom' : 'resize-left';
        // 如果该块起始点前面紧挨着另一个缩放块，插入一个 1.0 进行切分
        if (hit.index > 0 && intents[hit.index - 1].targetScale > 1.0) {
          const splitPoint = { ...intents[hit.index], targetScale: 1.0 };
          intents.splice(hit.index, 0, splitPoint);
          finalIndex = hit.index + 1;
        }
      } 
      // 场景 2: 缩放右边缘
      else if (hit.edge === 'right') {
        finalMode = 'resize-right';
        const nextIdx = hit.index + 1;
        // 如果该块的结束点同时也是下一个缩放块的起始点 (即 next 还是大于 1.0)
        if (intents[nextIdx] && intents[nextIdx].targetScale > 1.0) {
          const splitPoint = { ...intents[nextIdx], targetScale: 1.0 };
          intents.splice(nextIdx, 0, splitPoint);
          // 这种情况下 finalIndex 不变，因为我们操作的是原来的 next，它现在还在那个位置，只是后面多了一个点
        }
      }

      setSelectedZoomIndex(finalIndex);
      setDragStartIntents(intents);
      setDragZoomIndex(finalIndex);
      setDragStartX(x);
      setDragMode(finalMode);
      
      // 同步到状态中，防止渲染滞后
      onUpdateIntents(intents);
    } else {
      setSelectedZoomIndex(-1); // 取消选中
      isDragging.current = true;
      setDragMode('seek');
      const time = (x - TIMELINE_CONSTANTS.PADDING_LEFT + scrollLeft) / pps;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  }, [hitTestZoomBar, renderGraph.camera.intents, scrollLeft, pps, duration, onSeek, onUpdateIntents]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedIntent();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedIntent]);

  const handleMouseMove = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverX(x);

    // 更新鼠标指针样式
    const y = e.clientY - rect.top;
    const hit = hitTestZoomBar(x, y);
    if (hit) {
      if (hit.edge === 'left' || hit.edge === 'right') {
        containerRef.current.style.cursor = 'ew-resize';
      } else {
        containerRef.current.style.cursor = 'grab';
      }
    } else {
      containerRef.current.style.cursor = 'crosshair';
    }

    // 处理拖拽
    if (dragMode === 'seek' && isDragging.current) {
      const time = (x - TIMELINE_CONSTANTS.PADDING_LEFT + scrollLeft) / pps;
      onSeek(Math.max(0, Math.min(duration, time)));
    } else if (dragMode !== 'none' && dragMode !== 'seek' && dragZoomIndex >= 0) {
      const deltaX = x - dragStartX;
      const deltaTime = Math.round((deltaX / pps) * 1000); // 转换为毫秒
      
      // 性能优化：拖动过程中不进行 snap 对齐，减少计算开销
      const newIntents = [...dragStartIntents];
      const current = dragStartIntents[dragZoomIndex];
      const prev = dragStartIntents[dragZoomIndex - 1];
      const next = dragStartIntents[dragZoomIndex + 1];
      
      const MIN_GAP = TIMELINE_CONSTANTS.MIN_INTENT_GAP;
      
      if (dragMode === 'move-zoom') {
        // 移动整个区间 (需要同时移动开始和结束点)
        // 这里的 logic 是：current 是缩放开始，next 是缩放恢复
        if (next && next.targetScale === 1.0) {
          const duration_ms = (next.t - current.t);
          // 拖动中使用原始值，不 snap，提升流畅度
          let newStartT = current.t + deltaTime;
                  
          // 限制范围（拖动中使用宽松的边界检查）
          const minT = prev ? prev.t + MIN_GAP : 0;
          const nextNext = dragStartIntents[dragZoomIndex + 2];
          const rawMaxT = nextNext ? nextNext.t - duration_ms - MIN_GAP : duration * 1000 - duration_ms;
                  
          newStartT = Math.max(minT, Math.min(rawMaxT, newStartT));
                  
          const newEndT = newStartT + duration_ms;
                  
          // 二次检查：确保结束点不会超出边界
          const absoluteMaxEndT = nextNext ? nextNext.t - MIN_GAP : duration * 1000;
          if (newEndT > absoluteMaxEndT) {
            newStartT = absoluteMaxEndT - duration_ms;
          }
                  
          newIntents[dragZoomIndex] = { ...current, t: newStartT };
          newIntents[dragZoomIndex + 1] = { ...next, t: newStartT + duration_ms };
        }
      } else if (dragMode === 'resize-left') {
        // 调整左边缘（拖动中不 snap）
        let newT = current.t + deltaTime;
        const minT = prev ? prev.t + MIN_GAP : 0;
        const maxT = next ? next.t - MIN_GAP : duration * 1000 - MIN_GAP;
        newIntents[dragZoomIndex] = { ...current, t: Math.max(minT, Math.min(maxT, newT)) };
      } else if (dragMode === 'resize-right') {
        // 调整右边缘 (即修改 next 的时间，拖动中不 snap)
        if (next) {
          let newT = next.t + deltaTime;
          const minT = current.t + MIN_GAP;
          const nextNext = dragStartIntents[dragZoomIndex + 2];
          const maxT = nextNext ? nextNext.t - MIN_GAP : duration * 1000;
          newIntents[dragZoomIndex + 1] = { ...next, t: Math.max(minT, Math.min(maxT, newT)) };
        }
      }
      
      // 关键修复：即便在拖动中，也要保持 intents 的排序和基本合法性
      // 否则物理引擎在乱序的关键帧下会产生剧烈的画面跳变（闪烁）
      const sortedIntents = newIntents.sort((a, b) => a.t - b.t);
      onUpdateIntents(sortedIntents);
    }
  }, [dragMode, dragZoomIndex, dragStartX, dragStartIntents, pps, scrollLeft, duration, onSeek, onUpdateIntents, hitTestZoomBar]);

  const handleMouseLeave = () => {
    setHoverX(null);
  };

  const handleMouseUp = useCallback(() => {
    const wasDraggingZoom = dragMode !== 'none' && dragMode !== 'seek' && dragZoomIndex >= 0;
    
    isDragging.current = false;
    setDragMode('none');
    setDragZoomIndex(-1);
    
    // 如果刚才在拖动 zoom 块，需要进行 snap 对齐和推挤处理
    if (wasDraggingZoom) {
      const intents = renderGraph.camera.intents || [];
      const snappedIntents = intents.map(intent => ({
        ...intent,
        t: snapMs(intent.t)
      }));
      
      // 应用推挤逻辑，确保最小间距
      const MIN_GAP = TIMELINE_CONSTANTS.MIN_INTENT_GAP;
      const durMs = Math.round(duration * 1000);
      
      for (let i = 1; i < snappedIntents.length; i++) {
        const prev = snappedIntents[i - 1];
        const cur = snappedIntents[i];
        if (cur.t <= prev.t + MIN_GAP) {
          snappedIntents[i] = { ...cur, t: snapMs(Math.min(durMs, prev.t + MIN_GAP)) };
        }
      }
      
      // 最终标准化
      const normalized = normalizeIntents(snappedIntents);
      onUpdateIntents(normalized);
    } else {
      // 普通情况，只做标准化
      const intents = renderGraph.camera.intents || [];
      const normalized = normalizeIntents(intents);
      onUpdateIntents(normalized);
    }
  }, [dragMode, dragZoomIndex, renderGraph.camera.intents, normalizeIntents, onUpdateIntents, snapMs, duration]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setUserPPS(prev => {
        const current = prev || minPPS;
        return Math.max(TIMELINE_CONSTANTS.ABSOLUTE_MIN_PPS, Math.min(current * delta, TIMELINE_CONSTANTS.MAX_PPS));
      });
    } else {
      const delta = e.deltaX || e.deltaY;
      setScrollLeft(prev => {
        const next = prev + delta;
        const maxScroll = Math.max(0, totalWidth - (width - 60));
        return Math.max(0, Math.min(next, maxScroll));
      });
    }
  }, [minPPS, totalWidth, width]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleMouseMove, handleMouseUp, handleWheel]);

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full cursor-crosshair select-none overflow-hidden ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={staticCanvasRef} className="absolute inset-0 w-full h-full" />
      <canvas ref={playheadCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>
  );
};

export const CanvasTimelineMemo = React.memo(CanvasTimeline);
