import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Settings, 
  Image as ImageIcon, 
  Monitor, 
  AppWindow as WindowIcon, 
  Square, 
  Camera, 
  Mic, 
  Volume2,
  Bell,
  ChevronDown,
  MonitorPlay,
  Minus,
  X
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface HomePageProps {
  onStartRecording: () => void;
}

export function HomePage({ onStartRecording }: HomePageProps) {
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [audioOn, setAudioOn] = useState(false);

  const handleWindowControl = (action: 'minimize' | 'close') => {
    (window as any).ipcRenderer.send('window-control', action);
  };

  return (
    <div className="flex h-screen flex-col bg-[#070707] text-white">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-4 py-3" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-4">
          <Settings size={18} className="text-neutral-400 hover:text-white transition-colors cursor-pointer" style={{ WebkitAppRegion: 'no-drag' } as any} />
          <ImageIcon size={18} className="text-neutral-400 hover:text-white transition-colors cursor-pointer" style={{ WebkitAppRegion: 'no-drag' } as any} />
          <MonitorPlay size={18} className="text-neutral-400 hover:text-white transition-colors cursor-pointer" style={{ WebkitAppRegion: 'no-drag' } as any} />
          <div className="relative" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <Bell size={18} className="text-neutral-400 hover:text-white transition-colors cursor-pointer" />
            <div className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-500 border border-[#070707]" />
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Minus 
            size={18} 
            className="text-neutral-400 hover:text-white transition-colors cursor-pointer p-0.5" 
            onClick={() => handleWindowControl('minimize')}
          />
          <X 
            size={18} 
            className="text-neutral-400 hover:text-white transition-colors cursor-pointer p-0.5 hover:bg-red-500 rounded" 
            onClick={() => handleWindowControl('close')}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-2 pb-6 gap-6">
        {/* Logo 与 身份卡片 */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black">
             <div className="h-6 w-6 rounded-full border-2 border-black" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Cap</h1>
              <Badge variant="secondary" className="bg-neutral-800 text-neutral-400 border-none px-2 py-0 h-5 text-[10px] font-bold uppercase tracking-wider">
                Personal
              </Badge>
            </div>
          </div>
          <div className="ml-auto">
             <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
               <span className="text-[10px] font-bold">i</span>
             </div>
          </div>
        </div>

        {/* 录制模式选择 */}
        <div className="grid grid-cols-3 gap-3">
          <motion.div 
            whileTap={{ scale: 0.95 }}
            onClick={onStartRecording}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-800/50 border border-white/5 p-4 hover:bg-neutral-800 transition-colors cursor-pointer group"
          >
            <div className="relative flex items-center gap-1">
              <Monitor size={24} className="text-neutral-300 group-hover:text-white transition-colors" />
              <ChevronDown size={12} className="text-neutral-500" />
            </div>
            <span className="text-xs font-medium text-neutral-400 group-hover:text-white transition-colors">Display</span>
          </motion.div>

          <motion.div 
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-800/50 border border-white/5 p-4 hover:bg-neutral-800 transition-colors cursor-pointer group"
          >
            <div className="relative flex items-center gap-1">
              <WindowIcon size={24} className="text-neutral-300 group-hover:text-white transition-colors" />
              <ChevronDown size={12} className="text-neutral-500" />
            </div>
            <span className="text-xs font-medium text-neutral-400 group-hover:text-white transition-colors">Window</span>
          </motion.div>

          <motion.div 
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-800/50 border border-white/5 p-4 hover:bg-neutral-800 transition-colors cursor-pointer group"
          >
            <Square size={24} className="text-neutral-300 group-hover:text-white transition-colors" />
            <span className="text-xs font-medium text-neutral-400 group-hover:text-white transition-colors">Area</span>
          </motion.div>
        </div>

        {/* 外设设置列表 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-2xl bg-neutral-800/40 px-4 py-3 border border-white/5">
            <div className="flex items-center gap-3">
              <Camera size={18} className="text-neutral-500" />
              <span className="text-sm font-medium text-neutral-200">No Camera</span>
            </div>
            <button 
              onClick={() => setCameraOn(!cameraOn)}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${cameraOn ? 'bg-green-500 text-white' : 'bg-red-500/80 text-white'}`}
            >
              {cameraOn ? 'On' : 'Off'}
            </button>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-neutral-800/40 px-4 py-3 border border-white/5">
            <div className="flex items-center gap-3">
              <Mic size={18} className="text-neutral-500" />
              <span className="text-sm font-medium text-neutral-200">No Microphone</span>
            </div>
            <button 
              onClick={() => setMicOn(!micOn)}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${micOn ? 'bg-green-500 text-white' : 'bg-red-500/80 text-white'}`}
            >
              {micOn ? 'On' : 'Off'}
            </button>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-neutral-800/40 px-4 py-3 border border-white/5">
            <div className="flex items-center gap-3">
              <Volume2 size={18} className="text-neutral-500" />
              <span className="text-sm font-medium text-neutral-200">No System Audio</span>
            </div>
            <button 
              onClick={() => setAudioOn(!audioOn)}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${audioOn ? 'bg-green-500 text-white' : 'bg-red-500/80 text-white'}`}
            >
              {audioOn ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
