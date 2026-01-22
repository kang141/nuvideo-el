import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { RenderGraph, CameraIntent } from '../../types';

interface CanvasTimelineProps {
  duration: number; // 秒
  currentTime: number; // 秒
  onSeek: (time: number) => void;
  renderGraph: RenderGraph;
  onUpdateIntents: (intents: CameraIntent[]) => void;
  className?: string;
}

// 拖拽状态类型
type DragMode = 'none' | 'seek' | 'move-zoom' | 'resize-left' | 'resize-right';

export const CanvasTimeline: React.FC<CanvasTimelineProps> = ({
  duration,
  currentTime,
  onSeek,
  renderGraph,
  onUpdateIntents,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  // 1. 基础计算
  // ... (省略部分以便匹配)

  const minPPS = useMemo(() => {
    if (width <= 0 || duration <= 0) return 100;
    return (width - 60) / duration; // 留出一点边距
  }, [width, duration]);

  const pps = useMemo(() => {
    if (userPPS === null) return minPPS;
    return Math.max(minPPS, userPPS);
  }, [minPPS, userPPS]);

  const totalWidth = useMemo(() => duration * pps, [duration, pps]);

  // 2. 响应尺寸变化
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

  // 3. 绘制核心
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina 适配
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 30; // 左右各留点边距
    const contentWidth = width - paddingLeft * 2;
    
    // 转换函数：时间 -> 坐标
    const timeToX = (t: number) => paddingLeft + t * pps - scrollLeft;
    // 转换函数：坐标 -> 时间
    const xToTime = (x: number) => (x - paddingLeft + scrollLeft) / pps;

    // --- 绘制背景层 ---
    const trackCount = 2; // 目前显示 2 条轨道：Clip 轨道 和 Zoom 轨道
    const trackH = 40; // 每条轨道高度
    const trackGap = 8; // 轨道间距
    const totalContentH = (trackH + trackGap) * trackCount;
    const tracksStartY = 45; // 轨道开始的 Y 坐标，给顶部的 Ruler 留出空间

    // 绘制轨道槽位
    for (let i = 0; i < trackCount; i++) {
        const ty = tracksStartY + i * (trackH + trackGap);
        ctx.beginPath();
        ctx.roundRect(paddingLeft, ty, contentWidth, trackH, 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // --- 绘制刻度线 ---
    // 强制每秒一个刻度，如果缩放极小则跳跃，但默认保持 1s
    let tickStep = 1;
    if (pps < 5) tickStep = 10;
    else if (pps < 10) tickStep = 5;
    else if (pps < 20) tickStep = 2;
    else tickStep = 1; 

    const startT = Math.floor(xToTime(0) / tickStep) * tickStep;
    const endT = Math.ceil(xToTime(width) / tickStep) * tickStep;

    // 显式包含 duration 点
    const ticks = [];
    for (let t = startT; t <= endT; t += tickStep) {
      if (t >= 0 && t <= duration) ticks.push(t);
    }
    if (duration > 0 && (ticks.length === 0 || ticks[ticks.length - 1] < duration)) {
        ticks.push(duration);
    }

    ticks.forEach(t => {
      const x = timeToX(t);
      if (x < paddingLeft || x > width - paddingLeft) return;

      // 每一秒都是 Major 刻度点
      const isMajor = Math.abs(t % 1) < 0.001 || Math.abs(t - duration) < 0.001;
      
      if (isMajor) {
        // 文字标签
        ctx.font = '500 10px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        const label = t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`;
        ctx.fillText(label, x, 15);

        // 主刻度圆点
        ctx.beginPath();
        ctx.arc(x, 30, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      } else {
        // 其他刻度 (如果有 tickStep 小于 1 的情况)
        ctx.beginPath();
        ctx.moveTo(x, 28);
        ctx.lineTo(x, 32);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.stroke();
      }
    });

    // --- 绘制轨道内容 (Zoom 状态长方形条) ---
    // 强制第一条轨道为置顶缩放轨道，增加视觉冲击力
    const zoomTrackY = tracksStartY + 0 * (trackH + trackGap);
    const intents = renderGraph.camera.intents || [];
    
    for (let i = 0; i < intents.length; i++) {
        const current = intents[i];
        const next = intents[i + 1];

        if (current.targetScale > 1.0) {
            const startX = timeToX(current.t / 1000);
            const endX = next ? timeToX(next.t / 1000) : timeToX(duration);
            
            const rw = Math.max(4, endX - startX); 
            const ry = zoomTrackY + 3;
            const rh = trackH - 6;
            const isSelected = i === selectedZoomIndex;

            ctx.save();
            
            // 1. 绘制主体渐变
            const grad = ctx.createLinearGradient(startX, ry, startX, ry + rh);
            grad.addColorStop(0, isSelected ? '#ffbd69' : '#ff9f43');
            grad.addColorStop(1, isSelected ? '#ff8080' : '#ff6b6b');
            
            ctx.beginPath();
            ctx.roundRect(startX, ry, rw, rh, 8);
            ctx.fillStyle = grad;
            
            // 2. 强力外发光效果 (选中时更亮)
            ctx.shadowColor = isSelected ? 'rgba(255, 107, 107, 0.8)' : 'rgba(255, 107, 107, 0.4)';
            ctx.shadowBlur = isSelected ? 20 : 12;
            ctx.fill();
            ctx.shadowBlur = 0;

            // 3. 内部边框与选中高亮
            ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.stroke();
            
            // 4. 文字
            if (rw > 50) {
                ctx.font = '900 10px "Inter", sans-serif';
                ctx.fillStyle = isSelected ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.7)';
                ctx.textAlign = 'left';
                ctx.fillText('FILTER: ZOOM', startX + 12, ry + rh / 2 + 4);
            }

            // 5. 拖拽手柄图标 (仅在选中或足够宽时)
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(startX + 2, ry + 10, 2, rh - 20);
            ctx.fillRect(startX + rw - 4, ry + 10, 2, rh - 20);

            ctx.restore();
        }
    }

    // --- 绘制轨道 2 (视频 Clip) ---
    const videoTrackY = tracksStartY + 1 * (trackH + trackGap);
    ctx.beginPath();
    ctx.roundRect(paddingLeft, videoTrackY + 4, contentWidth, trackH - 8, 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();

    // --- 绘制鼠标悬浮虚影 ---
    if (hoverX !== null) {
      const hx = Math.max(paddingLeft, Math.min(width - paddingLeft, hoverX));
      ctx.beginPath();
      ctx.moveTo(hx, tracksStartY);
      ctx.lineTo(hx, tracksStartY + totalContentH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- 绘制播放头 (红线) ---
    const phX = timeToX(currentTime);
    if (phX >= paddingLeft && phX <= width - paddingLeft) {
      const playheadColor = '#ff4757';
      ctx.beginPath();
      ctx.moveTo(phX, 35);
      ctx.lineTo(phX, tracksStartY + totalContentH + 10);
      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(phX, 35, 4, 0, Math.PI * 2);
      ctx.fillStyle = playheadColor;
      ctx.fill();
    }
  }, [width, height, duration, currentTime, pps, scrollLeft, hoverX, renderGraph, selectedZoomIndex]);

  useEffect(() => {
    draw();
  }, [draw]);

  const isDragging = useRef(false);
  const paddingLeft = 30;

  // 辅助函数：检测点击位置是否在某个缩放条上
  const hitTestZoomBar = useCallback((x: number, y: number): { index: number; edge: 'left' | 'right' | 'center' } | null => {
    const intents = renderGraph.camera.intents || [];
    const trackH = 40;
    const tracksStartY = 45;
    const zoomTrackY = tracksStartY;
    
    const timeToX = (t: number) => paddingLeft + t * pps - scrollLeft;
    
    for (let i = 0; i < intents.length; i++) {
      const current = intents[i];
      const next = intents[i + 1];
      
      if (current.targetScale > 1.0) {
        const startX = timeToX(current.t / 1000);
        const endX = next ? timeToX(next.t / 1000) : timeToX(duration);
        const ry = zoomTrackY + 3;
        const rh = trackH - 6;
        
        // 检查 Y 范围
        if (y >= ry && y <= ry + rh) {
          // 检查左右边缘 (12px 的热区)
          if (Math.abs(x - startX) < 12) return { index: i, edge: 'left' };
          if (Math.abs(x - endX) < 12) return { index: i, edge: 'right' };
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
      setSelectedZoomIndex(hit.index); // 选中
      const intents = renderGraph.camera.intents || [];
      setDragStartIntents([...intents]);
      setDragZoomIndex(hit.index);
      setDragStartX(x);
      
      if (hit.edge === 'left') {
        setDragMode('resize-left');
      } else if (hit.edge === 'right') {
        setDragMode('resize-right');
      } else {
        setDragMode('move-zoom');
      }
    } else {
      setSelectedZoomIndex(-1); // 取消选中
      isDragging.current = true;
      setDragMode('seek');
      const time = (x - paddingLeft + scrollLeft) / pps;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  }, [hitTestZoomBar, renderGraph.camera.intents, scrollLeft, pps, duration, onSeek]);

  // ... (handleMouseMove 等代码省略，逻辑已在)

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
      const time = (x - paddingLeft + scrollLeft) / pps;
      onSeek(Math.max(0, Math.min(duration, time)));
    } else if (dragMode !== 'none' && dragMode !== 'seek' && dragZoomIndex >= 0) {
      const deltaX = x - dragStartX;
      const deltaTime = (deltaX / pps) * 1000; // 转换为毫秒
      
      const newIntents = [...dragStartIntents];
      const currentIntent = newIntents[dragZoomIndex];
      const nextIntent = newIntents[dragZoomIndex + 1];
      
      if (dragMode === 'move-zoom') {
        // 移动整个缩放区间
        const newT = Math.max(0, currentIntent.t + deltaTime);
        const shift = newT - currentIntent.t;
        newIntents[dragZoomIndex] = { ...currentIntent, t: newT };
        if (nextIntent && nextIntent.targetScale <= 1.0) {
          newIntents[dragZoomIndex + 1] = { ...nextIntent, t: Math.max(newT + 100, nextIntent.t + shift) };
        }
      } else if (dragMode === 'resize-left') {
        // 调整开始时间
        const newT = Math.max(0, currentIntent.t + deltaTime);
        if (!nextIntent || newT < nextIntent.t - 100) {
          newIntents[dragZoomIndex] = { ...currentIntent, t: newT };
        }
      } else if (dragMode === 'resize-right') {
        // 调整结束时间
        if (nextIntent) {
          const newEndT = Math.max(currentIntent.t + 100, nextIntent.t + deltaTime);
          newIntents[dragZoomIndex + 1] = { ...nextIntent, t: Math.min(duration * 1000, newEndT) };
        }
      }
      
      // 排序并更新
      newIntents.sort((a, b) => a.t - b.t);
      onUpdateIntents(newIntents);
    }
  }, [dragMode, dragZoomIndex, dragStartX, dragStartIntents, pps, scrollLeft, duration, onSeek, onUpdateIntents, hitTestZoomBar]);

  const handleMouseLeave = () => {
    setHoverX(null);
  };

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    setDragMode('none');
    setDragZoomIndex(-1);
  }, []);

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
  }, [handleMouseMove, handleMouseUp, pps, scrollLeft, duration, width]);


  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setUserPPS(prev => {
        const current = prev || minPPS;
        return Math.max(minPPS, Math.min(current * delta, 2000));
      });
    } else {
      const delta = e.deltaX || e.deltaY;
      setScrollLeft(prev => {
        const next = prev + delta;
        const maxScroll = Math.max(0, totalWidth - (width - 60));
        return Math.max(0, Math.min(next, maxScroll));
      });
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full cursor-crosshair select-none overflow-hidden ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
