import { useState, useEffect, useCallback } from 'react';

export function useWebcam() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedWebcam, setSelectedWebcam] = useState<string | null>(() => {
    return localStorage.getItem('nuvideo_last_webcam') || null;
  });
  const [isEnabled, setIsEnabled] = useState(false);

  const fetchDevices = useCallback(async () => {
    try {
      // 1. 尝试触发权限请求 (如果尚未获得)
      // 这里的策略是：即便失败也继续执行枚举，以防权限受限导致列表完全为空
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn('[useWebcam] Permission request ignored or failed', e);
      }

      // 2. 枚举所有设备
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
      
      setDevices(videoDevices);

      // 3. 智能选择默认设备
      if (videoDevices.length > 0) {
        // 如果当前没有选择，或者当前选择的设备已不存在，则重置为第一个
        const exists = videoDevices.some(d => d.deviceId === selectedWebcam);
        if (!selectedWebcam || !exists) {
          const first = videoDevices[0].deviceId;
          setSelectedWebcam(first);
          localStorage.setItem('nuvideo_last_webcam', first);
        }
      }
    } catch (err) {
      console.error('[useWebcam] Failed to fetch webcam devices:', err);
    }
  }, [selectedWebcam]);

  useEffect(() => {
    fetchDevices();

    // 监听硬件插拔事件
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
    };
  }, [fetchDevices]);

  const toggleWebcam = useCallback(() => {
    setIsEnabled(prev => !prev);
  }, []);

  const selectWebcam = useCallback((deviceId: string) => {
    setSelectedWebcam(deviceId);
    localStorage.setItem('nuvideo_last_webcam', deviceId);
  }, []);

  return {
    devices,
    selectedWebcam,
    isEnabled,
    toggleWebcam,
    selectWebcam,
    setIsEnabled
  };
}
