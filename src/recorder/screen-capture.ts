/**
 * ScreenRecorder - Sidecar (FFmpeg) 实现
 * 通过 IPC 调用主进程中的 FFmpeg 引擎，实现高质量、无原生鼠标的录制。
 */
export class ScreenRecorder {
  private _isRecording: boolean = false;
  private _isStopping: boolean = false;

  /**
   * 开始录制
   * @param sourceId 目标屏幕的 SourceID
   * @param _quality 视频质量配置
   * @param audioConfig 音频配置（可选）
   */
  async start(
    sourceId: string,
    _quality?: any,
    audioConfig?: { 
      microphoneId: string | null; 
      microphoneLabel: string | null;
      systemAudio: boolean 
    }
  ): Promise<{ bounds: any; t0: number; readyOffset: number; scaleFactor: number }> {
    if (this._isRecording || this._isStopping) return { bounds: null, t0: 0, readyOffset: 0, scaleFactor: 1 };

    try {
      // 1. 开启内容保护
      await (window as any).ipcRenderer.send('window-control', 'set-content-protection', true);

      // 2. 调用主进程启动 FFmpeg，获取所选屏幕的几何信息
      const result = await (window as any).ipcRenderer.invoke('start-sidecar-record', sourceId, audioConfig);

      if (!result.success) {
        throw new Error(result.error || 'Failed to start FFmpeg Sidecar');
      }

      this._isRecording = true;

      // 使用渲染进程的 performance.now() 作为统一的时间基准，避免跨进程时钟偏差
      return { 
        bounds: result.bounds, 
        t0: performance.now(), 
        readyOffset: result.readyOffset || 0,
        scaleFactor: result.scaleFactor || 1
      };
    } catch (err) {
      console.error('[ScreenRecorder] Start failed:', err);
      this._isRecording = false;
      throw err;
    }
  }

  /**
   * 停止录制并返回视频路径
   */
  async stop(): Promise<{ recordingPath: string, sessionId: string } | null> {
    if (!this._isRecording || this._isStopping) return null;
    this._isStopping = true;

    try {
      console.log('[ScreenRecorder] Requesting Sidecar stop...');
      
      // 1. 关闭内容保护
      await (window as any).ipcRenderer.send('window-control', 'set-content-protection', false);

      const result = await (window as any).ipcRenderer.invoke('stop-sidecar-record');
      
      this._isRecording = false;
      this._isStopping = false;
      
      return result || null;
    } catch (err) {
      console.error('[ScreenRecorder] Stop failed:', err);
      this._isRecording = false;
      this._isStopping = false;
      return null;
    }
  }

  get isRecording() {
    return this._isRecording;
  }
}

export const screenRecorder = new ScreenRecorder();
