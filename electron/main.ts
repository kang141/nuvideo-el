import { app, BrowserWindow, ipcMain, desktopCapturer, screen, protocol, dialog, shell, globalShortcut } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import crypto from 'node:crypto'
import './audio-handler'
import { initCursorUtils, getCursorShape } from './cursor-utils'

// 初始化鼠标形态工具 (Win32)
initCursorUtils();

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// 动态获取 FFmpeg 路径
const getFFmpegPath = () => {
  const isDev = !!VITE_DEV_SERVER_URL;
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const executableIdentifier = process.platform === 'win32' ? '.exe' : '';

  if (isDev) {
    // 开发环境下使用系统全局 ffmpeg 或项目本地 resources 下的
    const localPkgPath = path.join(process.env.APP_ROOT, 'resources', 'bin', platform, `ffmpeg${executableIdentifier}`);
    return fs.existsSync(localPkgPath) ? localPkgPath : 'ffmpeg';
  }

  // 打包环境下，从 extraResources (resources/bin) 目录获取
  return path.join(process.resourcesPath, 'bin', `ffmpeg${executableIdentifier}`);
};

const ffmpegPath = getFFmpegPath();

let win: BrowserWindow | null

protocol.registerSchemesAsPrivileged([
  { scheme: 'nuvideo', privileges: { bypassCSP: true, stream: true, secure: true, standard: true, supportFetchAPI: true } },
  { scheme: 'asset', privileges: { bypassCSP: true, secure: true, standard: true, supportFetchAPI: true } }
])

function createWindow() {
  // 采用横向 Dashboard 布局，确保所有功能一眼全览
  const WINDOW_WIDTH = 720
  const WINDOW_HEIGHT = 480

  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    resizable: true,
    maximizable: true,
    frame: false,
    transparent: true, // 恢复透明以消除录制条黑框
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    // 使用 PNG 格式以确保 Windows 任务栏兼容性与图标刷新
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: true,
      backgroundThrottling: false, // 关键：防止后台导出时由于节能导致的解码/渲染暂停
    },
  })

  win.center()

  win.once('ready-to-show', () => {
    win?.show()
  })

  win.on('maximize', () => {
    win?.webContents.send('window-is-maximized', true);
  });

  win.on('unmaximize', () => {
    win?.webContents.send('window-is-maximized', false);
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// --- IPC 监听器 (Top-level 注册一次即可) ---

// 监听来自渲染进程的尺寸调整请求
ipcMain.on('resize-window', (_event, { width, height, resizable, position, mode }) => {
  if (win) {
    if (mode === 'recording') {
      // 录制模式：需要开启透明度以消除控制条周围的黑框
      win.setBackgroundColor('#00000000')
      // 注意：Electron 不支持动态切换构造函数中的 transparent 属性，
      // 但在 Windows 上，我们可以通过 setOpacity 或确保背景透明来模拟。
      // 为了彻底修复黑框，我们需要在创建窗口时保持 transparent: true，或在这里尝试兼容性处理。
      
      win.setResizable(true)
      win.setSize(width, height)
      win.setResizable(false)

      const primaryDisplay = screen.getPrimaryDisplay()
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
      const x = Math.floor((screenWidth - width) / 2)
      const y = Math.floor(screenHeight - height - 80) // 向上移动约 40px
      
      win.setPosition(x, y)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setIgnoreMouseEvents(false) // 只有覆盖全屏时才需要开启穿透，现在不需要了
      return
    }

    win.setResizable(true)
    win.setMinimumSize(400, 300) // 设置一个合理的最小尺寸
    win.setSize(width, height)
    win.setResizable(resizable ?? true)

    if (position === 'bottom') {
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

      const x = Math.floor((screenWidth - width) / 2)
      const y = Math.floor(screenHeight - height - 40) // 距离底部一些边距
      win.setPosition(x, y)
      win.setAlwaysOnTop(true, 'screen-saver') // 录制时始终置顶
    } else {
      win.center()
      win.setAlwaysOnTop(false)
      win.setIgnoreMouseEvents(false) // 恢复正常交互
    }
  }
})

// 监听忽略鼠标事件的切换 (用于录制条悬停时恢复点击)
ipcMain.on('set-ignore-mouse-events', (_event, ignore, options) => {
  if (win) {
    win.setIgnoreMouseEvents(ignore, options)
  }
})

// 获取屏幕录制源
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 400, height: 225 }, // 略微提升分辨率以匹配 UI 宽度 (清晰度+)
      fetchWindowIcons: false // 首页暂不需要图标，减少开销
    })
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      // 使用 85% 质量的 JPEG，平衡清晰度与性能
      thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`
    }))
  } catch (err) {
    console.error('Failed to get sources:', err)
    return []
  }
})

// 保存录制的视频到临时文件
ipcMain.handle('save-temp-video', async (_event, arrayBuffer: ArrayBuffer) => {
  try {
    const tempDir = app.getPath('temp')
    const fileName = `nuvideo_${Date.now()}.mp4`
    const tempPath = path.join(tempDir, fileName)
    const buffer = Buffer.from(arrayBuffer)
    fs.writeFileSync(tempPath, buffer)

    // 使用自定义协议 nuvideo:// 代替 file:// 绕过 Electron 安全限制
    const customUrl = `nuvideo://load/${fileName}`
    console.log('[Main] Video saved to physical path:', tempPath)
    console.log('[Main] Custom URL for renderer:', customUrl)
    return customUrl
  } catch (err) {
    console.error('[Main] save-temp-video failed:', err)
    return null
  }
})

