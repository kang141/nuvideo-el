import { useEffect, useRef, RefObject, useState } from 'react';
import { EDITOR_CANVAS_SIZE } from '../../constants/editor';
import { RenderGraph } from '../../types';
import { drawFrame } from '../../core/render-frame';

interface UseVideoRendererOptions {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  renderGraph: RenderGraph;
  bgCategory: string;
  bgFile: string;
}

export function useVideoRenderer({
  videoRef,
  canvasRef,
  renderGraph,
  bgCategory,
  bgFile,
}: UseVideoRendererOptions) {
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isFirstLoadRef = useRef(true);
  const rafRef = useRef<number>();

  // 加载背景图
  useEffect(() => {
    const img = new Image();
    img.src = `/backgrounds/${bgCategory}/${bgFile}`;
    img.onload = () => {
      bgImageRef.current = img;
      if (isFirstLoadRef.current) {
        setIsReady(true);
        isFirstLoadRef.current = false;
      }
    };
  }, [bgCategory, bgFile]);

  // 渲染循环
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isReady) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width: W, height: H } = EDITOR_CANVAS_SIZE;
    canvas.width = W;
    canvas.height = H;

    const render = () => {
      drawFrame({
        ctx,
        video,
        renderGraph,
        bgImage: bgImageRef.current,
        width: W,
        height: H,
        currentTimeMs: video.currentTime * 1000
      });

      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isReady, videoRef, canvasRef, renderGraph]);

  return { isReady };
}
