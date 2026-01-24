import { motion, AnimatePresence } from 'framer-motion';

import { Language, translations } from '@/i18n/translations';

interface ExportOverlayProps {
  isExporting: boolean;
  progress: number;
  language: Language;
  onCancel: () => void;
  success?: boolean;
  onOpenFile?: () => void;
  onClose?: () => void;
}

export function ExportOverlay({ 
  isExporting, 
  progress, 
  language,
  onCancel,
  success,
  onOpenFile,
  onClose
}: ExportOverlayProps) {
  const t = translations[language];
  return (
    <AnimatePresence>
      {(isExporting || success) && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
        >
          {isExporting ? (
            <>
              <div className="relative h-24 w-24">
                <svg className="h-full w-full" viewBox="0 0 100 100">
                  <circle className="stroke-white/10 fill-none" cx="50" cy="50" r="45" strokeWidth="2" />
                  <motion.circle 
                    className="stroke-emerald-500 fill-none" 
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
              <h2 className="mt-8 text-2xl font-black text-white uppercase tracking-widest">{t.common.exporting}</h2>
              <p className="mt-2 text-white/40 text-sm font-medium">Please do not close the window...</p>
              
              <button 
                onClick={onCancel}
                className="mt-8 px-6 py-2 rounded-full border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-medium"
              >
                {t.editor.cancel}
              </button>
            </>
          ) : (
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6">
                <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">{t.editor.exportSuccess}</h2>
              <div className="flex gap-4 mt-8">
                <button 
                  onClick={onOpenFile}
                  className="px-8 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/20"
                >
                  {t.editor.openFile}
                </button>
                <button 
                  onClick={onClose}
                  className="px-8 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-all"
                >
                  {t.editor.close}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