// 显示保存对话框
ipcMain.handle('show-save-dialog', async (_event, options: { defaultPath?: string, defaultName?: string } = {}) => {
  let initialPath = '';

  if (options.defaultPath) {
    // 检查 defaultPath 是否已经是完整路径（包含后缀）比较复杂，这里简单判定：
    // 如果 defaultPath 是目录，且有 defaultName，则拼接
    if (options.defaultName && !options.defaultPath.toLowerCase().endsWith('.mp4') && !options.defaultPath.toLowerCase().endsWith('.gif')) {
      initialPath = path.join(options.defaultPath, options.defaultName);
    } else {
      initialPath = options.defaultPath;
    }
  } else {
    initialPath = path.join(app.getPath('videos'), options.defaultName || `nuvideo_export_${Date.now()}.mp4`);
  }

  return await dialog.showSaveDialog({
    title: '导出视频',
    defaultPath: initialPath,
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'gif', 'webm'] }
    ],
    properties: ['showOverwriteConfirmation']
  })
})

// Renderer <-> Main clock sync (monotonic)
ipcMain.handle('sync-clock', async (_event, tClient: number) => {
  return { tClient, tServer: performance.now() }
})

// --- Session 架构核心类 ---
interface Manifest {
  version: string;
  sessionId: string;
  createdAt: number;
  status: 'recording' | 'finished' | 'error';
  source: {
    id: string;
    width: number;
    height: number;
    scaleFactor: number;
  };
  tracks: {
    video: { path: string; fps: number };
    mouse: { path: string };
    audio_host?: { path: string };
  };
}

class SessionRecorder {
  sessionId: string;
  sessionDir: string;
  manifestPath: string;
  mouseLogPath: string;
  videoPath: string;

  private manifest: Manifest;
  private bounds: any;
  private mouseLogStream: fs.WriteStream | null = null;
  private ffmpegProcess: any = null;
  private mouseMonitorProcess: any = null;
  private mousePollTimer: any = null;
  private startTime: number = 0;
  private readyOffset: number = 0; // 关键：从 FFmpeg 启动到产生第一帧的毫秒数
  private isStopping: boolean = false;
  private isRecordingStarted: boolean = false; // 判定录制是否已成功开始（即绕过启动探测阶段）

