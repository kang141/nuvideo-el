import { WebDemuxer } from 'web-demuxer';

export class OfflineVideoDecoder {
    private demuxer: WebDemuxer;
    private decoder: VideoDecoder;
    private decodedFrames: VideoFrame[] = [];
    private isInitialized = false;
    private currentTimestampMs = -1;
    private reader: ReadableStreamDefaultReader<any> | null = null;
    private isReading = false;
    private targetBufferCount = 20; // 🎯 预先缓冲 20 帧，确保渲染不卡顿

    constructor() {
        this.demuxer = new WebDemuxer({
            wasmFilePath: '/web-demuxer.wasm'
        });
        this.decoder = new VideoDecoder({
            output: (frame) => {
                this.decodedFrames.push(frame);
            },
            error: (e) => {
                console.error('[OfflineVideoDecoder] Decoder error:', e);
            }
        });
    }

    async initialize(source: string | File): Promise<void> {
        if (this.isInitialized) return;

        try {
            let finalSource = source;
            if (typeof source === 'string' && source.startsWith('C:')) {
                const response = await fetch(`file:///${source.replace(/\\/g, '/')}`);
                const blob = await response.blob();
                finalSource = URL.createObjectURL(blob);
            }

            await this.demuxer.load(finalSource);
            const config = await this.demuxer.getDecoderConfig('video');
            this.decoder.configure(config);
            this.isInitialized = true;

            // 🎯 初始化流式读取器
            const stream = this.demuxer.readMediaPacket('video');
            this.reader = stream.getReader();
            this.startReadingLoop();
        } catch (e) {
            console.error('[OfflineVideoDecoder] Initialization failed:', e);
            throw e;
        }
    }

    private async startReadingLoop() {
        if (this.isReading || !this.reader) return;
        this.isReading = true;

        try {
            while (this.isReading) {
                if (this.decodedFrames.length >= this.targetBufferCount) {
                    await new Promise(r => setTimeout(r, 10));
                    continue;
                }

                const { done, value: packet } = await this.reader.read();
                if (done) break;

                const chunk = this.demuxer.genEncodedChunk('video', packet);
                this.decoder.decode(chunk);
            }
        } catch (e) {
            console.error('[OfflineVideoDecoder] Reading loop error:', e);
        } finally {
            this.isReading = false;
        }
    }

    async getFrame(timestampMs: number): Promise<VideoFrame | null> {
        if (!this.isInitialized) return null;

        if (timestampMs < this.currentTimestampMs - 500 || timestampMs > this.currentTimestampMs + 3000) {
            await this.seekTo(timestampMs);
        }

        const timeout = Date.now() + 2000;
        while (Date.now() < timeout) {
            if (this.decodedFrames.length > 0) {
                const hasMatch = this.decodedFrames.some(f => f.timestamp / 1000 >= timestampMs - 16);
                if (hasMatch) break;
            }
            await new Promise(r => setTimeout(r, 5));
        }

        this.currentTimestampMs = timestampMs;
        const frame = this.pickBestFrame(timestampMs);
        this.cleanupOldFrames(timestampMs);
        return frame;
    }

    private async seekTo(timestampMs: number) {
        this.isReading = false;
        if (this.reader) {
            try { await this.reader.cancel(); } catch (e) { }
        }

        this.decoder.reset();
        const config = await this.demuxer.getDecoderConfig('video');
        this.decoder.configure(config);
        this.clearFrames();

        const stream = this.demuxer.readMediaPacket('video', timestampMs / 1000);
        this.reader = stream.getReader();
        this.startReadingLoop();
    }

    private pickBestFrame(targetMs: number): VideoFrame | null {
        if (this.decodedFrames.length === 0) return null;
        let best = this.decodedFrames[0];
        let minDiff = Math.abs(best.timestamp / 1000 - targetMs);

        for (const frame of this.decodedFrames) {
            const diff = Math.abs(frame.timestamp / 1000 - targetMs);
            if (diff < minDiff) {
                minDiff = diff;
                best = frame;
            }
        }
        return best;
    }

    private cleanupOldFrames(targetMs: number): void {
        const threshold = targetMs * 1000 - 100000;
        while (this.decodedFrames.length > 2 && this.decodedFrames[0].timestamp < threshold) {
            const f = this.decodedFrames.shift();
            f?.close();
        }
    }

    private clearFrames(): void {
        this.decodedFrames.forEach(f => f.close());
        this.decodedFrames = [];
    }

    destroy(): void {
        this.isReading = false;
        this.clearFrames();
        this.decoder.close();
        this.demuxer.destroy();
    }
}
