/**
 * 物理时间：毫秒级浮点数
 * 严禁使用帧号作为时间索引
 */
export type Timestamp = number;

/**
 * 鼠标事件类型
 */
export type MouseEventType = 'move' | 'down' | 'up' | 'click';

/**
 * 鼠标事件
 */
export interface MouseEvent {
  /** 时间戳（毫秒） */
  t: Timestamp;
  /** 屏幕 X 坐标 */
  x: number;
  /** 屏幕 Y 坐标 */
  y: number;
  /** 事件类型 */
  type: MouseEventType;
  /** 按键（可选） */
  button?: 'left' | 'right' | 'middle';
  /** 鼠标形态 (default, pointer, text, etc.) */
  shape?: string;
}

/**
 * 鼠标主题配置
 */
export interface MouseTheme {
  /** 光标图片路径 */
  cursorImage: string;
  /** 点击特效类型 */
  clickEffect: 'ripple' | 'ring' | 'spark' | 'none';
  /** 高亮圆圈颜色 */
  highlightColor?: string;
  /** 高亮圆圈半径 */
  highlightRadius?: number;
}