  constructor(sourceId: string, bounds: any, scaleFactor: number) {
    this.sessionId = crypto.randomUUID();
    this.bounds = bounds;
    this.sessionDir = path.join(app.getPath('temp'), 'nuvideo_sessions', this.sessionId);

    // 确保目录结构
    fs.mkdirSync(this.sessionDir, { recursive: true });
    fs.mkdirSync(path.join(this.sessionDir, 'events'), { recursive: true });

    this.manifestPath = path.join(this.sessionDir, 'manifest.json');
    this.mouseLogPath = path.join(this.sessionDir, 'events', 'mouse.jsonl');
    this.videoPath = path.join(this.sessionDir, 'video_raw.mp4');

    this.manifest = {
      version: '1.0',
      sessionId: this.sessionId,
      createdAt: Date.now(),
      status: 'recording',
      source: {
        id: sourceId,
        width: bounds.width,
        height: bounds.height,
        scaleFactor: scaleFactor
      },
      tracks: {
        video: { path: 'video_raw.mp4', fps: 30 },
        mouse: { path: 'events/mouse.jsonl' }
      }
    };

    this.writeManifest();
    this.mouseLogStream = fs.createWriteStream(this.mouseLogPath, { flags: 'a' });
  }

  private writeManifest() {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  logMouseEvent(event: any) {
    if (this.mouseLogStream) {
      // 统一使用微秒级精度或毫秒级浮点
      const entry = JSON.stringify({ ...event, ts: performance.now() - this.startTime });
      this.mouseLogStream.write(entry + '\n');
    }
  }

  async start(ffmpegPath: string, args: string[], monitorPath: string): Promise<{ success: boolean; error?: string; readyOffset?: number }> {
    const { spawn } = await import('node:child_process');

    // 1. 启动 FFmpeg (打印完整命令用于调试)
    console.log(`[Session] Starting FFmpeg: ${ffmpegPath} ${args.join(' ')}`);
    this.ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });

    // 防止 stdin 写入错误（如 EPIPE）导致整个主进程崩溃
    if (this.ffmpegProcess.stdin) {
      this.ffmpegProcess.stdin.on('error', (err: any) => {
        console.error(`[Session] FFmpeg stdin error:`, err);
      });
    }

