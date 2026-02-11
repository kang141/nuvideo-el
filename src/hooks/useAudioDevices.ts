import { useState, useEffect, useCallback } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface AudioDeviceState {
  microphones: AudioDevice[];
  selectedMicrophone: string | null;
  systemAudioEnabled: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAudioDevices() {
  const [state, setState] = useState<AudioDeviceState>(() => {
    const savedMic = localStorage.getItem('nuvideo_last_mic');
    const savedSysAudio = localStorage.getItem('nuvideo_system_audio');
    return {
      microphones: [],
      selectedMicrophone: savedMic || null,
      systemAudioEnabled: savedSysAudio === null ? true : savedSysAudio === 'true',
      isLoading: false,
      error: null,
    };
  });

  const refreshDevices = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}...`,
          kind: d.kind as 'audioinput',
        }));

      setState(prev => ({
        ...prev,
        microphones,
        selectedMicrophone: prev.selectedMicrophone || (microphones[0]?.deviceId ?? null),
        isLoading: false,
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : '无法访问音频设备',
      }));
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  const selectMicrophone = useCallback((deviceId: string | null) => {
    setState(prev => ({ ...prev, selectedMicrophone: deviceId }));
    if (deviceId) {
      localStorage.setItem('nuvideo_last_mic', deviceId);
    } else {
      localStorage.removeItem('nuvideo_last_mic');
    }
  }, []);

  const toggleSystemAudio = useCallback(() => {
    setState(prev => {
      const next = !prev.systemAudioEnabled;
      localStorage.setItem('nuvideo_system_audio', String(next));
      return { ...prev, systemAudioEnabled: next };
    });
  }, []);

  const toggleMicrophone = useCallback((enabled: boolean) => {
    setState(prev => {
      const defaultMic = prev.microphones[0]?.deviceId ?? null;
      const lastMic = localStorage.getItem('nuvideo_last_mic');
      const nextMic = enabled ? (lastMic || defaultMic) : null;
      
      if (enabled && nextMic) {
        localStorage.setItem('nuvideo_last_mic', nextMic);
      } else if (!enabled) {
        // 我们不移除 last_mic，这样下次开启能恢复
      }
      
      return { ...prev, selectedMicrophone: nextMic };
    });
  }, []);

  return {
    ...state,
    refreshDevices,
    selectMicrophone,
    toggleSystemAudio,
    toggleMicrophone,
  };
}
