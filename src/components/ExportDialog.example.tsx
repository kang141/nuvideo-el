/**
 * FFmpeg 导出对话框示例
 * 展示如何使用新的 useFFmpegExport Hook
 */

import { useState } from 'react';
import { useFFmpegExport } from '../hooks/editor/useFFmpegExport';
import { QUALITY_OPTIONS, type QualityConfig } from '../constants/quality';

interface ExportDialogProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  maxDuration: number;
  renderGraph: any;
  bgCategory: string;
  bgFile: string;
  renderFrame: (t: number) => Promise<void>;
  setIsPlaying: (playing: boolean) => void;
  setIsExporting: (exporting: boolean) => void;
  onClose: () => void;
}

export function ExportDialog({
  videoRef,
  canvasRef,
  maxDuration,
  renderGraph,
  bgCategory,
  bgFile,
  renderFrame,
  setIsPlaying,
  setIsExporting,
  onClose,
}: ExportDialogProps) {
  const [selectedQuality, setSelectedQuality] = useState<QualityConfig>(QUALITY_OPTIONS[0]);
  const [isExporting, setLocalExporting] = useState(false);

  const { handleExport, exportProgress, cancelExport } = useFFmpegExport({
    videoRef,
    canvasRef,
    maxDuration,
    setIsPlaying,
    setIsExporting,
    renderGraph,
    bgCategory,
    bgFile,
    renderFrame,
  });

  const handleStartExport = async () => {
    setLocalExporting(true);
    const result = await handleExport(selectedQuality);
    setLocalExporting(false);
    
    if (result.success) {
      console.log('导出成功:', result.filePath);
      onClose();
    } else {
      console.error('导出失败');
    }
  };

  const handleCancel = () => {
    if (isExporting) {
      cancelExport();
    }
    onClose();
  };

  return (
    <div className="export-dialog">
      <h2>导出视频</h2>
      
      {/* 质量选择 */}
      <div className="quality-selector">
        <label>画质预设：</label>
        <select 
          value={selectedQuality.id} 
          onChange={(e) => {
            const quality = QUALITY_OPTIONS.find(q => q.id === e.target.value);
            if (quality) setSelectedQuality(quality);
          }}
          disabled={isExporting}
        >
          {QUALITY_OPTIONS.map(quality => (
            <option key={quality.id} value={quality.id}>
              {quality.label} ({quality.maxWidth}x{quality.maxHeight})
            </option>
          ))}
        </select>
      </div>

      {/* 质量说明 */}
      <div className="quality-info">
        <p>
          <strong>质量说明：</strong>
        </p>
        <ul>
          <li>最高：接近无损质量，适合专业用途</li>
          <li>清晰：高质量，适合日常使用（推荐）</li>
          <li>流畅：较小文件，适合网络分享</li>
        </ul>
        <p>
          <strong>编码器：</strong>自动检测 NVENC 硬件加速，如不支持则使用 libx264 软件编码
        </p>
      </div>

      {/* 进度条 */}
      {isExporting && (
        <div className="export-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${exportProgress * 100}%` }}
            />
          </div>
          <p>{Math.round(exportProgress * 100)}% 完成</p>
        </div>
      )}

      {/* 按钮 */}
      <div className="dialog-actions">
        <button onClick={handleCancel} disabled={isExporting}>
          取消
        </button>
        <button 
          onClick={handleStartExport} 
          disabled={isExporting}
          className="primary"
        >
          {isExporting ? '导出中...' : '开始导出'}
        </button>
      </div>
    </div>
  );
}

/**
 * 使用示例：
 * 
 * // 在编辑器组件中
 * const [showExportDialog, setShowExportDialog] = useState(false);
 * 
 * // 打开导出对话框
 * <button onClick={() => setShowExportDialog(true)}>
 *   导出视频
 * </button>
 * 
 * // 渲染对话框
 * {showExportDialog && (
 *   <ExportDialog
 *     videoRef={videoRef}
 *     canvasRef={canvasRef}
 *     maxDuration={maxDuration}
 *     renderGraph={renderGraph}
 *     bgCategory={bgCategory}
 *     bgFile={bgFile}
 *     renderFrame={renderFrame}
 *     setIsPlaying={setIsPlaying}
 *     setIsExporting={setIsExporting}
 *     onClose={() => setShowExportDialog(false)}
 *   />
 * )}
 */