    return new Promise((resolve) => {
      let resolved = false;

      this.ffmpegProcess.stderr.on('data', (data: Buffer) => {
        const log = data.toString().trim();
        // 打印实时日志到控制台，不只是简单的 log
        process.stderr.write(`[FFmpeg Err] ${log}\n`);

        if (log.includes('frame=')) {
          if (!resolved) {
            resolved = true;
            this.isRecordingStarted = true;
            this.readyOffset = performance.now() - this.startTime;
            resolve({ success: true, readyOffset: this.readyOffset });
          }
        } else if (log.toLowerCase().includes('failed') || log.toLowerCase().includes('error')) {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: log });
          }
        }
      });

      this.ffmpegProcess.once('spawn', () => {
        this.startTime = performance.now();
        console.log(`[Session] Recording process spawned: ${this.sessionId}`);

        // 2. 启动鼠标监控 (PowerShell)
        if (fs.existsSync(monitorPath) && process.platform === 'win32') {
          this.mouseMonitorProcess = spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', monitorPath
          ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

          this.mouseMonitorProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().trim().split(/\r?\n/);
            lines.forEach(line => {
              const signal = line.trim();
              if ((signal === 'DOWN' || signal === 'UP') && win) {
                const t = performance.now() - this.startTime;
                this.logMouseEvent({ type: signal.toLowerCase() });
                win.webContents.send('mouse-click', { type: signal.toLowerCase(), t });
              }
            });
          });
        }

        // 3. 🎯 优化：高频鼠标轮询 (120Hz = 8.33ms)，确保流畅捕获
        // 采样频率应该是视频帧率的 2 倍以上（奈奎斯特定理）
        // 60fps 视频 → 至少 120Hz 采样才能避免闪烁
        this.mousePollTimer = setInterval(() => {
          if (!win) return;
          const point = screen.getCursorScreenPoint();
          const t = performance.now() - this.startTime;
          
          // 获取当前的鼠标形态 (arrow, hand, text 等)
          const shape = getCursorShape();

          const x = (point.x - this.bounds.x) / this.bounds.width;
          const y = (point.y - this.bounds.y) / this.bounds.height;

          this.logMouseEvent({ type: 'move', x, y, shape });
          win.webContents.send('mouse-update', { x, y, t, shape });
        }, 8); // 从 20ms 降低到 8ms (120Hz)

        // 如果 3 秒后还没看到帧，视为启动失败
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: 'FFmpeg startup timeout (no frames detected)' });
          }
        }, 3000);
      });

      this.ffmpegProcess.on('exit', (code: number) => {
        console.error(`[Session] FFmpeg process exited with code ${code}`);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: `FFmpeg exited with code ${code}` });
        }
        if (code !== 0 && !this.isStopping) {
          this.manifest.status = 'error';
          this.writeManifest();
          // 仅在正式开始录制后（非探测阶段）发生的意外中断，才通知前端
          if (this.isRecordingStarted && win) {
            win.webContents.send('recording-error', '底层录制引擎(FFmpeg)意外中断，请检查系统资源。');
          }
        }
      });

      this.ffmpegProcess.once('error', (err: any) => {
        console.error(`[Session] FFmpeg failed to start:`, err);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  /**
   * 仅清理进程，不销毁 Session 环境
   * 用于在 start 循环中尝试不同编码器
   */
  async cleanupProcess() {
    if (this.mousePollTimer) {
      clearInterval(this.mousePollTimer);
      this.mousePollTimer = null;
    }
    if (this.mouseMonitorProcess) {
      this.mouseMonitorProcess.kill();
      this.mouseMonitorProcess = null;
    }
    if (this.ffmpegProcess) {
      const proc = this.ffmpegProcess;
      this.ffmpegProcess = null;
      this.isRecordingStarted = false; // 重置开始标志
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => proc.kill('SIGKILL'), 1000);
        proc.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        if (proc.stdin && proc.stdin.writable) {
          try { proc.stdin.write('q\n'); proc.stdin.end(); } catch(e) {}
        } else {
          proc.kill('SIGKILL');
        }
      });
    }
  }

  async stop(): Promise<string> {
    if (this.isStopping) return '';
    this.isStopping = true;

    // 清理鼠标轮询定时器
    if (this.mousePollTimer) {
      clearInterval(this.mousePollTimer);
      this.mousePollTimer = null;
    }
    
    // 清理鼠标监控进程
    if (this.mouseMonitorProcess) {
      this.mouseMonitorProcess.kill();
      this.mouseMonitorProcess = null;
    }

    return new Promise((resolve) => {
      const proc = this.ffmpegProcess;
      if (!proc) return resolve('');

      const forceKillTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { }
      }, 3000);

      proc.once('close', () => {
        clearTimeout(forceKillTimer);
        
        // 关闭鼠标日志流
        if (this.mouseLogStream) {
          this.mouseLogStream.close();
          this.mouseLogStream = null;
        }

        this.manifest.status = 'finished';
        this.writeManifest();

        console.log(`[Session] Recording finished: ${this.sessionId}`);
        // 返回会话路径包 (自定义协议解析)
        resolve(`nuvideo://session/${this.sessionId}`);
      });

      try {
        if (proc.stdin && proc.stdin.writable) {
          proc.stdin.write('q\n');
          proc.stdin.end();
        } else {
          proc.kill('SIGKILL');
        }
      } catch (e) {
        console.error('[Session] Error stopping recording gracefully:', e);
        proc.kill('SIGKILL');
      }
    });
  }

  getFilePath(relPath: string) {
    return path.join(this.sessionDir, relPath);
  }
}

let currentSession: SessionRecorder | null = null;
const allSessions = new Map<string, SessionRecorder>();

/**
 * 助手函数：构建带音频支持的 FFmpeg 参数
 * 支持智能编码器选择：NVENC > AMF > QSV > libx264
 */
