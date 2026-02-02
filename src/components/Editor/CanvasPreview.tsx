import { RefObject } from 'react';



interface CanvasPreviewProps {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  onEnded: () => void;
  onFocusSpot?: (cx: number, cy: number) => void;
  bgCategory: string;
  bgFile: string;
}

export function CanvasPreview({
  videoRef,
  audioRef,
  canvasRef,
  onEnded,
  onFocusSpot,
  bgCategory,
  bgFile
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
    <div className="flex-1 relative flex items-center justify-center p-8 lg:p-12 overflow-hidden bg-[#0a0a0a]">
      {/* 背景衬底 - 硬件加速的多层视差组合 */}
      <div className="absolute inset-0 z-0">
         <img 
           src={`asset://backgrounds/${bgCategory}/${bgFile}`}
           className="w-full h-full object-cover blur-[20px] scale-110 opacity-40 select-none pointer-events-none"
           alt=""
         />
         <div className="absolute inset-0 bg-black/40" />
         <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/60" />
      </div>

      <div className="relative aspect-video w-full max-w-[1024px] overflow-hidden rounded-[2.5rem] shadow-[0_80px_160px_-40px_rgba(0,0,0,0.9)] ring-1 ring-white/10 z-10">
        {/* 这里是窗口内部的背景 */}
        <div className="absolute inset-0 z-[-1]">
           <img 
             src={`asset://backgrounds/${bgCategory}/${bgFile}`}
             className="w-full h-full object-cover select-none pointer-events-none"
             alt="Window Background"
           />
        </div>
        
        <video 
          ref={videoRef} 
          className="hidden" 
          muted 
          playsInline 
          onEnded={onEnded} 
        />
        <audio 
          ref={audioRef}
          className="hidden"
        />
        <canvas 
          ref={canvasRef} 
          className="h-full w-full cursor-none relative z-20" 
          onClick={handleCanvasClick}
        />
      </div>
    </div>
  );
}
