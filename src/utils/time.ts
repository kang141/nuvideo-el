/**
 * 格式化秒数为时间字符串
 * @param seconds 秒数
 * @returns 格式化后的字符串 (如 "1.05s" 或 "1:23.45")
 */
export const formatTime = (seconds: number) => {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
  return `${secs}.${ms.toString().padStart(2, '0')}s`;
};