function buildFFmpegArgs(videoInputParams: string[], outputPath: string, encoderPreference: 'nvenc' | 'amf' | 'qsv' | 'software' = 'nvenc') {
  const args = [
    '-loglevel', 'info',
    '-thread_queue_size', '16384',
    '-init_hw_device', 'd3d11va', // 显式初始化硬件设备以供后续滤镜使用
  ];

  // 1. 注入视频输入参数
  args.push(...videoInputParams);

  // 2. 视频编码 - 根据偏好选择编码器及其对应的滤镜链
  switch (encoderPreference) {
    case 'nvenc': // NVIDIA GPU
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p7',      // 改为最高质量预设
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', '17',          // 降低 cq 值（0-51，越小越清晰，17为视觉无损级别）
        '-b:v', '0',
        '-maxrate', '120M',
        '-bufsize', '240M',
        '-profile:v', 'high',
        '-level', '5.2',      // 提升 Level 支持更高分辨率
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart+frag_keyframe+empty_moov',
        '-g', '120'
      );
      break;

    case 'amf': // AMD GPU
      args.push(
        '-c:v', 'h264_amf',
        '-quality', 'quality',
        '-rc', 'vbr_latency',
        '-qp_i', '16',        // 提升 I 帧质量
        '-qp_p', '18',        // 提升 P 帧质量
        '-b:v', '60M',
        '-maxrate', '120M',
        '-bufsize', '240M',
        '-profile:v', 'high',
        '-level', '5.2',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart+frag_keyframe+empty_moov',
        '-g', '120'
      );
      break;

    case 'qsv': // Intel Quick Sync
      args.push(
        '-vf', 'hwmap=derive_device=qsv,format=qsv', // QSV 专用转换逻辑
        '-c:v', 'h264_qsv',
        '-preset', 'medium',
        '-global_quality', '20',
        '-look_ahead', '1',
        '-b:v', '50M',
        '-maxrate', '100M',
        '-bufsize', '200M',
        '-profile:v', 'high',
        '-level', '5.1',
        '-pix_fmt', 'nv12', // QSV 通常在 NV12 下工作得最好
        '-movflags', 'faststart+frag_keyframe+empty_moov',
        '-g', '120'
      );
      break;

    case 'software': // CPU 软件编码 (兜底)
    default:
      args.push(
        '-vf', 'hwdownload,format=bgra,format=yuv420p', // 下载显存到内存并转换
        '-c:v', 'libx264',
        '-preset', 'medium',   // 从 veryfast 提升到 medium 以换取细节
        '-tune', 'zerolatency',
        '-crf', '18',          // 提升画质（18-22为标准清晰范围）
        '-profile:v', 'high',
        '-level', '5.2',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart+frag_keyframe+empty_moov',
        '-threads', '0',
        '-g', '120'
      );
      break;
  }

  args.push(outputPath, '-y');
  return args;
}

