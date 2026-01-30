/**
 * WebcamRecorder - 捕获并录制摄像头画面
 */
export class WebcamRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private videoChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(deviceId: string) {
    this.videoChunks = [];
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'video/webm', // 让浏览器选择最合适的编码 (通常是 vp8/vp9)
        videoBitsPerSecond: 1500000 // 1.5 Mbps
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.videoChunks.push(e.data);
      };

      this.mediaRecorder.start(1000);
      return performance.now();
    } catch (err) {
      console.error('[WebcamRecorder] Failed to start:', err);
      throw err;
    }
  }

  async stop(): Promise<ArrayBuffer | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = async () => {
        const videoBlob = new Blob(this.videoChunks, { type: 'video/webm' });
        const arrayBuffer = await videoBlob.arrayBuffer();

        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }

        this.videoChunks = [];
        resolve(arrayBuffer);
      };

      this.mediaRecorder.stop();
    });
  }
}

export const webcamRecorder = new WebcamRecorder();
