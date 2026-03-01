import { create } from 'zustand';
import { AppState, RecordingState, RenderGraph } from '@/types';

interface AppStore {
  // 应用状态
  appState: AppState;
  setAppState: (state: AppState) => void;

  // 录制状态
  recordingState: RecordingState;
  setRecordingState: (state: RecordingState | ((prev: RecordingState) => RecordingState)) => void;

  // 渲染图
  renderGraph: RenderGraph | null;
  setRenderGraph: (graph: RenderGraph | null) => void;

  // 导出状态
  isExporting: boolean;
  setIsExporting: (exporting: boolean) => void;

  // 窗口最大化状态
  isMaximized: boolean;
  setIsMaximized: (maximized: boolean) => void;

  // 自动缩放配置
  autoZoomEnabled: boolean;
  setAutoZoomEnabled: (enabled: boolean) => void;

  // 录制相关的临时数据（原本在 ref 中）
  recordingMetadata: {
    audioDelay: number;
    webcamDelay: number;
    readyOffset: number;
    bounds: { width: number; height: number } | null;
    scaleFactor: number;
  };
  setRecordingMetadata: (metadata: Partial<AppStore['recordingMetadata']>) => void;

  // 重置录制元数据
  resetRecordingMetadata: () => void;
}

const initialRecordingState: RecordingState = {
  isRecording: false,
  duration: 0,
  isPaused: false,
  format: 'video',
  autoZoom: localStorage.getItem('nuvideo_auto_zoom_enabled') !== 'false',
  webcamDeviceId: null,
};

const initialRecordingMetadata = {
  audioDelay: 0,
  webcamDelay: 0,
  readyOffset: 0,
  bounds: null,
  scaleFactor: 1,
};

export const useAppStore = create<AppStore>((set, get) => ({
  // 应用状态
  appState: 'home',
  setAppState: (state) => set({ appState: state }),

  // 录制状态
  recordingState: initialRecordingState,
  setRecordingState: (state) =>
    set({
      recordingState: typeof state === 'function' ? state(get().recordingState) : state,
    }),

  // 渲染图
  renderGraph: null,
  setRenderGraph: (graph) => set({ renderGraph: graph }),

  // 导出状态
  isExporting: false,
  setIsExporting: (exporting) => set({ isExporting: exporting }),

  // 窗口最大化状态
  isMaximized: false,
  setIsMaximized: (maximized) => set({ isMaximized: maximized }),

  // 自动缩放配置
  autoZoomEnabled: localStorage.getItem('nuvideo_auto_zoom_enabled') !== 'false',
  setAutoZoomEnabled: (enabled) => {
    localStorage.setItem('nuvideo_auto_zoom_enabled', enabled.toString());
    set({ autoZoomEnabled: enabled });
  },

  // 录制元数据
  recordingMetadata: initialRecordingMetadata,
  setRecordingMetadata: (metadata) =>
    set((state) => ({
      recordingMetadata: { ...state.recordingMetadata, ...metadata },
    })),

  resetRecordingMetadata: () =>
    set({ recordingMetadata: initialRecordingMetadata }),
}));
