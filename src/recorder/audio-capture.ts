/**
 * NativeAudioRecorder - 使用浏览器原生的 MediaRecorder 录制音频
 * 解决 FFmpeg 驱动兼容性问题，提供 100% 稳定的音频录制。
 */
export class NativeAudioRecorder {
  private micRecorder: MediaRecorder | null = null;
  private sysRecorder: MediaRecorder | null = null;
  
  private micChunks: Blob[] = [];
  private sysChunks: Blob[] = [];

  // 音频上下文仅用于简单的流维护（如果需要）
  // 实际上两个独立的 Stream 可以直接录制，不需要复杂的 WebAudio 混合
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;

  async start(sourceId: string, config: { microphoneId: string | null; systemAudio: boolean }) {
    this.micChunks = [];
    this.sysChunks = [];
    
    // 1. 麦克风录制
    if (config.microphoneId) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { 
            deviceId: { exact: config.microphoneId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        this.micRecorder = new MediaRecorder(this.micStream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 128000
        });
        
        this.micRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.micChunks.push(e.data);
        };
        this.micRecorder.start();
      } catch (err) {
        console.warn('[AudioRecorder] Mic capture failed:', err);
      }
    }

    // 2. 系统音频录制
    if (config.systemAudio) {
      try {
        this.sysStream = await (navigator.mediaDevices as any).getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              echoCancellation: false,
              noiseSuppression: false,
              googAutoGainControl: false
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 16,
              maxHeight: 16,
              maxFrameRate: 1
            }
          }
        });
        
        // 只取音轨，忽略那个辅助用的视频轨
        const audioTracks = this.sysStream!.getAudioTracks();
        if (audioTracks.length > 0) {
          const pureAudioStream = new MediaStream(audioTracks);
          this.sysRecorder = new MediaRecorder(pureAudioStream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000
          });
          
          this.sysRecorder.ondataavailable = (e) => {
             if (e.data.size > 0) this.sysChunks.push(e.data);
          };
          this.sysRecorder.start();
        }
      } catch (e) {
        console.warn('[AudioRecorder] System audio capture failed:', e);
      }
    }
    return performance.now();
  }

  async stop(): Promise<{ micBuffer: ArrayBuffer | null, sysBuffer: ArrayBuffer | null }> {
    const stopRecorder = (recorder: MediaRecorder | null, chunks: Blob[], label: string): Promise<ArrayBuffer | null> => {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }

        recorder.onstop = async () => {
          console.log(`[AudioRecorder] ${label} recorder stopped. Chunk count: ${chunks.length}, Total Size: ${chunks.reduce((a, b) => a + b.size, 0)}`);
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: 'audio/webm' });
          resolve(await blob.arrayBuffer());
        };

        try {
          // 强制刷新当前缓冲区的数据
          recorder.requestData();
        } catch (e) {
          console.warn(`[AudioRecorder] ${label} requestData failed:`, e);
        }
        recorder.stop();
      });
    };

    // 并行停止
    const [micBuffer, sysBuffer] = await Promise.all([
      stopRecorder(this.micRecorder, this.micChunks, 'Mic'),
      stopRecorder(this.sysRecorder, this.sysChunks, 'Sys')
    ]);

    // 清理资源
    this.micStream?.getTracks().forEach(t => t.stop());
    this.sysStream?.getTracks().forEach(t => t.stop());
    this.micRecorder = null;
    this.sysRecorder = null;
    this.micChunks = [];
    this.sysChunks = [];

    console.log('[AudioRecorder] Stopped. Mic:', !!micBuffer, 'Sys:', !!sysBuffer);
    return { micBuffer, sysBuffer };
  }
}

export const nativeAudioRecorder = new NativeAudioRecorder();
