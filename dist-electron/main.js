import { protocol, ipcMain, desktopCapturer, app, dialog, screen, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
protocol.registerSchemesAsPrivileged([
  { scheme: "nuvideo", privileges: { bypassCSP: true, stream: true, secure: true, standard: true, supportFetchAPI: true } }
]);
function createWindow() {
  win = new BrowserWindow({
    width: 350,
    height: 500,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      webSecurity: true
    }
  });
  win.center();
  win.once("ready-to-show", () => {
    win == null ? void 0 : win.show();
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
ipcMain.on("resize-window", (_event, { width, height, resizable, position, mode }) => {
  if (win) {
    if (mode === "recording") {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: sw, height: sh } = primaryDisplay.bounds;
      win.setResizable(true);
      win.setBounds({ x: 0, y: 0, width: sw, height: sh });
      win.setAlwaysOnTop(true, "screen-saver");
      win.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    win.setResizable(true);
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
ipcMain.on("set-ignore-mouse-events", (_event, ignore, options) => {
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});
ipcMain.handle("get-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true
    });
    const validSources = sources.filter((s) => s.name !== "");
    return validSources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id || ""
    }));
  } catch (err) {
    console.error("[Main] get-sources failed:", err);
    return [];
  }
});
ipcMain.handle("save-temp-video", async (_event, arrayBuffer) => {
  try {
    const tempDir = app.getPath("temp");
    const fileName = `nuvideo_${Date.now()}.mp4`;
    const tempPath = path.join(tempDir, fileName);
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempPath, buffer);
    const customUrl = `nuvideo://load/${fileName}`;
    console.log("[Main] Video saved to physical path:", tempPath);
    console.log("[Main] Custom URL for renderer:", customUrl);
    return customUrl;
  } catch (err) {
    console.error("[Main] save-temp-video failed:", err);
    return null;
  }
});
ipcMain.handle("show-save-dialog", async () => {
  return await dialog.showSaveDialog({
    title: "导出视频",
    defaultPath: path.join(app.getPath("videos"), `nuvideo_export_${Date.now()}.mp4`),
    filters: [
      { name: "Movies", extensions: ["mp4", "webm"] }
    ]
  });
});
let ffmpegProcess = null;
let recordingPath = "";
let mousePollTimer = null;
ipcMain.handle("start-sidecar-record", async (_event, sourceId) => {
  if (ffmpegProcess) return { success: false, error: "Recording already in progress" };
  const allDisplays = screen.getAllDisplays();
  let targetDisplay = screen.getPrimaryDisplay();
  if (sourceId.startsWith("screen:")) {
    const displayId = sourceId.split(":")[1];
    const found = allDisplays.find((d) => d.id.toString() === displayId);
    if (found) targetDisplay = found;
  }
  const { bounds, scaleFactor } = targetDisplay;
  const toEven = (val) => {
    const v = Math.round(val);
    return v % 2 === 0 ? v : v - 1;
  };
  const physicalX = Math.round(bounds.x * scaleFactor);
  const physicalY = Math.round(bounds.y * scaleFactor);
  const physicalW = toEven(bounds.width * scaleFactor);
  const physicalH = toEven(bounds.height * scaleFactor);
  const tempDir = app.getPath("temp");
  recordingPath = path.join(tempDir, `nuvideo_raw_${Date.now()}.mkv`);
  const args = [
    "-loglevel",
    "info",
    "-thread_queue_size",
    "1024",
    "-f",
    "gdigrab",
    "-framerate",
    "60",
    "-draw_mouse",
    "0",
    "-offset_x",
    physicalX.toString(),
    "-offset_y",
    physicalY.toString(),
    "-video_size",
    `${physicalW}x${physicalH}`,
    "-i",
    "desktop",
    "-vf",
    "crop=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    recordingPath,
    "-y"
  ];
  const { spawn } = await import("node:child_process");
  ffmpegProcess = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false
  });
  ffmpegProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Main] FFmpeg crashed prematurely with code ${code}`);
      ffmpegProcess = null;
      if (mousePollTimer) clearInterval(mousePollTimer);
    }
  });
  ffmpegProcess.stderr.on("data", (data) => {
    const log = data.toString();
    if (log.includes("frame=")) {
      process.stdout.write(`\r[FFmpeg Record] ${log.trim()}`);
    } else {
      console.log("[FFmpeg Log]", log.trim());
    }
  });
  if (mousePollTimer) clearInterval(mousePollTimer);
  mousePollTimer = setInterval(() => {
    if (!win) return;
    const point = screen.getCursorScreenPoint();
    win.webContents.send("mouse-update", {
      x: (point.x - bounds.x) / bounds.width,
      y: (point.y - bounds.y) / bounds.height
    });
  }, 16);
  return new Promise((resolve) => {
    ffmpegProcess.once("spawn", () => {
      resolve({ success: true, bounds });
    });
    ffmpegProcess.once("error", (err) => {
      if (mousePollTimer) clearInterval(mousePollTimer);
      ffmpegProcess = null;
      resolve({ success: false, error: err.message });
    });
  });
});
ipcMain.handle("stop-sidecar-record", async () => {
  if (mousePollTimer) {
    clearInterval(mousePollTimer);
    mousePollTimer = null;
  }
  if (!ffmpegProcess) return null;
  const proc = ffmpegProcess;
  ffmpegProcess = null;
  return new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      console.warn("[Main] FFmpeg flush timeout, forcing kill...");
      try {
        proc.kill("SIGKILL");
      } catch {
      }
    }, 3e3);
    proc.once("close", () => {
      clearTimeout(forceKillTimer);
      const fileName = path.basename(recordingPath);
      resolve(`nuvideo://load/${fileName}`);
    });
    try {
      proc.stdin.write("q\n");
      proc.stdin.end();
    } catch (e) {
      proc.kill("SIGKILL");
    }
  });
});
let exportProcess = null;
let totalReceivedBytes = 0;
ipcMain.handle("export-session-start", async (_event, { targetPath, fps }) => {
  var _a;
  if (exportProcess) {
    console.warn("[Main] Warning: lingering export session found. Forcing termination.");
    try {
      (_a = exportProcess.stdin) == null ? void 0 : _a.end();
      exportProcess.kill("SIGKILL");
    } catch (e) {
    }
    exportProcess = null;
  }
  totalReceivedBytes = 0;
  console.log(`[Main] Starting WebCodecs remux session: target: ${targetPath}`);
  const args = [
    "-y",
    "-f",
    "h264",
    // 声明输入流格式为 H.264
    "-r",
    fps.toString(),
    // 设置帧率
    "-i",
    "pipe:0",
    // 从管道读取
    "-c:v",
    "copy",
    // 关键：直接拷贝编码流，无需重新编码，速度极快
    "-movflags",
    "+faststart",
    targetPath
  ];
  const { spawn } = await import("node:child_process");
  exportProcess = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
  exportProcess.stderr.on("data", (data) => {
    const log = data.toString().trim();
    if (log.includes("frame=")) {
      process.stdout.write(`\r[FFmpeg Remux] ${log}`);
    } else {
      console.log("[FFmpeg Remux]", log);
    }
  });
  exportProcess.on("exit", (code) => {
    console.log(`
[Main] FFmpeg process exited with code ${code}. Received ${totalReceivedBytes} bytes.`);
    exportProcess = null;
  });
  return { success: true };
});
ipcMain.on("export-session-feed", (event, arrayBuffer) => {
  if (!exportProcess || !exportProcess.stdin) return;
  const buffer = Buffer.from(arrayBuffer);
  totalReceivedBytes += buffer.length;
  exportProcess.stdin.write(buffer);
});
ipcMain.handle("export-session-finish", async () => {
  if (!exportProcess) return { success: true };
  return new Promise((resolve) => {
    exportProcess.once("close", (code) => {
      resolve({ success: code === 0 });
    });
    exportProcess.stdin.end();
  });
});
app.on("will-quit", () => {
  if (ffmpegProcess) {
    ffmpegProcess.kill("SIGKILL");
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
app.whenReady().then(() => {
  protocol.registerFileProtocol("nuvideo", (request, callback) => {
    const url = request.url.replace("nuvideo://load/", "");
    try {
      const filePath = path.join(app.getPath("temp"), url);
      callback({ path: filePath });
    } catch (error) {
      console.error("Failed to register protocol", error);
    }
  });
  createWindow();
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
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
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
