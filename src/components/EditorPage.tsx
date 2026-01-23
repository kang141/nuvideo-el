import { useState, useRef, useEffect, useCallback } from 'react';
import type { RenderGraph, CameraIntent } from '../types';
import { cn } from '@/lib/utils';
import { QualityConfig } from '../constants/quality';

// Hooks
import { useVideoPlayback } from '../hooks/editor/useVideoPlayback';
import { useVideoRenderer } from '../hooks/editor/useVideoRenderer';
import { useVideoExport } from '../hooks/editor/useVideoExport';

// Components
import { EditorHeader } from './Editor/EditorHeader';
import { DesignPanel } from './Editor/DesignPanel';
import { ControlBar } from './Editor/ControlBar';
import { CanvasPreview } from './Editor/CanvasPreview';
import { TimelineSectionMemo } from './Editor/TimelineSection';
import { ExportOverlay } from './Editor/ExportOverlay';

interface EditorPageProps {
  renderGraph: RenderGraph | null;
  onBack: () => void;
}

export function EditorPage({ renderGraph: initialGraph, onBack }: EditorPageProps) {
  // 1. 数据状态 (Single Source of Truth)
  const [graph, setGraph] = useState<RenderGraph | null>(initialGraph);

  // 2. UI 状态
  const [browsingCategory, setBrowsingCategory] = useState('macOS');
  const [activeWallpaper, setActiveWallpaper] = useState({ category: 'macOS', file: 'sequoia-dark.jpg' });
  const [activeTab, setActiveTab] = useState('appearance');
  const [hideIdle, setHideIdle] = useState(false);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  
  // 生成默认文件名 (改为 mp4，前缀改为 nubideo)
  const defaultFileName = `nubideo ${new Date().toLocaleDateString().replace(/\//g, '-')} at ${new Date().getHours()}.${new Date().getMinutes()}.mp4`;
  const [filename, setFilename] = useState(defaultFileName);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const LAST_DIR_KEY = 'nuvideo_last_export_dir';

  // 初始化：尝试从缓存加载目录并预设路径
  useEffect(() => {
    const cachedDir = localStorage.getItem(LAST_DIR_KEY);
    if (cachedDir && !exportPath) {
      // 如果有缓存目录，自动拼接当前文件名作为预设路径
      const pathSeparator = cachedDir.includes('\\') ? '\\' : '/';
      const lastChar = cachedDir.charAt(cachedDir.length - 1);
      const isPathEndWithSlash = lastChar === '/' || lastChar === '\\';
      const initialPath = isPathEndWithSlash ? `${cachedDir}${filename}` : `${cachedDir}${pathSeparator}${filename}`;
      
      console.log('[EditorPage] Using cached directory:', cachedDir);
      setExportPath(initialPath);
    }
  }, [filename]);

  // 3. 处理文件操作
  const handleDelete = useCallback(() => {
    if (confirm('确定要放弃本次录制吗？所有未导出的改动都将丢失。')) {
      onBack();
    }
  }, [onBack]);

  const handlePickAddress = useCallback(async () => {
    try {
      const cachedDir = localStorage.getItem(LAST_DIR_KEY);
      const result = await (window as any).ipcRenderer.invoke('show-save-dialog', {
        defaultPath: cachedDir || undefined,
        defaultName: filename
      });

      if (!result.canceled && result.filePath) {
        const fullPath = result.filePath;
        setExportPath(fullPath);
        
        // 提取目录并存入缓存
        const lastSlashIndex = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
        if (lastSlashIndex > -1) {
          const dir = fullPath.substring(0, lastSlashIndex);
          localStorage.setItem(LAST_DIR_KEY, dir);
          console.log('[EditorPage] Directory cached:', dir);
        }

        const name = fullPath.split(/[\\/]/).pop();
        if (name) setFilename(name);
      }
    } catch (err) {
      console.error('Failed to pick address:', err);
    }
  }, [filename]);

  // 2. 引用
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 3. 处理全屏逻辑
  const toggleFullscreen = () => {
    const next = !isFullscreenPreview;
    setIsFullscreenPreview(next);
  };

  // 4. 业务逻辑 Hooks
  const {
    isPlaying,
    setIsPlaying,
    currentTime,
    maxDuration,
    togglePlay,
    handleSeek
  } = useVideoPlayback(videoRef, graph);

  // 监听键盘快捷键 (ESC 退出全屏, Space 播放/暂停, Z 添加缩放)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreenPreview) {
        setIsFullscreenPreview(false);
      }
      
      // 空格键控制播放/暂停
      if (e.code === 'Space') {
        e.preventDefault(); // 防止页面滚动
        togglePlay();
      }
      
      // Z 键添加缩放关键帧
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        const currentTimeMs = (videoRef.current?.currentTime || 0) * 1000;
        const currentIntents = graph?.camera.intents || [];
        
        // 查找当前生效的 scale
        let activeScale = 1.0;
        for (const intent of currentIntents) {
          if (intent.t <= currentTimeMs) {
            activeScale = intent.targetScale;
          }
        }
        
        if (graph) {
          let newIntents = [...currentIntents];
          
          if (activeScale >= 1.5) {
            // 如果已经在缩放，按 Z 表示“在这里结束缩放”
            newIntents.push({
              t: currentTimeMs,
              targetCx: 0.5,
              targetCy: 0.5,
              targetScale: 1.0
            });
            console.log(`[Hotkey Z] End zoom at ${currentTimeMs}ms`);
          } else {
            // --- 核心：找到当前时间点的鼠标位置 ---
            const mouseEvents = graph.mouse || [];
            let targetCx = 0.5;
            let targetCy = 0.5;
            
            // 找到离 currentTimeMs 最近的一个鼠标事件
            const activeMouseEvent = mouseEvents.slice().reverse().find(m => m.t <= currentTimeMs) || mouseEvents[0];
            if (activeMouseEvent) {
              targetCx = activeMouseEvent.x;
              targetCy = activeMouseEvent.y;
              console.log(`[Hotkey Z] Found mouse at (${targetCx}, ${targetCy})`);
            }

            // 如果是原始大小，按 Z 表示“在这里开始缩放 1 秒”
            newIntents.push({
              t: currentTimeMs,
              targetCx,
              targetCy,
              targetScale: 2.0
            });
            
            // 自动在 1 秒后（或视频结束前）添加恢复
            const endT = Math.min(currentTimeMs + 1000, maxDuration * 1000 - 100);
            newIntents.push({
              t: endT,
              targetCx: 0.5,
              targetCy: 0.5,
              targetScale: 1.0
            });
            console.log(`[Hotkey Z] Add 1s zoom block at ${currentTimeMs}ms targeting mouse`);
          }
          
          // 过滤掉同一时间点的重复项，并排序
          const finalIntents = newIntents
            .sort((a, b) => a.t - b.t)
            .filter((intent, idx, self) => 
              idx === 0 || Math.abs(intent.t - self[idx-1].t) > 10
            );

          setGraph({
            ...graph,
            camera: {
              ...graph.camera,
              intents: finalIntents
            }
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreenPreview, togglePlay, graph, maxDuration]);

  const { isReady, renderFrame } = useVideoRenderer({
    videoRef,
    canvasRef,
    renderGraph: graph!,
    bgCategory: activeWallpaper.category,
    bgFile: activeWallpaper.file,
  });

  // 镜头控制逻辑
  const handleResetZoom = useCallback(() => {
    if (!graph) return;
    setGraph({
      ...graph,
      camera: {
        ...graph.camera,
        intents: [{ t: 0, targetCx: 0.5, targetCy: 0.5, targetScale: 1.0 }]
      }
    });
  }, [graph]);

  // 手动添加缩放意图（在当前时间点）
  const handleAddManualZoom = useCallback((scale: number, cx?: number, cy?: number) => {
    if (!graph) return;
    const currentTimeMs = (videoRef.current?.currentTime || 0) * 1000;
    
    let targetCx = cx;
    let targetCy = cy;

    // 如果没有传入坐标，则尝试自动寻找该时间点的鼠标位置
    if (targetCx === undefined || targetCy === undefined) {
      const activeMouseEvent = (graph.mouse || []).slice().reverse().find(m => m.t <= currentTimeMs) || graph.mouse?.[0];
      if (activeMouseEvent) {
        targetCx = activeMouseEvent.x;
        targetCy = activeMouseEvent.y;
      } else {
        targetCx = 0.5;
        targetCy = 0.5;
      }
    }

    console.log('[EditorPage] Adding manual zoom intent:', { t: currentTimeMs, scale, cx: targetCx, cy: targetCy });
    
    const newIntent = {
      t: currentTimeMs,
      targetCx: targetCx!,
      targetCy: targetCy!,
      targetScale: scale
    };
    
    const existingIntents = graph.camera.intents || [];
    const newIntents = [...existingIntents, newIntent].sort((a, b) => a.t - b.t);
    
    setGraph({
      ...graph,
      camera: {
        ...graph.camera,
        intents: newIntents
      }
    });
    
    console.log('[EditorPage] New intents count:', newIntents.length);
  }, [graph]);

  // 更新 intents 的回调（用于时间轴拖拽编辑）
  const handleUpdateIntents = useCallback((newIntents: CameraIntent[]) => {
    if (!graph) return;
    console.log('[EditorPage] Updating intents:', newIntents.length);
    setGraph({
      ...graph,
      camera: {
        ...graph.camera,
        intents: newIntents
      }
    });
  }, [graph]);

  const {
    isExporting,
    exportProgress,
    handleExport: handleExportRaw
  } = useVideoExport({
    videoRef,
    canvasRef,
    maxDuration,
    exportDuration: graph?.duration ? graph.duration / 1000 : maxDuration,
    onSeek: handleSeek,
    setIsPlaying,
    renderFrame
  });

  const handleExport = useCallback((quality?: QualityConfig) => {
    handleExportRaw(quality, exportPath);
  }, [handleExportRaw, exportPath]);

  const handleSetBgFile = useCallback((file: string) => {
    setActiveWallpaper({ category: browsingCategory, file });
  }, [browsingCategory]);

  // 点击画布手动定焦
  const handleFocusSpot = useCallback((cx: number, cy: number) => {
    if (!graph) return;
    const currentTimeMs = (videoRef.current?.currentTime || 0) * 1000;
    const currentIntents = graph.camera.intents || [];
    
    // 查找当前时间点附近的关键帧
    const existingIndex = currentIntents.findIndex(i => Math.abs(i.t - currentTimeMs) < 200);
    
    let newIntents = [...currentIntents];
    if (existingIndex > -1) {
      // 这里的力度加大：如果原本是 1.0x 的，点击后强制变成 2.5x 缩放
      const targetScale = Math.max(2.5, newIntents[existingIndex].targetScale);
      newIntents[existingIndex] = { ...newIntents[existingIndex], targetCx: cx, targetCy: cy, targetScale };
    } else {
      newIntents.push({
        t: currentTimeMs,
        targetCx: cx,
        targetCy: cy,
        targetScale: 2.5 
      });
    }

    console.log(`[Editor] Focus moved to: (${cx.toFixed(3)}, ${cy.toFixed(3)})`);

    setGraph({
      ...graph,
      camera: {
        ...graph.camera,
        intents: newIntents.sort((a,b) => a.t - b.t)
      }
    });
  }, [graph]);

  // 更新鼠标主题配置
  const handleUpdateMouseTheme = useCallback((updates: Partial<RenderGraph['mouseTheme']>) => {
    if (!graph) return;
    setGraph({
      ...graph,
      mouseTheme: { ...graph.mouseTheme, ...updates }
    });
  }, [graph]);

  // 更新鼠标物理配置
  const handleUpdateMousePhysics = useCallback((updates: Partial<RenderGraph['mousePhysics']>) => {
    if (!graph) return;
    setGraph({
      ...graph,
      mousePhysics: { ...graph.mousePhysics, ...updates }
    });
  }, [graph]);

  if (!graph) return null;

  return (
    <div className={cn(
      "relative flex h-full min-h-0 flex-col bg-[#0e0e0e] text-neutral-200 overflow-hidden font-sans transition-opacity duration-300",
      isReady ? "opacity-100" : "opacity-0"
    )}>
      <ExportOverlay isExporting={isExporting} progress={exportProgress} />

      {!isFullscreenPreview && (
        <div className="relative z-50">
          <EditorHeader 
            onBack={onBack} 
            onDelete={handleDelete}
            onExport={handleExport} 
            isExporting={isExporting} 
            filename={filename}
            onPickAddress={handlePickAddress}
          />
        </div>
      )}

      <div className={cn(
        "flex flex-1 min-h-0 overflow-hidden relative",
        isFullscreenPreview && "fixed inset-0 z-[100] bg-black"
      )}>
        <div className="flex flex-1 min-h-0 min-w-0 flex-col relative bg-[#101010] overflow-hidden">
          <CanvasPreview 
            videoRef={videoRef} 
            canvasRef={canvasRef} 
            onEnded={() => setIsPlaying(false)} 
            onFocusSpot={handleFocusSpot}
          />
          
          <div className={cn(
            "transition-all duration-300",
            isFullscreenPreview 
              ? "absolute bottom-10 left-1/2 -translate-x-1/2 z-[110] w-[600px] rounded-3xl border border-white/5 bg-[#0a0a0a] shadow-2xl overflow-hidden" 
              : "w-full"
          )}>
            <ControlBar 
              currentTime={currentTime}
              maxDuration={maxDuration}
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              isFullscreen={isFullscreenPreview}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>
        </div>

        {!isFullscreenPreview && (
          <DesignPanel 
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            bgCategory={browsingCategory}
            setBgCategory={setBrowsingCategory}
            bgFile={activeWallpaper.file}
            setBgFile={handleSetBgFile}
            hideIdle={hideIdle}
            setHideIdle={setHideIdle}
            onResetZoom={handleResetZoom}
            onAddManualZoom={handleAddManualZoom}
            mouseTheme={graph.mouseTheme}
            onUpdateMouseTheme={handleUpdateMouseTheme}
            mousePhysics={graph.mousePhysics}
            onUpdateMousePhysics={handleUpdateMousePhysics}
          />
        )}
      </div>

      {!isFullscreenPreview && (
        <TimelineSectionMemo 
          duration={maxDuration}
          currentTime={currentTime}
          videoRef={videoRef}
          onSeek={handleSeek}
          renderGraph={graph}
          onUpdateIntents={handleUpdateIntents}
        />
      )}
    </div>
  );
}
