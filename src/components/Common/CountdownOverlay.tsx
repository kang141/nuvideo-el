import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CountdownOverlayProps {
  onComplete: () => void;
}

export function CountdownOverlay({ onComplete }: CountdownOverlayProps) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount(count - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(onComplete, 400); // 稍微停顿一下再开始
      return () => clearTimeout(timer);
    }
  }, [count, onComplete]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none">
      <AnimatePresence mode="wait">
        {count > 0 ? (
          <motion.div
            key={count}
            initial={{ scale: 2, opacity: 0, filter: 'blur(10px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            exit={{ scale: 0.5, opacity: 0, filter: 'blur(10px)' }}
            transition={{
              duration: 0.6,
              ease: [0.34, 1.56, 0.64, 1] // Springy feels more premium
            }}
            className="text-[160px] font-black text-white italic tracking-tighter drop-shadow-[0_0_50px_rgba(255,255,255,0.3)]"
          >
            {count}
          </motion.div>
        ) : (
          <motion.div
            key="go"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.2, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[120px] font-black text-white italic tracking-widest uppercase drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]"
          >
            GO!
          </motion.div>
        )}
      </AnimatePresence>

      {/* 扫光效果 */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-gradient-radial from-white/[0.05] to-transparent"
      />
    </div>
  );
}
