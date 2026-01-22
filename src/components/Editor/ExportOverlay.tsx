import { motion, AnimatePresence } from 'framer-motion';

interface ExportOverlayProps {
  isExporting: boolean;
  progress: number;
}

export function ExportOverlay({ isExporting, progress }: ExportOverlayProps) {
  return (
    <AnimatePresence>
      {isExporting && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
        >
          <div className="relative h-24 w-24">
            <svg className="h-full w-full" viewBox="0 0 100 100">
              <circle className="stroke-white/10 fill-none" cx="50" cy="50" r="45" strokeWidth="2" />
              <motion.circle 
                className="stroke-blue-500 fill-none" 
                cx="50" cy="50" r="45" 
                strokeWidth="2"
                strokeDasharray="283"
                animate={{ strokeDashoffset: 283 - (283 * progress) }}
                transition={{ type: "tween", ease: "linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xl font-bold text-white">
              {Math.round(progress * 100)}%
            </div>
          </div>
          <h2 className="mt-8 text-2xl font-black text-white uppercase tracking-widest">Rendering Video</h2>
          <p className="mt-2 text-white/40 text-sm font-medium">Please do not close the window...</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
