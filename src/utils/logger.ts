/**
 * 生产环境日志管理工具
 * 在开发环境显示详细日志，在生产环境只显示错误和警告
 */

const isDevelopment = process.env.NODE_ENV === 'development';

// 日志级别
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

// 当前日志级别（生产环境只显示错误和警告）
const currentLevel = isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;

export const logger = {
  error(message: string, ...args: unknown[]): void {
    if (currentLevel >= LogLevel.ERROR) {
      console.error(`[NuVideo] ${message}`, ...args);
    }
  },
  
  warn(message: string, ...args: unknown[]): void {
    if (currentLevel >= LogLevel.WARN) {
      console.warn(`[NuVideo] ${message}`, ...args);
    }
  },
  
  info(message: string, ...args: unknown[]): void {
    if (currentLevel >= LogLevel.INFO) {
      console.log(`[NuVideo] ${message}`, ...args);
    }
  },
  
  debug(message: string, ...args: unknown[]): void {
    if (currentLevel >= LogLevel.DEBUG) {
      console.log(`[NuVideo] ${message}`, ...args);
    }
  }
};