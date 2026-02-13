var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { ipcMain, app, protocol, Notification, desktopCapturer, dialog, screen, shell, BrowserWindow, globalShortcut } from "electron";
import { fileURLToPath } from "node:url";
import path$1 from "node:path";
import fs$1 from "node:fs";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import path from "path";
import fs from "fs";
import koffi from "koffi";
ipcMain.handle("save-session-audio-segments", async (_event, { sessionId, micBuffer, sysBuffer }) => {
  try {
    const sessionDir = path.join(app.getPath("temp"), "nuvideo_sessions", sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw new Error("Session directory does not exist");
    }
    const result = { success: true };
    if (micBuffer) {
      const p = path.join(sessionDir, "audio_mic.webm");
      fs.writeFileSync(p, Buffer.from(micBuffer));
      result.micPath = p;
    }
    if (sysBuffer) {
      const p = path.join(sessionDir, "audio_sys.webm");
      fs.writeFileSync(p, Buffer.from(sysBuffer));
      result.sysPath = p;
    }
    console.log(`[Main] Saved audio segments for ${sessionId}:`, result);
    return result;
  } catch (err) {
    console.error("[Main] Failed to save session audio segments:", err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle("save-session-webcam", async (_event, { sessionId, arrayBuffer }) => {
  try {
    const sessionDir = path.join(app.getPath("temp"), "nuvideo_sessions", sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw new Error("Session directory does not exist");
    }
    const webcamPath = path.join(sessionDir, "webcam.webm");
    fs.writeFileSync(webcamPath, Buffer.from(arrayBuffer));
    console.log(`[Main] Webcam video saved for session ${sessionId}: ${webcamPath}`);
    return { success: true, path: webcamPath };
  } catch (err) {
    console.error("[Main] Failed to save session webcam:", err);
    return { success: false, error: err.message };
  }
});
const IDC_ARROW = 32512;
const IDC_IBEAM = 32513;
const IDC_WAIT = 32514;
const IDC_CROSS = 32515;
const IDC_SIZENWSE = 32642;
const IDC_SIZENESW = 32643;
const IDC_SIZEWE = 32644;
const IDC_SIZENS = 32645;
const IDC_SIZEALL = 32646;
const IDC_NO = 32648;
const IDC_HAND = 32649;
const IDC_APPSTARTING = 32650;
const IDC_HELP = 32651;
const user32 = koffi.load("user32.dll");
const POINT = koffi.struct("POINT", {
  x: "long",
  y: "long"
});
koffi.struct("CURSORINFO", {
  cbSize: "uint32",
  flags: "uint32",
  hCursor: "intptr",
  ptScreenPos: POINT
});
const GetCursorInfo = user32.func("int __stdcall GetCursorInfo(void *pci)");
const LoadCursorA = user32.func("intptr __stdcall LoadCursorA(intptr hInstance, intptr lpCursorName)");
const cursorHandles = {};
function initCursorUtils() {
  if (process.platform !== "win32") return;
  const cursors = {
    default: IDC_ARROW,
    pointer: IDC_HAND,
    text: IDC_IBEAM,
    wait: IDC_WAIT,
    progress: IDC_APPSTARTING,
    crosshair: IDC_CROSS,
    "ns-resize": IDC_SIZENS,
    "ew-resize": IDC_SIZEWE,
    "nwse-resize": IDC_SIZENWSE,
    "nesw-resize": IDC_SIZENESW,
    move: IDC_SIZEALL,
    "not-allowed": IDC_NO,
    help: IDC_HELP
  };
  for (const [name, id] of Object.entries(cursors)) {
    const handle = LoadCursorA(0, id);
    if (handle) {
      cursorHandles[handle.toString()] = name;
    }
  }
}
function getCursorShape() {
  if (process.platform !== "win32") return "default";
  const buf = Buffer.alloc(24);
  buf.writeUInt32LE(24, 0);
  if (GetCursorInfo(buf)) {
    const hCursor = buf.readBigInt64LE(8);
    const handleStr = hCursor.toString();
    const found = cursorHandles[handleStr];
    if (!found) {
      if (Math.random() < 0.05) console.log("[Cursor Debug] Unknown handle:", handleStr);
      return "default";
    }
    return found;
  }
  return "default";
}
initCursorUtils();
const __dirname$1 = path$1.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path$1.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$1.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$1.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$1.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const getFFmpegPath = () => {
  const isDev = !!VITE_DEV_SERVER_URL;
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const executableIdentifier = process.platform === "win32" ? ".exe" : "";
  if (isDev) {
    const localPkgPath = path$1.join(process.env.APP_ROOT, "resources", "bin", platform, `ffmpeg${executableIdentifier}`);
    return fs$1.existsSync(localPkgPath) ? localPkgPath : "ffmpeg";
  }
  return path$1.join(process.resourcesPath, "bin", `ffmpeg${executableIdentifier}`);
};
const ffmpegPath = getFFmpegPath();
let win;
protocol.registerSchemesAsPrivileged([
  { scheme: "nuvideo", privileges: { bypassCSP: true, stream: true, secure: true, standard: true, supportFetchAPI: true } },
  { scheme: "asset", privileges: { bypassCSP: true, secure: true, standard: true, supportFetchAPI: true } }
]);
function createWindow() {
  const WINDOW_WIDTH = 720;
  const WINDOW_HEIGHT = 480;
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    resizable: true,
    maximizable: true,
    frame: false,
    transparent: true,
    // 恢复透明以消除录制条黑框
    backgroundColor: "#00000000",
    hasShadow: true,
    show: false,
    // 使用 PNG 格式以确保 Windows 任务栏兼容性与图标刷新
    icon: path$1.join(process.env.VITE_PUBLIC, "logo.png"),
    webPreferences: {
      preload: path$1.join(__dirname$1, "preload.mjs"),
      webSecurity: true,
      backgroundThrottling: false
      // 关键：防止后台导出时由于节能导致的解码/渲染暂停
    }
  });
  win.center();
  win.once("ready-to-show", () => {
    win == null ? void 0 : win.show();
  });
  win.on("maximize", () => {
    win == null ? void 0 : win.webContents.send("window-is-maximized", true);
  });
  win.on("unmaximize", () => {
    win == null ? void 0 : win.webContents.send("window-is-maximized", false);
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path$1.join(RENDERER_DIST, "index.html"));
  }
}
ipcMain.on("resize-window", (_event, { width, height, resizable, position, mode }) => {
  if (win) {
    if (mode === "recording") {
      win.setBackgroundColor("#00000000");
      win.setResizable(true);
      win.setSize(width, height);
      win.setResizable(false);
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const x = Math.floor((screenWidth - width) / 2);
      const y = Math.floor(screenHeight - height - 80);
      win.setPosition(x, y);
      win.setAlwaysOnTop(true, "screen-saver");
      win.setIgnoreMouseEvents(false);
      return;
    }
    win.setResizable(true);
    win.setMinimumSize(400, 300);
    win.setSize(width, height);
    win.setResizable(resizable ?? true);
    if (position === "bottom") {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const x = Math.floor((screenWidth - width) / 2);
      const y = Math.floor(screenHeight - height - 40);
      win.setPosition(x, y);
      win.setAlwaysOnTop(true, "screen-saver");
    } else {
      win.center();
      win.setAlwaysOnTop(false);
      win.setIgnoreMouseEvents(false);
    }
  }
});
ipcMain.on("set-progress-bar", (_event, progress) => {
  if (win && !win.isDestroyed()) {
    win.setProgressBar(progress);
    if (progress >= 1 || progress < 0) {
      win.flashFrame(true);
      setTimeout(() => win == null ? void 0 : win.flashFrame(false), 3e3);
    }
  }
});
ipcMain.on("show-notification", (_event, { title, body, silent }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent }).show();
  }
});
ipcMain.on("set-ignore-mouse-events", (_event, ignore, options) => {
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});
ipcMain.handle("get-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 400, height: 225 },
      // 略微提升分辨率以匹配 UI 宽度 (清晰度+)
      fetchWindowIcons: false
      // 首页暂不需要图标，减少开销
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      // 使用 85% 质量的 JPEG，平衡清晰度与性能
      thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString("base64")}`
    }));
  } catch (err) {
    console.error("Failed to get sources:", err);
    return [];
  }
});
ipcMain.handle("save-temp-video", async (_event, arrayBuffer) => {
  try {
    const tempDir = app.getPath("temp");
    const fileName = `nuvideo_${Date.now()}.mp4`;
    const tempPath = path$1.join(tempDir, fileName);
    const buffer = Buffer.from(arrayBuffer);
    fs$1.writeFileSync(tempPath, buffer);
    const customUrl = `nuvideo://load/${fileName}`;
    console.log("[Main] Video saved to physical path:", tempPath);
    console.log("[Main] Custom URL for renderer:", customUrl);
    return customUrl;
  } catch (err) {
    console.error("[Main] save-temp-video failed:", err);
    return null;
  }
});
ipcMain.handle("show-save-dialog", async (_event, options = {}) => {
  let initialPath = "";
  if (options.defaultPath) {
    if (options.defaultName && !options.defaultPath.toLowerCase().endsWith(".mp4") && !options.defaultPath.toLowerCase().endsWith(".gif")) {
      initialPath = path$1.join(options.defaultPath, options.defaultName);
    } else {
      initialPath = options.defaultPath;
    }
  } else {
    initialPath = path$1.join(app.getPath("videos"), options.defaultName || `nuvideo_export_${Date.now()}.mp4`);
  }
  return await dialog.showSaveDialog({
    title: "导出视频",
    defaultPath: initialPath,
    filters: [
      { name: "Media Files", extensions: ["mp4", "gif", "webm"] }
    ],
    properties: ["showOverwriteConfirmation"]
  });
});
ipcMain.handle("sync-clock", async (_event, tClient) => {
  return { tClient, tServer: performance.now() };
});
class SessionRecorder {
  // 判定录制是否已成功开始（即绕过启动探测阶段）
  constructor(sourceId, bounds, scaleFactor) {
    __publicField(this, "sessionId");
    __publicField(this, "sessionDir");
    __publicField(this, "manifestPath");
    __publicField(this, "mouseLogPath");
    __publicField(this, "videoPath");
    __publicField(this, "manifest");
    __publicField(this, "bounds");
    __publicField(this, "mouseLogStream", null);
    __publicField(this, "ffmpegProcess", null);
    __publicField(this, "mouseMonitorProcess", null);
    __publicField(this, "mousePollTimer", null);
    __publicField(this, "startTime", 0);
    __publicField(this, "readyOffset", 0);
    // 关键：从 FFmpeg 启动到产生第一帧的毫秒数
    __publicField(this, "isStopping", false);
    __publicField(this, "isRecordingStarted", false);
    this.sessionId = crypto.randomUUID();
    this.bounds = bounds;
    this.sessionDir = path$1.join(app.getPath("temp"), "nuvideo_sessions", this.sessionId);
    fs$1.mkdirSync(this.sessionDir, { recursive: true });
    fs$1.mkdirSync(path$1.join(this.sessionDir, "events"), { recursive: true });
    this.manifestPath = path$1.join(this.sessionDir, "manifest.json");
    this.mouseLogPath = path$1.join(this.sessionDir, "events", "mouse.jsonl");
    this.videoPath = path$1.join(this.sessionDir, "video_raw.mp4");
    this.manifest = {
      version: "1.0",
      sessionId: this.sessionId,
      createdAt: Date.now(),
      status: "recording",
      source: {
        id: sourceId,
        width: bounds.width,
        height: bounds.height,
        scaleFactor
      },
      tracks: {
        video: { path: "video_raw.mp4", fps: 30 },
        mouse: { path: "events/mouse.jsonl" }
      }
    };
    this.writeManifest();
    this.mouseLogStream = fs$1.createWriteStream(this.mouseLogPath, { flags: "a" });
  }
  writeManifest() {
    fs$1.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }
  logMouseEvent(event) {
    if (this.mouseLogStream) {
      const entry = JSON.stringify({ ...event, ts: performance.now() - this.startTime });
      this.mouseLogStream.write(entry + "\n");
    }
  }
  async start(ffmpegPath2, args, monitorPath) {
    const { spawn } = await import("node:child_process");
    this.ffmpegProcess = spawn(ffmpegPath2, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
    if (this.ffmpegProcess.stdin) {
      this.ffmpegProcess.stdin.on("error", (err) => {
        console.error(`[Session] FFmpeg stdin error:`, err);
      });
    }
    return new Promise((resolve) => {
      let resolved = false;
      this.ffmpegProcess.stderr.on("data", (data) => {
        const log = data.toString().trim();
        if (log.includes("frame=")) {
          if (!resolved) {
            resolved = true;
            this.isRecordingStarted = true;
            this.readyOffset = performance.now() - this.startTime;
            resolve({ success: true, readyOffset: this.readyOffset });
          }
        } else if (log.toLowerCase().includes("failed") || log.toLowerCase().includes("error")) {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: log });
          }
        }
      });
      this.ffmpegProcess.once("spawn", () => {
        this.startTime = performance.now();
        console.log(`[Session] Recording process spawned: ${this.sessionId}`);
        if (fs$1.existsSync(monitorPath) && process.platform === "win32") {
          this.mouseMonitorProcess = spawn("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            monitorPath
          ], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
          this.mouseMonitorProcess.stdout.on("data", (data) => {
            const lines = data.toString().trim().split(/\r?\n/);
            lines.forEach((line) => {
              const signal = line.trim();
              if ((signal === "DOWN" || signal === "UP") && win) {
                const t = performance.now() - this.startTime;
                this.logMouseEvent({ type: signal.toLowerCase() });
                win.webContents.send("mouse-click", { type: signal.toLowerCase(), t });
              }
            });
          });
        }
        this.mousePollTimer = setInterval(() => {
          if (!win) return;
          const point = screen.getCursorScreenPoint();
          const t = performance.now() - this.startTime;
          const shape = getCursorShape();
          const x = (point.x - this.bounds.x) / this.bounds.width;
          const y = (point.y - this.bounds.y) / this.bounds.height;
          this.logMouseEvent({ type: "move", x, y, shape });
          win.webContents.send("mouse-update", { x, y, t, shape });
        }, 8);
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: "FFmpeg startup timeout (no frames detected)" });
          }
        }, 3e3);
      });
      this.ffmpegProcess.on("exit", (code) => {
        console.error(`[Session] FFmpeg process exited with code ${code}`);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: `FFmpeg exited with code ${code}` });
        }
        if (code !== 0 && !this.isStopping) {
          this.manifest.status = "error";
          this.writeManifest();
          if (this.isRecordingStarted && win) {
            win.webContents.send("recording-error", "底层录制引擎(FFmpeg)意外中断，请检查系统资源。");
          }
        }
      });
      this.ffmpegProcess.once("error", (err) => {
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
      this.isRecordingStarted = false;
      return new Promise((resolve) => {
        const timer = setTimeout(() => proc.kill("SIGKILL"), 1e3);
        proc.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        if (proc.stdin && proc.stdin.writable) {
          try {
            proc.stdin.write("q\n");
            proc.stdin.end();
          } catch (e) {
          }
        } else {
          proc.kill("SIGKILL");
        }
      });
    }
  }
  async stop() {
    if (this.isStopping) return "";
    this.isStopping = true;
    if (this.mousePollTimer) {
      clearInterval(this.mousePollTimer);
      this.mousePollTimer = null;
    }
    if (this.mouseMonitorProcess) {
      this.mouseMonitorProcess.kill();
      this.mouseMonitorProcess = null;
    }
    return new Promise((resolve) => {
      const proc = this.ffmpegProcess;
      if (!proc) return resolve("");
      const forceKillTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
      }, 3e3);
      proc.once("close", () => {
        clearTimeout(forceKillTimer);
        if (this.mouseLogStream) {
          this.mouseLogStream.close();
          this.mouseLogStream = null;
        }
        this.manifest.status = "finished";
        this.writeManifest();
        console.log(`[Session] Recording finished: ${this.sessionId}`);
        resolve(`nuvideo://session/${this.sessionId}`);
      });
      try {
        if (proc.stdin && proc.stdin.writable) {
          proc.stdin.write("q\n");
          proc.stdin.end();
        } else {
          proc.kill("SIGKILL");
        }
      } catch (e) {
        console.error("[Session] Error stopping recording gracefully:", e);
        proc.kill("SIGKILL");
      }
    });
  }
  getFilePath(relPath) {
    return path$1.join(this.sessionDir, relPath);
  }
}
let currentSession = null;
const allSessions = /* @__PURE__ */ new Map();
function buildFFmpegArgs(videoInputParams, outputPath, encoderPreference = "nvenc") {
  const args = [
    "-loglevel",
    "info",
    "-thread_queue_size",
    "16384",
    "-init_hw_device",
    "d3d11va"
    // 显式初始化硬件设备以供后续滤镜使用
  ];
  args.push(...videoInputParams);
  switch (encoderPreference) {
    case "nvenc":
      args.push(
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p7",
        // 改为最高质量预设
        "-tune",
        "hq",
        "-rc",
        "vbr",
        "-cq",
        "17",
        // 降低 cq 值（0-51，越小越清晰，17为视觉无损级别）
        "-b:v",
        "0",
        "-maxrate",
        "120M",
        "-bufsize",
        "240M",
        "-profile:v",
        "high",
        "-level",
        "5.2",
        // 提升 Level 支持更高分辨率
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-g",
        "120"
      );
      break;
    case "amf":
      args.push(
        "-c:v",
        "h264_amf",
        "-quality",
        "quality",
        "-rc",
        "vbr_latency",
        "-qp_i",
        "16",
        // 提升 I 帧质量
        "-qp_p",
        "18",
        // 提升 P 帧质量
        "-b:v",
        "60M",
        "-maxrate",
        "120M",
        "-bufsize",
        "240M",
        "-profile:v",
        "high",
        "-level",
        "5.2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-g",
        "120"
      );
      break;
    case "qsv":
      args.push(
        "-vf",
        "hwmap=derive_device=qsv,format=qsv",
        // QSV 专用转换逻辑
        "-c:v",
        "h264_qsv",
        "-preset",
        "medium",
        "-global_quality",
        "20",
        "-look_ahead",
        "1",
        "-b:v",
        "50M",
        "-maxrate",
        "100M",
        "-bufsize",
        "200M",
        "-profile:v",
        "high",
        "-level",
        "5.1",
        "-pix_fmt",
        "nv12",
        // QSV 通常在 NV12 下工作得最好
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-g",
        "120"
      );
      break;
    case "software":
    default:
      args.push(
        "-vf",
        "hwdownload,format=bgra,format=yuv420p",
        // 下载显存到内存并转换
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        // 从 veryfast 提升到 medium 以换取细节
        "-tune",
        "zerolatency",
        "-crf",
        "18",
        // 提升画质（18-22为标准清晰范围）
        "-profile:v",
        "high",
        "-level",
        "5.2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-threads",
        "0",
        "-g",
        "120"
      );
      break;
  }
  args.push(outputPath, "-y");
  return args;
}
ipcMain.handle("start-sidecar-record", async (_event, sourceId) => {
  if (currentSession) return { success: false, error: "Recording already in progress" };
  const allDisplays = screen.getAllDisplays();
  let targetDisplay = screen.getPrimaryDisplay();
  if (sourceId && sourceId.startsWith("screen:")) {
    const displayId = sourceId.split(":")[1];
    const found = allDisplays.find((d) => d.id.toString() === displayId);
    if (found) targetDisplay = found;
  }
  const { bounds, scaleFactor } = targetDisplay;
  let outputIdx = 0;
  if (sourceId && sourceId.startsWith("screen:")) {
    const displayId = sourceId.split(":")[1];
    outputIdx = allDisplays.findIndex((d) => d.id.toString() === displayId);
    if (outputIdx === -1) outputIdx = 0;
  }
  currentSession = new SessionRecorder(sourceId, bounds, scaleFactor);
  const recordingPath = currentSession.videoPath;
  const inputSource = `ddagrab=output_idx=${outputIdx}:draw_mouse=0:framerate=60:dup_frames=0`;
  const videoInputDda = [
    "-f",
    "lavfi",
    "-i",
    inputSource
  ];
  const scriptPath = path$1.join(process.env.APP_ROOT || "", "resources", "scripts", "mouse-monitor.ps1");
  const psPath = fs$1.existsSync(scriptPath) ? scriptPath : path$1.join(process.resourcesPath, "scripts", "mouse-monitor.ps1");
  console.log("[Main] Starting Ultra-High-Performance ddagrab capture (Re-entrant cycle)...");
  const encoderFallback = ["nvenc", "amf", "qsv", "software"];
  let result = null;
  for (const encoder of encoderFallback) {
    const argsDda = buildFFmpegArgs(videoInputDda, recordingPath, encoder);
    console.log(`[Main] Attempting [${encoder}] for session [${currentSession.sessionId}]`);
    result = await currentSession.start(ffmpegPath, argsDda, psPath);
    if (result.success) {
      console.log(`[Main] ✅ Recording started successfully via [${encoder}]`);
      break;
    } else {
      console.warn(`[Main] ❌ [${encoder}] failed: ${result.error}. Trying next fallback...`);
      await currentSession.cleanupProcess();
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
    if (currentSession) {
      allSessions.delete(currentSession.sessionId);
      currentSession = null;
    }
    return result;
  }
});
ipcMain.handle("stop-sidecar-record", async () => {
  console.log("[Main] IPC: stop-sidecar-record called. currentSession exists:", !!currentSession);
  if (!currentSession) {
    console.warn("[Main] Warning: stop-sidecar-record called but currentSession is null. This may be due to a process restart or FFmpeg crash.");
    return null;
  }
  const sessionUrl = await currentSession.stop();
  const sessionId = currentSession.sessionId;
  currentSession = null;
  return { success: true, recordingPath: sessionUrl, sessionId };
});
ipcMain.handle("save-exported-video", async (_event, { arrayBuffer, targetPath }) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error("Export failed: empty export buffer (no frames recorded).");
    }
    fs$1.writeFileSync(targetPath, buffer);
    console.log("[Main] Export successful:", targetPath);
    return { success: true };
  } catch (err) {
    console.error("[Main] save-exported-video failed:", err);
    return { success: false, error: err.message };
  }
});
const activeExportStreams = /* @__PURE__ */ new Map();
ipcMain.handle("open-export-stream", async (_event, { targetPath }) => {
  try {
    const fd = fs$1.openSync(targetPath, "w");
    const streamId = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    activeExportStreams.set(streamId, { fd, path: targetPath, bytesWritten: 0 });
    console.log("[Main] Export stream opened:", targetPath);
    return { success: true, streamId };
  } catch (err) {
    console.error("[Main] open-export-stream failed:", err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle("write-export-chunk", async (_event, { streamId, chunk, position }) => {
  try {
    const handle = activeExportStreams.get(streamId);
    if (!handle) {
      throw new Error(`Stream ${streamId} not found`);
    }
    const buffer = Buffer.from(chunk);
    if (typeof position === "number") {
      fs$1.writeSync(handle.fd, buffer, 0, buffer.length, position);
    } else {
      fs$1.writeSync(handle.fd, buffer, 0, buffer.length, null);
      handle.bytesWritten += buffer.length;
    }
    return { success: true, bytesWritten: handle.bytesWritten };
  } catch (err) {
    console.error("[Main] write-export-chunk failed:", err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle("close-export-stream", async (_event, { streamId }) => {
  try {
    const handle = activeExportStreams.get(streamId);
    if (!handle) {
      throw new Error(`Stream ${streamId} not found`);
    }
    fs$1.closeSync(handle.fd);
    activeExportStreams.delete(streamId);
    console.log(`[Main] Export stream closed: ${handle.path} (${handle.bytesWritten} bytes)`);
    return { success: true, totalBytes: handle.bytesWritten };
  } catch (err) {
    console.error("[Main] close-export-stream failed:", err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle("show-item-in-folder", async (_event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
});
ipcMain.handle("delete-file", async (_event, filePath) => {
  try {
    if (fs$1.existsSync(filePath)) {
      fs$1.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle("convert-mp4-to-gif", async (_event, { inputPath, outputPath, width, fps = 30 }) => {
  try {
    const { spawn } = await import("node:child_process");
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos:sws_dither=none,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`;
    const gifArgs = [
      "-i",
      inputPath,
      "-vf",
      filter,
      "-y",
      outputPath
    ];
    console.log("[Main] Generating optimized GIF with filter:", filter);
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, gifArgs);
      p.on("close", (code) => code === 0 ? resolve(null) : reject(new Error(`GIF generation failed with code ${code}`)));
    });
    if (fs$1.existsSync(inputPath)) fs$1.unlinkSync(inputPath);
    return { success: true };
  } catch (err) {
    console.error("[Main] convert-mp4-to-gif failed:", err);
    return { success: false, error: err.message };
  }
});
app.on("will-quit", () => {
  if (currentSession) {
    currentSession.stop();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
class CleanUpManager {
  static async runSilentCleanup() {
    try {
      const sessionsRootDir = path$1.join(app.getPath("temp"), "nuvideo_sessions");
      if (!fs$1.existsSync(sessionsRootDir)) return;
      const sessionFolders = fs$1.readdirSync(sessionsRootDir);
      if (sessionFolders.length === 0) return;
      const sessionStats = sessionFolders.map((folder) => {
        const folderPath = path$1.join(sessionsRootDir, folder);
        const stats = fs$1.statSync(folderPath);
        return { folder, folderPath, mtime: stats.mtimeMs };
      });
      sessionStats.sort((a, b) => b.mtime - a.mtime);
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1e3;
      const MAX_SESSIONS = 10;
      const now = Date.now();
      const toDelete = sessionStats.filter((session, index) => {
        const isTooOld = now - session.mtime > THREE_DAYS_MS;
        const isTooMany = index >= MAX_SESSIONS;
        if (currentSession && session.folder === currentSession.sessionId) return false;
        return isTooOld || isTooMany;
      });
      if (toDelete.length > 0) {
        console.log(`[CleanUp] Found ${toDelete.length} stale sessions to purge...`);
        for (const session of toDelete) {
          try {
            fs$1.rmSync(session.folderPath, { recursive: true, force: true });
          } catch (e) {
            console.warn(`[CleanUp] Failed to delete session ${session.folder}:`, e);
          }
        }
        console.log("[CleanUp] Purge complete.");
      }
    } catch (err) {
      console.error("[CleanUp] Critical error during startup cleanup:", err);
    }
  }
}
app.whenReady().then(() => {
  CleanUpManager.runSilentCleanup();
  protocol.registerFileProtocol("nuvideo", (request, callback) => {
    const url = decodeURIComponent(request.url);
    if (url.startsWith("nuvideo://load/")) {
      const fileName = url.replace("nuvideo://load/", "");
      const normalizedFileName = path$1.basename(fileName);
      const filePath = path$1.join(app.getPath("temp"), normalizedFileName);
      return callback({ path: filePath });
    }
    if (url.startsWith("nuvideo://session/")) {
      const parts = url.replace("nuvideo://session/", "").split("/");
      const sessionId = parts[0];
      const relPath = parts.slice(1).join("/") || "manifest.json";
      const session = allSessions.get(sessionId);
      let sessionDir = session == null ? void 0 : session.sessionDir;
      if (!sessionDir) {
        const tempDir = path$1.join(app.getPath("temp"), "nuvideo_sessions", sessionId);
        if (fs$1.existsSync(tempDir)) {
          sessionDir = tempDir;
        }
      }
      if (sessionDir) {
        const normalizedRelPath = path$1.normalize(relPath);
        if (normalizedRelPath.includes("..")) {
          return callback({ error: -6 });
        }
        const filePath = path$1.join(sessionDir, normalizedRelPath);
        if (fs$1.existsSync(filePath)) {
          return callback({ path: filePath });
        } else {
          console.warn("[Protocol Handler] File not found on disk:", filePath);
        }
      }
    }
    callback({ error: -6 });
  });
  protocol.registerFileProtocol("asset", (request, callback) => {
    let assetPath = request.url.replace("asset://", "");
    if (assetPath.startsWith("/")) assetPath = assetPath.substring(1);
    let fullPath = "";
    if (VITE_DEV_SERVER_URL) {
      fullPath = path$1.join(process.env.VITE_PUBLIC, assetPath);
    } else {
      fullPath = path$1.join(RENDERER_DIST, assetPath);
    }
    callback({ path: path$1.normalize(fullPath) });
  });
  globalShortcut.register("F10", () => {
    win == null ? void 0 : win.webContents.send("hotkey-toggle-record");
  });
  globalShortcut.register("F9", () => {
    win == null ? void 0 : win.webContents.send("hotkey-pause-resume");
  });
  createWindow();
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
ipcMain.on("window-control", (_event, action, value) => {
  if (!win) return;
  switch (action) {
    case "set-content-protection":
      win.setContentProtection(!!value);
      break;
    case "minimize":
      win.minimize();
      break;
    case "toggle-maximize":
      {
        const bounds = win.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const workArea = display.workArea;
        const isCurrentlyMaximized = Math.abs(bounds.width - workArea.width) < 10 && Math.abs(bounds.height - workArea.height) < 10;
        if (isCurrentlyMaximized) {
          win.unmaximize();
        } else {
          if (!win.resizable) win.setResizable(true);
          win.maximize();
        }
      }
      break;
    case "toggle-fullscreen":
      win.setFullScreen(!win.isFullScreen());
      break;
    case "close":
      win.close();
      break;
  }
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
