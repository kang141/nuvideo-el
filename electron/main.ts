import { app, BrowserWindow, ipcMain, desktopCapturer, screen, protocol, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

protocol.registerSchemesAsPrivileged([
  { scheme: 'nuvideo', privileges: { bypassCSP: true, stream: true, secure: true, standard: true, supportFetchAPI: true } },
  { scheme: 'asset', privileges: { bypassCSP: true, secure: true, standard: true, supportFetchAPI: true } }
])

function createWindow() {
  win = new BrowserWindow({
    width: 350,
    height: 500,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    // 使用 PNG 格式以确保 Windows 任务栏兼容性与图标刷新
    icon: path.join(process.env.VITE_PUBLIC, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: true,
    },
  })

  win.center()

  win.once('ready-to-show', () => {
    win?.show()
  })

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
      // 录制模式：同步全屏尺寸，但保持透明和交互穿透
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width: sw, height: sh } = primaryDisplay.bounds
      win.setResizable(true)
      win.setBounds({ x: 0, y: 0, width: sw, height: sh })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setIgnoreMouseEvents(true, { forward: true }) // 核心：开启全局轨迹监听的前提，同时不阻塞点击
      return
    }

    win.setResizable(true)
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
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true
    })
    
    const validSources = sources.filter(s => s.name !== '');
    
    return validSources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: (source as any).display_id || '', 
    }))
  } catch (err) {
    console.error('[Main] get-sources failed:', err);
    return [];
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

// --- Sidecar 录制引擎 (FFmpeg) ---
let ffmpegProcess: any = null
let recordingPath: string = ''
let mousePollTimer: any = null
let recordingStartTime: number = 0

ipcMain.handle('start-sidecar-record', async (_event, sourceId: string) => {
  if (ffmpegProcess) return { success: false, error: 'Recording already in progress' }

  // 1. 寻找对应屏幕并获取关键的缩放因子 (Scale Factor)
  const allDisplays = screen.getAllDisplays()
  let targetDisplay = screen.getPrimaryDisplay()
  if (sourceId.startsWith('screen:')) {
    const displayId = sourceId.split(':')[1]
    const found = allDisplays.find(d => d.id.toString() === displayId)
    if (found) targetDisplay = found
  }

  const { bounds, scaleFactor } = targetDisplay
  // 核心修复：必须确保物理像素是 2 的倍数，且绝对不能超出物理屏幕边界
  const toEven = (val: number) => {
    const v = Math.round(val);
    return v % 2 === 0 ? v : v - 1;
  };

  const physicalX = Math.round(bounds.x * scaleFactor);
  const physicalY = Math.round(bounds.y * scaleFactor);
  
  // 确保尺寸不会因为四舍五入溢出
  const physicalW = toEven(bounds.width * scaleFactor);
  const physicalH = toEven(bounds.height * scaleFactor);

  const tempDir = app.getPath('temp')
  recordingPath = path.join(tempDir, `nuvideo_raw_${Date.now()}.mkv`)
  
  const args = [
    '-loglevel', 'info', 
    '-thread_queue_size', '1024',
    '-f', 'gdigrab',
    '-framerate', '60',
    '-draw_mouse', '0',
    '-offset_x', physicalX.toString(),
    '-offset_y', physicalY.toString(),
    '-video_size', `${physicalW}x${physicalH}`,
    '-i', 'desktop',
    '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2', 
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    recordingPath,
    '-y'
  ]

  const { spawn } = await import('node:child_process')
  ffmpegProcess = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })

  // 监控提前崩溃：如果 FFmpeg 没坚持到 spawn 之后 1 秒，认为启动失败
  ffmpegProcess.once('exit', (code: number) => {
    if (code !== 0 && code !== null) {
      console.error(`[Main] FFmpeg crashed prematurely with code ${code}`)
      ffmpegProcess = null
      if (mousePollTimer) clearInterval(mousePollTimer)
      recordingStartTime = 0
    }
  })

  // --- 实时日志穿透 ---
  ffmpegProcess.stderr.on('data', (data: Buffer) => {
    const log = data.toString()
    if (log.includes('frame=')) {
      process.stdout.write(`\r[FFmpeg Record] ${log.trim()}`)
    } else {
      console.log('[FFmpeg Log]', log.trim())
    }
  })

  // 启动原生鼠标坐标发报机
  if (mousePollTimer) clearInterval(mousePollTimer)

  return new Promise((resolve) => {
    ffmpegProcess.once('spawn', () => {
      recordingStartTime = performance.now()

      mousePollTimer = setInterval(() => {
        if (!win || !recordingStartTime) return
        const point = screen.getCursorScreenPoint()
        const t = performance.now() - recordingStartTime
        win.webContents.send('mouse-update', { 
          x: (point.x - bounds.x) / bounds.width,
          y: (point.y - bounds.y) / bounds.height,
          t
        })
      }, 16)

      resolve({ success: true, bounds: bounds, t0: recordingStartTime })
    })

    ffmpegProcess.once('error', (err: any) => {
      if (mousePollTimer) clearInterval(mousePollTimer)
      ffmpegProcess = null
      recordingStartTime = 0
      resolve({ success: false, error: err.message })
    })
  })
})

ipcMain.handle('stop-sidecar-record', async () => {
  if (mousePollTimer) {
     clearInterval(mousePollTimer)
     mousePollTimer = null
  }
  recordingStartTime = 0
  
  if (!ffmpegProcess) return null
  const proc = ffmpegProcess
  ffmpegProcess = null

  return new Promise((resolve) => {
    // 宽容一点的超时：给 3 秒让 FFmpeg 冲刷缓冲区所有剩余帧 (Flush)
    const forceKillTimer = setTimeout(() => {
        console.warn('[Main] FFmpeg flush timeout, forcing kill...')
        try { proc.kill('SIGKILL') } catch {}
    }, 3000)

    proc.once('close', () => {
      clearTimeout(forceKillTimer)
      const fileName = path.basename(recordingPath)
      resolve(`nuvideo://load/${fileName}`)
    })

    try {
      // 核心修复：不要直接 kill，而是通过 stdin 告诉 FFmpeg 退出。
      // 它会把缓冲区里最后的那 1 秒内容全部刷入磁盘，不会丢失结尾。
      proc.stdin.write('q\n')
      proc.stdin.end() 
    } catch (e) {
      proc.kill('SIGKILL')
    }
  })
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

// 写入数据块
ipcMain.handle('write-export-chunk', async (_event, { streamId, chunk }) => {
  try {
    const handle = activeExportStreams.get(streamId);
    if (!handle) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    const buffer = Buffer.from(chunk);
    fs.writeSync(handle.fd, buffer);
    handle.bytesWritten += buffer.length;
    
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
      const p = spawn('ffmpeg', gifArgs);
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
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL')
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

app.whenReady().then(() => {
  // --- 现代协议处理器 (Electron 25+) ---
  // 处理 nuvideo://load/filename 格式，将其映射到临时目录
    // 注册协议处理器
  protocol.registerFileProtocol('nuvideo', (request, callback) => {
    const url = request.url.replace('nuvideo://load/', '')
    try {
      const filePath = path.join(app.getPath('temp'), url)
      callback({ path: filePath })
    } catch (error) {
      console.error('Failed to register protocol', error)
    }
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
  
  createWindow()
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
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
      break
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