ipcMain.handle('start-sidecar-record', async (_event, sourceId: string) => {
  if (currentSession) return { success: false, error: 'Recording already in progress' }

  const allDisplays = screen.getAllDisplays()
  let targetDisplay = screen.getPrimaryDisplay()

  if (sourceId && sourceId.startsWith('screen:')) {
    const displayId = sourceId.split(':')[1]
    const found = allDisplays.find(d => d.id.toString() === displayId)
    if (found) targetDisplay = found
  }

  const { bounds, scaleFactor } = targetDisplay;

  // 查找对应的显示器索引（用于 ddagrab 的 output_idx）
  let outputIdx = 0;
  if (sourceId && sourceId.startsWith('screen:')) {
    const displayId = sourceId.split(':')[1];
    outputIdx = allDisplays.findIndex(d => d.id.toString() === displayId);
    if (outputIdx === -1) outputIdx = 0;
  }

  currentSession = new SessionRecorder(sourceId, bounds, scaleFactor);
  const recordingPath = currentSession.videoPath;
 
  // --- 核心修复：更鲁棒的 ddagrab 参数 ---
  // 加入 dup_frames=0 解决 Invalid argument 报错，增加稳定性
  const inputSource = `ddagrab=output_idx=${outputIdx}:draw_mouse=0:framerate=60:dup_frames=0`;

  const videoInputDda = [
    '-f', 'lavfi',
    '-i', inputSource
  ];

  const scriptPath = path.join(process.env.APP_ROOT || '', 'resources', 'scripts', 'mouse-monitor.ps1');
  const psPath = fs.existsSync(scriptPath)
    ? scriptPath
    : path.join(process.resourcesPath, 'scripts', 'mouse-monitor.ps1');

  console.log('[Main] Starting Ultra-High-Performance ddagrab capture (Re-entrant cycle)...');
  
  const encoderFallback: Array<'nvenc' | 'amf' | 'qsv' | 'software'> = ['nvenc', 'amf', 'qsv', 'software'];
  let result: any = null;
  
  for (const encoder of encoderFallback) {
    const argsDda = buildFFmpegArgs(videoInputDda, recordingPath, encoder);
    console.log(`[Main] Attempting [${encoder}] for session [${currentSession.sessionId}]`);
    
    result = await currentSession.start(ffmpegPath, argsDda, psPath);
    
    if (result.success) {
      console.log(`[Main] ✅ Recording started successfully via [${encoder}]`);
      break;
    } else {
      console.warn(`[Main] ❌ [${encoder}] failed: ${result.error}. Trying next fallback...`);
      // 关键：仅清理进程，保留 Session 目录和 ID
      await currentSession.cleanupProcess();
      // 如果文件已创建但损坏，重试时 FFmpeg 的 -y 会覆盖它
    }
  }


  if (result.success) {
    allSessions.set(currentSession.sessionId, currentSession);
    return { 
      success: true, 
      sessionId: currentSession.sessionId, 
      bounds, 
      t0: performance.now(),
      readyOffset: result.readyOffset || 0 
    };
  } else {
    // 清理失败的会话，确保状态一致性
    if (currentSession) {
      allSessions.delete(currentSession.sessionId);
      currentSession = null;
    }
    return result;
  }
})

ipcMain.handle('stop-sidecar-record', async () => {
  console.log('[Main] IPC: stop-sidecar-record called. currentSession exists:', !!currentSession);
  if (!currentSession) {
    console.warn('[Main] Warning: stop-sidecar-record called but currentSession is null. This may be due to a process restart or FFmpeg crash.');
    return null;
  }
  const sessionUrl = await currentSession.stop();
  const sessionId = currentSession.sessionId;
  currentSession = null;
  return { success: true, recordingPath: sessionUrl, sessionId };
})


// 将最终导出的数据保存到用户选择的路径
ipcMain.handle('save-exported-video', async (_event, { arrayBuffer, targetPath }) => {
  try {
    const buffer = Buffer.from(arrayBuffer)
    if (!buffer.length) {
      throw new Error('Export failed: empty export buffer (no frames recorded).')
    }

    fs.writeFileSync(targetPath, buffer)
    console.log('[Main] Export successful:', targetPath);
    return { success: true }
  } catch (err) {
    console.error('[Main] save-exported-video failed:', err)
    return { success: false, error: (err as Error).message }
  }
})

// ============ 流式写入 API (Phase 5 优化) ============
// 用于避免大视频的内存峰值和 IPC 全量拷贝

interface ExportStreamHandle {
  fd: number;
  path: string;
  bytesWritten: number;
}

const activeExportStreams = new Map<string, ExportStreamHandle>();

