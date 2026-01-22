import { RefObject } from 'react';

interface CanvasPreviewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  onEnded: () => void;
  onFocusSpot?: (cx: number, cy: number) => void;
}

export function CanvasPreview({
  videoRef,
  canvasRef,
  onEnded,
  onFocusSpot
}: CanvasPreviewProps) {
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!canvasRef.current || !onFocusSpot) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    
    const cx = (px - 0.075) / 0.85;
    const cy = (py - 0.075) / 0.85;
    
    onFocusSpot(
      Math.max(0, Math.min(1, cx)), 
      Math.max(0, Math.min(1, cy))
    );
  };

  return (
    <main className="flex flex-1 min-h-0 flex-col relative bg-[#101010] overflow-hidden">
      {/* 中央画布区域 */}
      <div className="flex-1 relative flex items-center justify-center p-8 lg:p-12 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02)_0%,transparent_100%)]">
        <div className="relative aspect-video w-full max-w-[1024px] overflow-hidden rounded-[2.5rem] shadow-[0_100px_200px_-40px_rgba(0,0,0,1)] ring-1 ring-white/10 transition-transform duration-700 ease-out">
          <video 
            ref={videoRef} 
            className="hidden" 
            muted 
            playsInline 
            onEnded={onEnded} 
          />
          <canvas 
            ref={canvasRef} 
            className="h-full w-full cursor-none" 
            onClick={handleCanvasClick}
          />
        </div>
      </div>
    </main>
  );
}
