var R = Object.defineProperty;
var z = (n, e, s) => e in n ? R(n, e, { enumerable: !0, configurable: !0, writable: !0, value: s }) : n[e] = s;
var g = (n, e, s) => z(n, typeof e != "symbol" ? e + "" : e, s);
import { ipcMain as h, app as y, protocol as F, desktopCapturer as A, dialog as N, screen as M, shell as H, BrowserWindow as j, globalShortcut as T } from "electron";
import { fileURLToPath as U } from "node:url";
import l from "node:path";
import m from "node:fs";
import { performance as P } from "node:perf_hooks";
import q from "node:crypto";
import b from "path";
import I from "fs";
h.handle("save-session-audio-segments", async (n, { sessionId: e, micBuffer: s, sysBuffer: t }) => {
  try {
    const r = b.join(y.getPath("temp"), "nuvideo_sessions", e);
    if (!I.existsSync(r))
      throw new Error("Session directory does not exist");
    const a = { success: !0 };
    if (s) {
      const i = b.join(r, "audio_mic.webm");
      I.writeFileSync(i, Buffer.from(s)), a.micPath = i;
    }
    if (t) {
      const i = b.join(r, "audio_sys.webm");
      I.writeFileSync(i, Buffer.from(t)), a.sysPath = i;
    }
    return console.log(`[Main] Saved audio segments for ${e}:`, a), a;
  } catch (r) {
    return console.error("[Main] Failed to save session audio segments:", r), { success: !1, error: r.message };
  }
});
h.handle("save-session-webcam", async (n, { sessionId: e, arrayBuffer: s }) => {
  try {
    const t = b.join(y.getPath("temp"), "nuvideo_sessions", e);
    if (!I.existsSync(t))
      throw new Error("Session directory does not exist");
    const r = b.join(t, "webcam.webm");
    return I.writeFileSync(r, Buffer.from(s)), console.log(`[Main] Webcam video saved for session ${e}: ${r}`), { success: !0, path: r };
  } catch (t) {
    return console.error("[Main] Failed to save session webcam:", t), { success: !1, error: t.message };
  }
});
const k = l.dirname(U(import.meta.url));
process.env.APP_ROOT = l.join(k, "..");
const x = process.env.VITE_DEV_SERVER_URL, re = l.join(process.env.APP_ROOT, "dist-electron"), E = l.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = x ? l.join(process.env.APP_ROOT, "public") : E;
const G = () => {
  const n = !!x, e = process.platform === "win32" ? "win32" : process.platform, s = process.platform === "win32" ? ".exe" : "";
  if (n) {
    const t = l.join(process.env.APP_ROOT, "resources", "bin", e, `ffmpeg${s}`);
    return m.existsSync(t) ? t : "ffmpeg";
  }
  return l.join(process.resourcesPath, "bin", `ffmpeg${s}`);
}, $ = G();
let o;
F.registerSchemesAsPrivileged([
  { scheme: "nuvideo", privileges: { bypassCSP: !0, stream: !0, secure: !0, standard: !0, supportFetchAPI: !0 } },
  { scheme: "asset", privileges: { bypassCSP: !0, secure: !0, standard: !0, supportFetchAPI: !0 } }
]);
function L() {
  o = new j({
    width: 720,
    height: 480,
    minWidth: 720,
    minHeight: 480,
    maxWidth: 720,
    maxHeight: 480,
    resizable: !1,
    frame: !1,
    transparent: !0,
    backgroundColor: "#00000000",
    hasShadow: !0,
    show: !1,
    // 使用 PNG 格式以确保 Windows 任务栏兼容性与图标刷新
    icon: l.join(process.env.VITE_PUBLIC, "logo.png"),
    webPreferences: {
      preload: l.join(k, "preload.mjs"),
      webSecurity: !0,
      backgroundThrottling: !1
      // 关键：防止后台导出时由于节能导致的解码/渲染暂停
    }
  }), o.center(), o.once("ready-to-show", () => {
    o == null || o.show();
  }), o.webContents.on("did-finish-load", () => {
    o == null || o.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), x ? o.loadURL(x) : o.loadFile(l.join(E, "index.html"));
}
h.on("resize-window", (n, { width: e, height: s, resizable: t, position: r, mode: a }) => {
  if (o) {
    if (a === "recording") {
      o.setResizable(!0), o.setSize(e, s), o.setResizable(!1);
      const i = M.getPrimaryDisplay(), { width: u, height: c } = i.workAreaSize, f = Math.floor((u - e) / 2), p = Math.floor(c - s - 40);
      o.setPosition(f, p), o.setAlwaysOnTop(!0, "screen-saver"), o.setIgnoreMouseEvents(!1);
      return;
    }
    if (o.setResizable(!0), o.setSize(e, s), o.setResizable(t ?? !0), r === "bottom") {
      const i = M.getPrimaryDisplay(), { width: u, height: c } = i.workAreaSize, f = Math.floor((u - e) / 2), p = Math.floor(c - s - 40);
      o.setPosition(f, p), o.setAlwaysOnTop(!0, "screen-saver");
    } else
      o.center(), o.setAlwaysOnTop(!1), o.setIgnoreMouseEvents(!1);
  }
});
h.on("set-ignore-mouse-events", (n, e, s) => {
  o && o.setIgnoreMouseEvents(e, s);
});
h.handle("get-sources", async () => {
  try {
    return (await A.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 400, height: 225 },
      // 略微提升分辨率以匹配 UI 宽度 (清晰度+)
      fetchWindowIcons: !1
      // 首页暂不需要图标，减少开销
    })).map((e) => ({
      id: e.id,
      name: e.name,
      // 使用 85% 质量的 JPEG，平衡清晰度与性能
      thumbnail: `data:image/jpeg;base64,${e.thumbnail.toJPEG(85).toString("base64")}`
    }));
  } catch (n) {
    return console.error("Failed to get sources:", n), [];
  }
});
h.handle("save-temp-video", async (n, e) => {
  try {
    const s = y.getPath("temp"), t = `nuvideo_${Date.now()}.mp4`, r = l.join(s, t), a = Buffer.from(e);
    m.writeFileSync(r, a);
    const i = `nuvideo://load/${t}`;
    return console.log("[Main] Video saved to physical path:", r), console.log("[Main] Custom URL for renderer:", i), i;
  } catch (s) {
    return console.error("[Main] save-temp-video failed:", s), null;
  }
});
h.handle("show-save-dialog", async (n, e = {}) => {
  let s = "";
  return e.defaultPath ? e.defaultName && !e.defaultPath.toLowerCase().endsWith(".mp4") && !e.defaultPath.toLowerCase().endsWith(".gif") ? s = l.join(e.defaultPath, e.defaultName) : s = e.defaultPath : s = l.join(y.getPath("videos"), e.defaultName || `nuvideo_export_${Date.now()}.mp4`), await N.showSaveDialog({
    title: "导出视频",
    defaultPath: s,
    filters: [
      { name: "Media Files", extensions: ["mp4", "gif", "webm"] }
    ],
    properties: ["showOverwriteConfirmation"]
  });
});
h.handle("sync-clock", async (n, e) => ({ tClient: e, tServer: P.now() }));
class B {
  constructor(e, s, t) {
    g(this, "sessionId");
    g(this, "sessionDir");
    g(this, "manifestPath");
    g(this, "mouseLogPath");
    g(this, "videoPath");
    g(this, "manifest");
    g(this, "bounds");
    g(this, "mouseLogStream", null);
    g(this, "ffmpegProcess", null);
    g(this, "mouseMonitorProcess", null);
    g(this, "mousePollTimer", null);
    g(this, "startTime", 0);
    g(this, "readyOffset", 0);
    // 关键：从 FFmpeg 启动到产生第一帧的毫秒数
    g(this, "isStopping", !1);
    this.sessionId = q.randomUUID(), this.bounds = s, this.sessionDir = l.join(y.getPath("temp"), "nuvideo_sessions", this.sessionId), m.mkdirSync(this.sessionDir, { recursive: !0 }), m.mkdirSync(l.join(this.sessionDir, "events"), { recursive: !0 }), this.manifestPath = l.join(this.sessionDir, "manifest.json"), this.mouseLogPath = l.join(this.sessionDir, "events", "mouse.jsonl"), this.videoPath = l.join(this.sessionDir, "video_raw.mp4"), this.manifest = {
      version: "1.0",
      sessionId: this.sessionId,
      createdAt: Date.now(),
      status: "recording",
      source: {
        id: e,
        width: s.width,
        height: s.height,
        scaleFactor: t
      },
      tracks: {
        video: { path: "video_raw.mp4", fps: 30 },
        mouse: { path: "events/mouse.jsonl" }
      }
    }, this.writeManifest(), this.mouseLogStream = m.createWriteStream(this.mouseLogPath, { flags: "a" });
  }
  writeManifest() {
    m.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }
  logMouseEvent(e) {
    if (this.mouseLogStream) {
      const s = JSON.stringify({ ...e, ts: P.now() - this.startTime });
      this.mouseLogStream.write(s + `
`);
    }
  }
  async start(e, s, t) {
    const { spawn: r } = await import("node:child_process");
    return console.log(`[Session] Starting FFmpeg: ${e} ${s.join(" ")}`), this.ffmpegProcess = r(e, s, { stdio: ["pipe", "pipe", "pipe"], shell: !1 }), this.ffmpegProcess.stdin && this.ffmpegProcess.stdin.on("error", (a) => {
      console.error("[Session] FFmpeg stdin error:", a);
    }), new Promise((a) => {
      let i = !1;
      this.ffmpegProcess.stderr.on("data", (u) => {
        const c = u.toString().trim();
        process.stderr.write(`[FFmpeg Err] ${c}
`), c.includes("frame=") ? i || (i = !0, this.readyOffset = P.now() - this.startTime, a({ success: !0, readyOffset: this.readyOffset })) : (c.toLowerCase().includes("failed") || c.toLowerCase().includes("error")) && (i || (i = !0, a({ success: !1, error: c })));
      }), this.ffmpegProcess.once("spawn", () => {
        this.startTime = P.now(), console.log(`[Session] Recording process spawned: ${this.sessionId}`), m.existsSync(t) && process.platform === "win32" && (this.mouseMonitorProcess = r("powershell.exe", [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          t
        ], { stdio: ["ignore", "pipe", "ignore"], windowsHide: !0 }), this.mouseMonitorProcess.stdout.on("data", (u) => {
          u.toString().trim().split(/\r?\n/).forEach((f) => {
            const p = f.trim();
            if ((p === "DOWN" || p === "UP") && o) {
              const w = P.now() - this.startTime;
              this.logMouseEvent({ type: p.toLowerCase() }), o.webContents.send("mouse-click", { type: p.toLowerCase(), t: w });
            }
          });
        })), this.mousePollTimer = setInterval(() => {
          if (!o) return;
          const u = M.getCursorScreenPoint(), c = P.now() - this.startTime, f = (u.x - this.bounds.x) / this.bounds.width, p = (u.y - this.bounds.y) / this.bounds.height;
          this.logMouseEvent({ type: "move", x: f, y: p }), o.webContents.send("mouse-update", { x: f, y: p, t: c });
        }, 8), setTimeout(() => {
          i || (i = !0, a({ success: !1, error: "FFmpeg startup timeout (no frames detected)" }));
        }, 3e3);
      }), this.ffmpegProcess.on("exit", (u) => {
        console.error(`[Session] FFmpeg process exited with code ${u}`), i || (i = !0, a({ success: !1, error: `FFmpeg exited with code ${u}` })), u !== 0 && !this.isStopping && (this.manifest.status = "error", this.writeManifest());
      }), this.ffmpegProcess.once("error", (u) => {
        console.error("[Session] FFmpeg failed to start:", u), i || (i = !0, a({ success: !1, error: u.message }));
      });
    });
  }
  /**
   * 仅清理进程，不销毁 Session 环境
   * 用于在 start 循环中尝试不同编码器
   */
  async cleanupProcess() {
    if (this.mousePollTimer && (clearInterval(this.mousePollTimer), this.mousePollTimer = null), this.mouseMonitorProcess && (this.mouseMonitorProcess.kill(), this.mouseMonitorProcess = null), this.ffmpegProcess) {
      const e = this.ffmpegProcess;
      return this.ffmpegProcess = null, new Promise((s) => {
        const t = setTimeout(() => e.kill("SIGKILL"), 1e3);
        if (e.once("close", () => {
          clearTimeout(t), s();
        }), e.stdin && e.stdin.writable)
          try {
            e.stdin.write(`q
`), e.stdin.end();
          } catch {
          }
        else
          e.kill("SIGKILL");
      });
    }
  }
  async stop() {
    return this.isStopping ? "" : (this.isStopping = !0, this.mousePollTimer && (clearInterval(this.mousePollTimer), this.mousePollTimer = null), this.mouseMonitorProcess && (this.mouseMonitorProcess.kill(), this.mouseMonitorProcess = null), new Promise((e) => {
      const s = this.ffmpegProcess;
      if (!s) return e("");
      const t = setTimeout(() => {
        try {
          s.kill("SIGKILL");
        } catch {
        }
      }, 3e3);
      s.once("close", () => {
        clearTimeout(t), this.mouseLogStream && (this.mouseLogStream.close(), this.mouseLogStream = null), this.manifest.status = "finished", this.writeManifest(), console.log(`[Session] Recording finished: ${this.sessionId}`), e(`nuvideo://session/${this.sessionId}`);
      });
      try {
        s.stdin && s.stdin.writable ? (s.stdin.write(`q
`), s.stdin.end()) : s.kill("SIGKILL");
      } catch (r) {
        console.error("[Session] Error stopping recording gracefully:", r), s.kill("SIGKILL");
      }
    }));
  }
  getFilePath(e) {
    return l.join(this.sessionDir, e);
  }
}
let d = null;
const W = /* @__PURE__ */ new Map();
function V(n, e, s = "nvenc") {
  const t = [
    "-loglevel",
    "info",
    "-thread_queue_size",
    "16384",
    "-init_hw_device",
    "d3d11va"
    // 显式初始化硬件设备以供后续滤镜使用
  ];
  switch (t.push(...n), s) {
    case "nvenc":
      t.push(
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-rc",
        "vbr",
        "-cq",
        "19",
        "-b:v",
        "0",
        "-maxrate",
        "100M",
        "-bufsize",
        "200M",
        "-profile:v",
        "high",
        "-level",
        "5.1",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-g",
        "120"
      );
      break;
    case "amf":
      t.push(
        "-c:v",
        "h264_amf",
        "-quality",
        "quality",
        "-rc",
        "vbr_latency",
        "-qp_i",
        "18",
        "-qp_p",
        "20",
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
        "yuv420p",
        "-movflags",
        "faststart+frag_keyframe+empty_moov",
        "-g",
        "120"
      );
      break;
    case "qsv":
      t.push(
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
      t.push(
        "-vf",
        "hwdownload,format=bgra,format=yuv420p",
        // 下载显存到内存并转换
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-crf",
        "20",
        "-profile:v",
        "high",
        "-level",
        "5.1",
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
  return t.push(e, "-y"), t;
}
h.handle("start-sidecar-record", async (n, e) => {
  if (d) return { success: !1, error: "Recording already in progress" };
  const s = M.getAllDisplays();
  let t = M.getPrimaryDisplay();
  if (e && e.startsWith("screen:")) {
    const v = e.split(":")[1], _ = s.find((C) => C.id.toString() === v);
    _ && (t = _);
  }
  const { bounds: r, scaleFactor: a } = t;
  let i = 0;
  if (e && e.startsWith("screen:")) {
    const v = e.split(":")[1];
    i = s.findIndex((_) => _.id.toString() === v), i === -1 && (i = 0);
  }
  d = new B(e, r, a);
  const u = d.videoPath, f = [
    "-f",
    "lavfi",
    "-i",
    `ddagrab=output_idx=${i}:draw_mouse=0:framerate=60:dup_frames=0`
  ], p = l.join(process.env.APP_ROOT || "", "resources", "scripts", "mouse-monitor.ps1"), w = m.existsSync(p) ? p : l.join(process.resourcesPath, "scripts", "mouse-monitor.ps1");
  console.log("[Main] Starting Ultra-High-Performance ddagrab capture (Re-entrant cycle)...");
  const O = ["nvenc", "amf", "qsv", "software"];
  let S = null;
  for (const v of O) {
    const _ = V(f, u, v);
    if (console.log(`[Main] Attempting [${v}] for session [${d.sessionId}]`), S = await d.start($, _, w), S.success) {
      console.log(`[Main] ✅ Recording started successfully via [${v}]`);
      break;
    } else
      console.warn(`[Main] ❌ [${v}] failed: ${S.error}. Trying next fallback...`), await d.cleanupProcess();
  }
  return S.success ? (W.set(d.sessionId, d), {
    success: !0,
    sessionId: d.sessionId,
    bounds: r,
    t0: P.now(),
    readyOffset: S.readyOffset || 0
  }) : (d && (W.delete(d.sessionId), d = null), S);
});
h.handle("stop-sidecar-record", async () => {
  if (console.log("[Main] IPC: stop-sidecar-record called. currentSession exists:", !!d), !d)
    return console.warn("[Main] Warning: stop-sidecar-record called but currentSession is null. This may be due to a process restart or FFmpeg crash."), null;
  const n = await d.stop(), e = d.sessionId;
  return d = null, { success: !0, recordingPath: n, sessionId: e };
});
h.handle("save-exported-video", async (n, { arrayBuffer: e, targetPath: s }) => {
  try {
    const t = Buffer.from(e);
    if (!t.length)
      throw new Error("Export failed: empty export buffer (no frames recorded).");
    return m.writeFileSync(s, t), console.log("[Main] Export successful:", s), { success: !0 };
  } catch (t) {
    return console.error("[Main] save-exported-video failed:", t), { success: !1, error: t.message };
  }
});
const D = /* @__PURE__ */ new Map();
h.handle("open-export-stream", async (n, { targetPath: e }) => {
  try {
    const s = m.openSync(e, "w"), t = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return D.set(t, { fd: s, path: e, bytesWritten: 0 }), console.log("[Main] Export stream opened:", e), { success: !0, streamId: t };
  } catch (s) {
    return console.error("[Main] open-export-stream failed:", s), { success: !1, error: s.message };
  }
});
h.handle("write-export-chunk", async (n, { streamId: e, chunk: s, position: t }) => {
  try {
    const r = D.get(e);
    if (!r)
      throw new Error(`Stream ${e} not found`);
    const a = Buffer.from(s);
    return typeof t == "number" ? m.writeSync(r.fd, a, 0, a.length, t) : (m.writeSync(r.fd, a, 0, a.length, null), r.bytesWritten += a.length), { success: !0, bytesWritten: r.bytesWritten };
  } catch (r) {
    return console.error("[Main] write-export-chunk failed:", r), { success: !1, error: r.message };
  }
});
h.handle("close-export-stream", async (n, { streamId: e }) => {
  try {
    const s = D.get(e);
    if (!s)
      throw new Error(`Stream ${e} not found`);
    return m.closeSync(s.fd), D.delete(e), console.log(`[Main] Export stream closed: ${s.path} (${s.bytesWritten} bytes)`), { success: !0, totalBytes: s.bytesWritten };
  } catch (s) {
    return console.error("[Main] close-export-stream failed:", s), { success: !1, error: s.message };
  }
});
h.handle("show-item-in-folder", async (n, e) => {
  e && H.showItemInFolder(e);
});
h.handle("delete-file", async (n, e) => {
  try {
    return m.existsSync(e) ? (m.unlinkSync(e), { success: !0 }) : { success: !1, error: "File not found" };
  } catch (s) {
    return { success: !1, error: s.message };
  }
});
h.handle("convert-mp4-to-gif", async (n, { inputPath: e, outputPath: s, width: t, fps: r = 30 }) => {
  try {
    const { spawn: a } = await import("node:child_process"), i = `fps=${r},scale=${t}:-1:flags=lanczos:sws_dither=none,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`, u = [
      "-i",
      e,
      "-vf",
      i,
      "-y",
      s
    ];
    return console.log("[Main] Generating optimized GIF with filter:", i), await new Promise((c, f) => {
      a($, u).on("close", (w) => w === 0 ? c(null) : f(new Error(`GIF generation failed with code ${w}`)));
    }), m.existsSync(e) && m.unlinkSync(e), { success: !0 };
  } catch (a) {
    return console.error("[Main] convert-mp4-to-gif failed:", a), { success: !1, error: a.message };
  }
});
y.on("will-quit", () => {
  d && d.stop();
});
y.on("window-all-closed", () => {
  process.platform !== "darwin" && (y.quit(), o = null);
});
y.on("activate", () => {
  j.getAllWindows().length === 0 && L();
});
class K {
  static async runSilentCleanup() {
    try {
      const e = l.join(y.getPath("temp"), "nuvideo_sessions");
      if (!m.existsSync(e)) return;
      const s = m.readdirSync(e);
      if (s.length === 0) return;
      const t = s.map((c) => {
        const f = l.join(e, c), p = m.statSync(f);
        return { folder: c, folderPath: f, mtime: p.mtimeMs };
      });
      t.sort((c, f) => f.mtime - c.mtime);
      const r = 3 * 24 * 60 * 60 * 1e3, a = 10, i = Date.now(), u = t.filter((c, f) => {
        const p = i - c.mtime > r, w = f >= a;
        return d && c.folder === d.sessionId ? !1 : p || w;
      });
      if (u.length > 0) {
        console.log(`[CleanUp] Found ${u.length} stale sessions to purge...`);
        for (const c of u)
          try {
            m.rmSync(c.folderPath, { recursive: !0, force: !0 });
          } catch (f) {
            console.warn(`[CleanUp] Failed to delete session ${c.folder}:`, f);
          }
        console.log("[CleanUp] Purge complete.");
      }
    } catch (e) {
      console.error("[CleanUp] Critical error during startup cleanup:", e);
    }
  }
}
y.whenReady().then(() => {
  K.runSilentCleanup(), F.registerFileProtocol("nuvideo", (n, e) => {
    const s = decodeURIComponent(n.url);
    if (s.startsWith("nuvideo://load/")) {
      const t = s.replace("nuvideo://load/", ""), r = l.basename(t), a = l.join(y.getPath("temp"), r);
      return e({ path: a });
    }
    if (s.startsWith("nuvideo://session/")) {
      const t = s.replace("nuvideo://session/", "").split("/"), r = t[0], a = t.slice(1).join("/") || "manifest.json", i = W.get(r);
      let u = i == null ? void 0 : i.sessionDir;
      if (!u) {
        const c = l.join(y.getPath("temp"), "nuvideo_sessions", r);
        m.existsSync(c) && (u = c);
      }
      if (u) {
        const c = l.normalize(a);
        if (c.includes(".."))
          return e({ error: -6 });
        const f = l.join(u, c);
        if (m.existsSync(f))
          return e({ path: f });
        console.warn("[Protocol Handler] File not found on disk:", f);
      }
    }
    e({ error: -6 });
  }), F.registerFileProtocol("asset", (n, e) => {
    let s = n.url.replace("asset://", "");
    s.startsWith("/") && (s = s.substring(1));
    let t = "";
    x ? t = l.join(process.env.VITE_PUBLIC, s) : t = l.join(E, s), e({ path: l.normalize(t) });
  }), T.register("F10", () => {
    o == null || o.webContents.send("hotkey-toggle-record");
  }), T.register("F9", () => {
    o == null || o.webContents.send("hotkey-pause-resume");
  }), L();
});
y.on("will-quit", () => {
  T.unregisterAll();
});
h.on("window-control", (n, e, s) => {
  if (o)
    switch (e) {
      case "set-content-protection":
        o.setContentProtection(!!s);
        break;
      case "minimize":
        o.minimize();
        break;
      case "toggle-maximize":
        o.isMaximized() ? o.unmaximize() : o.maximize();
        break;
      case "toggle-fullscreen":
        o.setFullScreen(!o.isFullScreen());
        break;
      case "close":
        o.close();
        break;
    }
});
export {
  re as MAIN_DIST,
  E as RENDERER_DIST,
  x as VITE_DEV_SERVER_URL
};
