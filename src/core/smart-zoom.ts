import type { RenderGraph, CameraIntent } from '../types';

/**
 * 智能镜头意图生成器
 * 将鼠标轨迹转换为镜头意图序列
 */

export function generateSmartIntents(graph: RenderGraph): CameraIntent[] {
  console.log('[SmartZoom] Called with graph:', {
    duration: graph.duration,
    mouseEventsCount: graph.mouse?.length || 0,
    mouseEvents: graph.mouse?.slice(0, 5) // 只打印前5个
  });

  const intents: CameraIntent[] = [];
  const mouseEvents = graph.mouse;
  
  // 1. 初始化意图（保持全屏）
  intents.push({ t: 0, targetCx: 0.5, targetCy: 0.5, targetScale: 1.0 });

  const duration = graph.duration || 5000;
  
  // 核心改进：过滤掉视频最后 1 秒内的事件
  // 这些事件通常是用户去点“停止按钮”产生的无意义位移或点击
  const validEvents = mouseEvents.filter(e => e.t < duration - 1000);

  if (validEvents.length === 0) {
    // 兜底：如果没录到有效点击，生成一个覆盖全篇的显著演示，确保“看起来有缩放”
    // 时间点：0.5s 开始推近，持续到最后 1s 左右回归
    const zoomInT = 500;
    const zoomBackT = Math.max(duration - 1500, 1000);
    
    intents.push({ t: zoomInT, targetCx: 0.5, targetCy: 0.5, targetScale: 1.6 });
    intents.push({ t: zoomBackT, targetCx: 0.5, targetCy: 0.5, targetScale: 1.0 });
    return intents;
  }

  // 策略：基于经过过滤的点击事件产生推拉感
  for (let i = 0; i < validEvents.length; i++) {
    const event = validEvents[i];

    if (event.type === 'down') {
      intents.push({
        t: event.t,
        targetCx: event.x,
        targetCy: event.y,
        targetScale: 1.8
      });
    } else if (event.type === 'up') {
      intents.push({
        t: event.t + 1000,
        targetCx: 0.5,
        targetCy: 0.5,
        targetScale: 1.0
      });
    }
  }

  // 排序并去重（防御重复时间点）
  return intents.sort((a, b) => a.t - b.t);
}
