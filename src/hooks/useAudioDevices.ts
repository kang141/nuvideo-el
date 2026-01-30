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
  const [state, setState] = useState<AudioDeviceState>({
    microphones: [],
    selectedMicrophone: null,
    systemAudioEnabled: true,
    isLoading: false,
    error: null,
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
  }, []);

  const toggleSystemAudio = useCallback(() => {
    setState(prev => ({ ...prev, systemAudioEnabled: !prev.systemAudioEnabled }));
  }, []);

  const toggleMicrophone = useCallback((enabled: boolean) => {
    setState(prev => ({
      ...prev,
      selectedMicrophone: enabled ? (prev.microphones[0]?.deviceId ?? null) : null,
    }));
  }, []);

  return {
    ...state,
    refreshDevices,
    selectMicrophone,
    toggleSystemAudio,
    toggleMicrophone,
  };
}
