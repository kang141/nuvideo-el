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
  lastExportPath?: string | null;
}

export function ExportOverlay({
  isExporting,
  progress,
  language,
  onCancel,
  success,
  onOpenFile,
  onClose,
  lastExportPath
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
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="flex flex-col items-center max-w-lg text-center px-6"
            >
              <div className="h-24 w-24 rounded-full bg-emerald-500/10 flex items-center justify-center mb-8 relative">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1.2 }}
                  className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl"
                />
                <svg className="w-12 h-12 text-emerald-500 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-4xl font-black text-white mb-4 tracking-tight">{t.editor.exportSuccess}</h2>
              <p className="text-white/40 text-sm mb-8 font-medium line-clamp-2 px-4 italic">
                {t.common.savedTo || 'Saved to'}: {lastExportPath || '...'}
              </p>
              <div className="flex gap-4">
                <button
                  onClick={onOpenFile}
                  className="px-8 py-4 rounded-2xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-600/20 active:scale-95"
                >
                  {t.editor.openFile}
                </button>
                <button
                  onClick={onClose}
                  className="px-8 py-4 rounded-2xl bg-white/5 text-white/80 font-bold hover:bg-white/10 transition-all border border-white/5 active:scale-95"
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