// 打开导出流
ipcMain.handle('open-export-stream', async (_event, { targetPath }) => {
  try {
    const fd = fs.openSync(targetPath, 'w');
    const streamId = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    activeExportStreams.set(streamId, { fd, path: targetPath, bytesWritten: 0 });
    console.log('[Main] Export stream opened:', targetPath);
    return { success: true, streamId };
  } catch (err) {
    console.error('[Main] open-export-stream failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 写入数据块 (支持随机写入，用于 MP4 moov 回填)
ipcMain.handle('write-export-chunk', async (_event, { streamId, chunk, position }) => {
  try {
    const handle = activeExportStreams.get(streamId);
    if (!handle) {
      throw new Error(`Stream ${streamId} not found`);
    }

    const buffer = Buffer.from(chunk);

    if (typeof position === 'number') {
      // 随机写入 (用于回填 Header)
      fs.writeSync(handle.fd, buffer, 0, buffer.length, position);
      // 注意：随机写入不更新 bytesWritten 统计，因为它不是 append
      // 但对于 moov 更新，我们通常不需要关心总大小的变化，因为它只是覆盖占位符
    } else {
      // 追加写入
      fs.writeSync(handle.fd, buffer, 0, buffer.length, null); // null means current position
      handle.bytesWritten += buffer.length;
    }

    return { success: true, bytesWritten: handle.bytesWritten };
  } catch (err) {
    console.error('[Main] write-export-chunk failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 关闭导出流
ipcMain.handle('close-export-stream', async (_event, { streamId }) => {
  try {
    const handle = activeExportStreams.get(streamId);
    if (!handle) {
      throw new Error(`Stream ${streamId} not found`);
    }

    fs.closeSync(handle.fd);
    activeExportStreams.delete(streamId);
    console.log(`[Main] Export stream closed: ${handle.path} (${handle.bytesWritten} bytes)`);

    return { success: true, totalBytes: handle.bytesWritten };
  } catch (err) {
    console.error('[Main] close-export-stream failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 打开文件所在目录
ipcMain.handle('show-item-in-folder', async (_event, filePath: string) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
});

// 删除文件
ipcMain.handle('delete-file', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// --- 生命周期管理 ---

// 视频转高质量 GIF
ipcMain.handle('convert-mp4-to-gif', async (_event, { inputPath, outputPath, width, fps = 30 }) => {
  try {
    const { spawn } = await import('node:child_process');

    // 采用更先进的 "one-pass" 调色板渲染策略
    // fps=${fps}: 确保抽帧频率符合预期
    // flags=lanczos: 高质量缩放
    // palettegen: 使用单帧色彩优化
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos:sws_dither=none,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`;

    const gifArgs = [
      '-i', inputPath,
      '-vf', filter,
      '-y', outputPath
    ];

    console.log('[Main] Generating optimized GIF with filter:', filter);
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, gifArgs);
      p.on('close', (code) => code === 0 ? resolve(null) : reject(new Error(`GIF generation failed with code ${code}`)));
    });

    // 清理原 MP4 避免重复占用空间
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

    return { success: true };
  } catch (err) {
    console.error('[Main] convert-mp4-to-gif failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

app.on('will-quit', () => {
  if (currentSession) {
    currentSession.stop();
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// --- 智能缓存管理 (CleanUp Manager) ---
class CleanUpManager {
  static async runSilentCleanup() {
    try {
      const sessionsRootDir = path.join(app.getPath('temp'), 'nuvideo_sessions');
      if (!fs.existsSync(sessionsRootDir)) return;

      const sessionFolders = fs.readdirSync(sessionsRootDir);
      if (sessionFolders.length === 0) return;

      // 获取所有 Session 的元数据
      const sessionStats = sessionFolders.map(folder => {
        const folderPath = path.join(sessionsRootDir, folder);
        const stats = fs.statSync(folderPath);
        return { folder, folderPath, mtime: stats.mtimeMs };
      });

      // 按时间倒序排列 (最新的在前)
      sessionStats.sort((a, b) => b.mtime - a.mtime);

      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const MAX_SESSIONS = 10;
      const now = Date.now();

      const toDelete = sessionStats.filter((session, index) => {
        const isTooOld = (now - session.mtime) > THREE_DAYS_MS;
        const isTooMany = index >= MAX_SESSIONS;
        // 如果正在录制的 session (当前 session) 的文件夹名被包含在内，跳过它
        if (currentSession && session.folder === currentSession.sessionId) return false;
        
        return isTooOld || isTooMany;
      });

      if (toDelete.length > 0) {
        console.log(`[CleanUp] Found ${toDelete.length} stale sessions to purge...`);
        for (const session of toDelete) {
          try {
            // 递归删除 Session 文件夹
            fs.rmSync(session.folderPath, { recursive: true, force: true });
          } catch (e) {
            console.warn(`[CleanUp] Failed to delete session ${session.folder}:`, e);
          }
        }
        console.log('[CleanUp] Purge complete.');
      }
    } catch (err) {
      console.error('[CleanUp] Critical error during startup cleanup:', err);
    }
  }
}

app.whenReady().then(() => {
  // 启动时执行静默清理
  CleanUpManager.runSilentCleanup();
  
  // --- 现代协议处理器 (Electron 25+) ---
  // 处理 nuvideo://load/filename 格式，将其映射到临时目录
  // 注册协议处理器
  protocol.registerFileProtocol('nuvideo', (request, callback) => {
    // 关键修正：必须对 URL 进行解码，因为浏览器传入的路径可能包含编码字符
    const url = decodeURIComponent(request.url);

    if (url.startsWith('nuvideo://load/')) {
      const fileName = url.replace('nuvideo://load/', '');
      const normalizedFileName = path.basename(fileName);
      const filePath = path.join(app.getPath('temp'), normalizedFileName);
      return callback({ path: filePath })
    }

    if (url.startsWith('nuvideo://session/')) {
      const parts = url.replace('nuvideo://session/', '').split('/');
      const sessionId = parts[0];
      const relPath = parts.slice(1).join('/') || 'manifest.json';

      const session = allSessions.get(sessionId);
      let sessionDir = session?.sessionDir;

      if (!sessionDir) {
        const tempDir = path.join(app.getPath('temp'), 'nuvideo_sessions', sessionId);
        if (fs.existsSync(tempDir)) {
          sessionDir = tempDir;
        }
      }

      if (sessionDir) {
        const normalizedRelPath = path.normalize(relPath);
        if (normalizedRelPath.includes('..')) {
          return callback({ error: -6 });
        }
        const filePath = path.join(sessionDir, normalizedRelPath);
        
        // 增加文件存在性硬检查
        if (fs.existsSync(filePath)) {
          return callback({ path: filePath });
        } else {
          console.warn('[Protocol Handler] File not found on disk:', filePath);
        }
      }
    }

    callback({ error: -6 }) // NET_ERROR(FILE_NOT_FOUND, -6)
  })

  // 注册 asset:// 协议用于访问静态资源
  protocol.registerFileProtocol('asset', (request, callback) => {
    // 移除协议前缀，并统一处理斜杠
    let assetPath = request.url.replace('asset://', '')
    if (assetPath.startsWith('/')) assetPath = assetPath.substring(1)

    let fullPath = ''
    if (VITE_DEV_SERVER_URL) {
      // 开发模式：资源在 public 目录
      fullPath = path.join(process.env.VITE_PUBLIC, assetPath)
    } else {
      // 打包模式：Vite 会将 public 里的资源平铺在 dist 根目录
      fullPath = path.join(RENDERER_DIST, assetPath)
    }

    callback({ path: path.normalize(fullPath) })
  })

  // 注册全局快捷键
  globalShortcut.register('F10', () => {
    win?.webContents.send('hotkey-toggle-record');
  });
  globalShortcut.register('F9', () => {
    win?.webContents.send('hotkey-pause-resume');
  });

  createWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
})

ipcMain.on('window-control', (_event, action: 'minimize' | 'toggle-maximize' | 'close' | 'toggle-fullscreen' | 'set-content-protection', value?: any) => {
  if (!win) return
  
  switch (action) {
    case 'set-content-protection':
      win.setContentProtection(!!value)
      break
    case 'minimize':
      win.minimize()
      break
    case 'toggle-maximize':
      {
        // 终极修复：透明窗口模式下，win.isMaximized() 在 Windows 上极度不稳定。
        // 我们通过对比窗口实际尺寸与当前显示器工作区尺寸来手动判定。
        const bounds = win.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const workArea = display.workArea;
        
        // 允许 10 像素的误差以兼容任务栏偏移
        const isCurrentlyMaximized = Math.abs(bounds.width - workArea.width) < 10 && 
                                   Math.abs(bounds.height - workArea.height) < 10;
        
        if (isCurrentlyMaximized) {
          win.unmaximize();
        } else {
          if (!win.resizable) win.setResizable(true);
          win.maximize();
        }
      }
      break;
    case 'toggle-fullscreen':
      win.setFullScreen(!win.isFullScreen())
      break
    case 'close':
      win.close()
      break
    default:
      break
  }
})
