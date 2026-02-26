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


  // 确保所有 intents 都有 ID
  const intentsWithIds = useMemo(() => {
    return (renderGraph.camera.intents || []).map(i => ({
      ...i,
      id: i.id || Math.random().toString(36).slice(2)
    }));
  }, [renderGraph.camera.intents]);

  // 拖拽编辑状态
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragIntentId, setDragIntentId] = useState<string | null>(null);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartIntents, setDragStartIntents] = useState<CameraIntent[]>([]);

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
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`, x, 15);
        ctx.beginPath(); ctx.arc(x, 30, 1.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, 32); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
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

    const intents = intentsWithIds;
    intents.forEach((current, i) => {
      const next = intents[i + 1];
      if (current.targetScale > 1.0) {
        const startX = timeToX(current.t / 1000);
        const endX = next ? timeToX(next.t / 1000) : timeToX(duration);
        const rw = Math.max(4, endX - startX);
        const ry = zoomTrackY + ZOOM_BAR_PADDING;
        const rh = TRACK_HEIGHT - ZOOM_BAR_PADDING * 2;
        const isSelected = current.id === selectedIntentId;

        ctx.save();
        const grad = ctx.createLinearGradient(startX, ry, startX, ry + rh);
        grad.addColorStop(0, isSelected ? '#ffbd69' : '#ff9f43');
        grad.addColorStop(1, isSelected ? '#fa5252' : '#eb6a4c'); // 更深沉的橙红
        ctx.beginPath(); ctx.roundRect(startX, ry, rw, rh, 8);
        ctx.fillStyle = grad;
        ctx.shadowColor = isSelected ? 'rgba(235, 106, 76, 0.4)' : 'rgba(235, 106, 76, 0.2)';
        ctx.shadowBlur = isSelected ? 15 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
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

    // 绘制轨道 2 (视频片段轨道)
    const videoTrackY = TRACKS_START_Y + 1 * (TRACK_HEIGHT + TRACK_GAP);
    const vty = videoTrackY + 4;
    const vth = TRACK_HEIGHT - 8;

    ctx.save();

    // 获取切片列表，如果没有则默认为一个完整切片
    const clips = renderGraph.clips || [{
      id: 'default',
      sourceStartTime: 0,
      duration: duration * 1000,
      startAt: 0
    }];

    clips.forEach(clip => {
      const startX = timeToX(clip.startAt / 1000);
      const w = (clip.duration / 1000) * pps;
      // 减去 1px 缝隙，视觉上区分
      const rw = Math.max(2, w - 1);

      // 仅绘制可见区域
      if (startX + rw < PADDING_LEFT || startX > width) return;

      ctx.beginPath();
      ctx.roundRect(startX, vty, rw, vth, 6);

      // 使用 Apple 风的正蓝色
      const grad = ctx.createLinearGradient(startX, vty, startX, vty + vth);
      grad.addColorStop(0, '#0071e3');
      grad.addColorStop(1, '#005bb7');
      ctx.fillStyle = grad;
      ctx.fill();

      // 内阴影高光，增加立体感
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 如果比较宽，显示时长
      if (rw > 40) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '500 10px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${(clip.duration / 1000).toFixed(1)}s`, startX + rw / 2, vty + vth / 2 + 3);
      }
    });

    ctx.restore();

    ctx.restore();
  }, [width, height, duration, pps, scrollLeft, renderGraph, selectedIntentId, language]);

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
        const playheadColor = '#e5484d'; // Apple 风格的红色线基色
        const totalContentH = (TRACK_HEIGHT + TRACK_GAP) * 2;

        // --- 绘制极致精美的红针 ---
        ctx.save();

        // 1. 顶部表头 (带有倒角的精密设计)
        ctx.fillStyle = playheadColor;
        const headW = 12;
        const headH = 8;
        ctx.beginPath();
        ctx.roundRect(phX - headW / 2, 22, headW, headH, 2);
        ctx.fill();

        // 2. 指向三角形
        ctx.beginPath();
        ctx.moveTo(phX - headW / 2, 22 + headH);
        ctx.lineTo(phX + headW / 2, 22 + headH);
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

  // 这里的关键：所有可能影响静态层的状态变化都要触发重绘
  useEffect(() => {
    drawStatic();
  }, [drawStatic, duration, intentsWithIds, selectedIntentId, language]);

  // ... (保留之前的辅助函数) ...
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
  const hitTestZoomBar = useCallback((x: number, y: number): { intent: CameraIntent; edge: 'left' | 'right' | 'center' } | null => {
    const intents = intentsWithIds;
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
          if (Math.abs(x - startX) < EDGE_HOTZONE) return { intent: current, edge: 'left' };
          if (Math.abs(x - endX) < EDGE_HOTZONE) return { intent: current, edge: 'right' };
          // 检查中间区域
          if (x >= startX && x <= endX) return { intent: current, edge: 'center' };
        }
      }
    }
    return null;
  }, [renderGraph.camera.intents, pps, scrollLeft, duration]);

  // 删除选中的 intent
  const deleteSelectedIntent = useCallback(() => {
    if (!selectedIntentId) return;
    const intents = [...intentsWithIds];
    const idx = intents.findIndex(i => i.id === selectedIntentId);
    if (idx === -1) return;

    const current = intents[idx];
    if (current && current.targetScale > 1.0) {
      const next = intents[idx + 1];
      if (next && next.targetScale === 1.0) {
        intents.splice(idx, 2);
      } else {
        intents.splice(idx, 1);
      }
      onUpdateIntents(intents);
      setSelectedIntentId(null);
    }
  }, [selectedIntentId, intentsWithIds, onUpdateIntents]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTestZoomBar(x, y);

    if (hit) {
      e.preventDefault();
      const intents = [...intentsWithIds];
      const targetId = hit.intent.id!;
      let finalMode: DragMode = 'none';

      // 获取当前正在操作的 intent 索引 (可能会因为 split 变化)
      let idx = intents.findIndex(i => i.id === targetId);

      if (hit.edge === 'center' || hit.edge === 'left') {
        finalMode = hit.edge === 'center' ? 'move-zoom' : 'resize-left';
        if (idx > 0 && intents[idx - 1].targetScale > 1.0) {
          const splitPoint = { ...intents[idx], id: Math.random().toString(36).slice(2), targetScale: 1.0 };
          intents.splice(idx, 0, splitPoint);
          idx++; // 保持索引同步
        }
      } else if (hit.edge === 'right') {
        finalMode = 'resize-right';
        const nextIdx = idx + 1;
        if (intents[nextIdx] && intents[nextIdx].targetScale > 1.0) {
          const splitPoint = { ...intents[nextIdx], id: Math.random().toString(36).slice(2), targetScale: 1.0 };
          intents.splice(nextIdx, 0, splitPoint);
        }
      }

      setSelectedIntentId(targetId);
      setDragStartIntents(intents);
      setDragIntentId(targetId);
      setDragStartX(x);
      setDragMode(finalMode);
      onUpdateIntents(intents);
    } else {
      setSelectedIntentId(null);
      isDragging.current = true;
      setDragMode('seek');
      const time = (x - TIMELINE_CONSTANTS.PADDING_LEFT + scrollLeft) / pps;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  }, [hitTestZoomBar, intentsWithIds, scrollLeft, pps, duration, onSeek, onUpdateIntents]);


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
    } else if (dragMode !== 'none' && dragMode !== 'seek' && dragIntentId) {
      const deltaX = x - dragStartX;
      const deltaTime = Math.round((deltaX / pps) * 1000); // 转换为毫秒

      const newIntents = [...dragStartIntents];
      const idx = newIntents.findIndex(i => i.id === dragIntentId);
      if (idx === -1) return;

      const current = newIntents[idx];
      const prev = newIntents[idx - 1];
      const next = newIntents[idx + 1];
      const MIN_GAP = TIMELINE_CONSTANTS.MIN_INTENT_GAP;
      const totalDurMs = Math.round(duration * 1000);

      if (dragMode === 'move-zoom') {
        if (next && next.targetScale === 1.0) {
          const blockDuration = next.t - current.t;
          let newStartT = current.t + deltaTime;

          const minT = prev ? prev.t + MIN_GAP : 0;
          const nextNext = newIntents[idx + 2];
          const maxT = nextNext ? nextNext.t - blockDuration - MIN_GAP : totalDurMs - blockDuration;

          newStartT = Math.max(minT, Math.min(maxT, newStartT));
          newIntents[idx] = { ...current, t: newStartT };
          newIntents[idx + 1] = { ...next, t: newStartT + blockDuration };
        }
      } else if (dragMode === 'resize-left') {
        let newT = current.t + deltaTime;
        const minT = prev ? prev.t + MIN_GAP : 0;
        const maxT = next ? next.t - MIN_GAP : totalDurMs - MIN_GAP;
        newIntents[idx] = { ...current, t: Math.max(minT, Math.min(maxT, newT)) };
      } else if (dragMode === 'resize-right') {
        if (next) {
          let newT = next.t + deltaTime;
          const minT = current.t + MIN_GAP;
          const nextNext = newIntents[idx + 2];
          const maxT = nextNext ? nextNext.t - MIN_GAP : totalDurMs;
          newIntents[idx + 1] = { ...next, t: Math.max(minT, Math.min(maxT, newT)) };
        }
      }

      // 注意：拖拽时不实时排序，保持 dragStartIntents 的 ID 对应关系
      // 排序只在 mouseUp 时最终确定，或者在拖拽时保证不改变拓扑结构
      onUpdateIntents([...newIntents]);
    }
  }, [dragMode, dragIntentId, dragStartX, dragStartIntents, pps, scrollLeft, duration, onSeek, onUpdateIntents, hitTestZoomBar]);

  const handleMouseLeave = () => {
    setHoverX(null);
  };

  const handleMouseUp = useCallback(() => {
    const wasDraggingZoom = dragMode !== 'none' && dragMode !== 'seek' && dragIntentId;

    isDragging.current = false;
    setDragMode('none');
    setDragIntentId(null);

    if (wasDraggingZoom) {
      // 最终确认：执行 Snap 对齐和标准化
      const intents = intentsWithIds;
      const snappedIntents = intents.map(intent => ({
        ...intent,
        t: snapMs(intent.t)
      })).sort((a, b) => a.t - b.t);

      const normalized = normalizeIntents(snappedIntents);
      onUpdateIntents(normalized);
    } else {
      const normalized = normalizeIntents(intentsWithIds);
      onUpdateIntents(normalized);
    }
  }, [dragMode, dragIntentId, intentsWithIds, normalizeIntents, onUpdateIntents, snapMs, duration]);

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
