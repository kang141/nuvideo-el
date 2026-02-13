import { create } from 'zustand';
import { AppState } from '@/types';

interface AppStore {
  appState: AppState;
  setAppState: (state: AppState) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  appState: 'home',
  setAppState: (state) => set({ appState: state }),
}));
