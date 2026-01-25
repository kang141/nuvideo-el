import { protocol as M, ipcMain as a, desktopCapturer as $, app as m, dialog as C, screen as _, shell as W, BrowserWindow as D } from "electron";
import { fileURLToPath as j } from "node:url";
import i from "node:path";
import h from "node:fs";
import { performance as E } from "node:perf_hooks";
const z = i.dirname(j(import.meta.url));
process.env.APP_ROOT = i.join(z, "..");
const P = process.env.VITE_DEV_SERVER_URL, N = i.join(process.env.APP_ROOT, "dist-electron"), R = i.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = P ? i.join(process.env.APP_ROOT, "public") : R;
let r;
M.registerSchemesAsPrivileged([
  { scheme: "nuvideo", privileges: { bypassCSP: !0, stream: !0, secure: !0, standard: !0, supportFetchAPI: !0 } },
  { scheme: "asset", privileges: { bypassCSP: !0, secure: !0, standard: !0, supportFetchAPI: !0 } }
]);
function T() {
  r = new D({
    width: 350,
    height: 500,
    resizable: !1,
    frame: !1,
    transparent: !0,
    backgroundColor: "#00000000",
    show: !1,
    // 使用 PNG 格式以确保 Windows 任务栏兼容性与图标刷新
    icon: i.join(process.env.VITE_PUBLIC, "logo.png"),
    webPreferences: {
      preload: i.join(z, "preload.mjs"),
      webSecurity: !0
    }
  }), r.center(), r.once("ready-to-show", () => {
    r == null || r.show();
  }), r.webContents.on("did-finish-load", () => {
    r == null || r.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), P ? r.loadURL(P) : r.loadFile(i.join(R, "index.html"));
}
a.on("resize-window", (o, { width: t, height: e, resizable: s, position: n, mode: c }) => {
  if (r) {
    if (c === "recording") {
      const d = _.getPrimaryDisplay(), { width: g, height: w } = d.bounds;
      r.setResizable(!0), r.setBounds({ x: 0, y: 0, width: g, height: w }), r.setAlwaysOnTop(!0, "screen-saver"), r.setIgnoreMouseEvents(!0, { forward: !0 });
      return;
    }
    if (r.setResizable(!0), r.setSize(t, e), r.setResizable(s ?? !0), n === "bottom") {
      const d = _.getPrimaryDisplay(), { width: g, height: w } = d.workAreaSize, v = Math.floor((g - t) / 2), b = Math.floor(w - e - 40);
      r.setPosition(v, b), r.setAlwaysOnTop(!0, "screen-saver");
    } else
      r.center(), r.setAlwaysOnTop(!1), r.setIgnoreMouseEvents(!1);
  }
});
a.on("set-ignore-mouse-events", (o, t, e) => {
  r && r.setIgnoreMouseEvents(t, e);
});
a.handle("get-sources", async () => {
  try {
    return (await $.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: !0
    })).filter((e) => e.name !== "").map((e) => ({
      id: e.id,
      name: e.name,
      thumbnail: e.thumbnail.toDataURL(),
      display_id: e.display_id || ""
    }));
  } catch (o) {
    return console.error("[Main] get-sources failed:", o), [];
  }
});
a.handle("save-temp-video", async (o, t) => {
  try {
    const e = m.getPath("temp"), s = `nuvideo_${Date.now()}.mp4`, n = i.join(e, s), c = Buffer.from(t);
    h.writeFileSync(n, c);
    const d = `nuvideo://load/${s}`;
    return console.log("[Main] Video saved to physical path:", n), console.log("[Main] Custom URL for renderer:", d), d;
  } catch (e) {
    return console.error("[Main] save-temp-video failed:", e), null;
  }
});
a.handle("show-save-dialog", async (o, t = {}) => {
  let e = "";
  return t.defaultPath ? t.defaultName && !t.defaultPath.toLowerCase().endsWith(".mp4") && !t.defaultPath.toLowerCase().endsWith(".gif") ? e = i.join(t.defaultPath, t.defaultName) : e = t.defaultPath : e = i.join(m.getPath("videos"), t.defaultName || `nuvideo_export_${Date.now()}.mp4`), await C.showSaveDialog({
    title: "导出视频",
    defaultPath: e,
    filters: [
      { name: "Media Files", extensions: ["mp4", "gif", "webm"] }
    ],
    properties: ["showOverwriteConfirmation"]
  });
});
a.handle("sync-clock", async (o, t) => ({ tClient: t, tServer: E.now() }));
let u = null, F = "", p = null, y = 0;
a.handle("start-sidecar-record", async (o, t) => {
  if (u) return { success: !1, error: "Recording already in progress" };
  const e = _.getAllDisplays();
  let s = _.getPrimaryDisplay();
  if (t.startsWith("screen:")) {
    const f = t.split(":")[1], l = e.find((I) => I.id.toString() === f);
    l && (s = l);
  }
  const { bounds: n, scaleFactor: c } = s, d = (f) => {
    const l = Math.round(f);
    return l % 2 === 0 ? l : l - 1;
  }, g = Math.round(n.x * c), w = Math.round(n.y * c), v = d(n.width * c), b = d(n.height * c), S = m.getPath("temp");
  F = i.join(S, `nuvideo_raw_${Date.now()}.mkv`);
  const k = [
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
    g.toString(),
    "-offset_y",
    w.toString(),
    "-video_size",
    `${v}x${b}`,
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
    F,
    "-y"
  ], { spawn: L } = await import("node:child_process");
  return u = L("ffmpeg", k, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: !1
  }), u.once("exit", (f) => {
    f !== 0 && f !== null && (console.error(`[Main] FFmpeg crashed prematurely with code ${f}`), u = null, p && clearInterval(p), y = 0);
  }), u.stderr.on("data", (f) => {
    const l = f.toString();
    l.includes("frame=") ? process.stdout.write(`\r[FFmpeg Record] ${l.trim()}`) : console.log("[FFmpeg Log]", l.trim());
  }), p && clearInterval(p), new Promise((f) => {
    u.once("spawn", () => {
      y = E.now(), p = setInterval(() => {
        if (!r || !y) return;
        const l = _.getCursorScreenPoint(), I = E.now() - y;
        r.webContents.send("mouse-update", {
          x: (l.x - n.x) / n.width,
          y: (l.y - n.y) / n.height,
          t: I
        });
      }, 16), f({ success: !0, bounds: n, t0: y });
    }), u.once("error", (l) => {
      p && clearInterval(p), u = null, y = 0, f({ success: !1, error: l.message });
    });
  });
});
a.handle("stop-sidecar-record", async () => {
  if (p && (clearInterval(p), p = null), y = 0, !u) return null;
  const o = u;
  return u = null, new Promise((t) => {
    const e = setTimeout(() => {
      console.warn("[Main] FFmpeg flush timeout, forcing kill...");
      try {
        o.kill("SIGKILL");
      } catch {
      }
    }, 3e3);
    o.once("close", () => {
      clearTimeout(e);
      const s = i.basename(F);
      t(`nuvideo://load/${s}`);
    });
    try {
      o.stdin.write(`q
`), o.stdin.end();
    } catch {
      o.kill("SIGKILL");
    }
  });
});
a.handle("save-exported-video", async (o, { arrayBuffer: t, targetPath: e }) => {
  try {
    const s = Buffer.from(t);
    if (!s.length)
      throw new Error("Export failed: empty export buffer (no frames recorded).");
    return h.writeFileSync(e, s), console.log("[Main] Export successful:", e), { success: !0 };
  } catch (s) {
    return console.error("[Main] save-exported-video failed:", s), { success: !1, error: s.message };
  }
});
const x = /* @__PURE__ */ new Map();
a.handle("open-export-stream", async (o, { targetPath: t }) => {
  try {
    const e = h.openSync(t, "w"), s = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return x.set(s, { fd: e, path: t, bytesWritten: 0 }), console.log("[Main] Export stream opened:", t), { success: !0, streamId: s };
  } catch (e) {
    return console.error("[Main] open-export-stream failed:", e), { success: !1, error: e.message };
  }
});
a.handle("write-export-chunk", async (o, { streamId: t, chunk: e }) => {
  try {
    const s = x.get(t);
    if (!s)
      throw new Error(`Stream ${t} not found`);
    const n = Buffer.from(e);
    return h.writeSync(s.fd, n), s.bytesWritten += n.length, { success: !0, bytesWritten: s.bytesWritten };
  } catch (s) {
    return console.error("[Main] write-export-chunk failed:", s), { success: !1, error: s.message };
  }
});
a.handle("close-export-stream", async (o, { streamId: t }) => {
  try {
    const e = x.get(t);
    if (!e)
      throw new Error(`Stream ${t} not found`);
    return h.closeSync(e.fd), x.delete(t), console.log(`[Main] Export stream closed: ${e.path} (${e.bytesWritten} bytes)`), { success: !0, totalBytes: e.bytesWritten };
  } catch (e) {
    return console.error("[Main] close-export-stream failed:", e), { success: !1, error: e.message };
  }
});
a.handle("show-item-in-folder", async (o, t) => {
  t && W.showItemInFolder(t);
});
a.handle("delete-file", async (o, t) => {
  try {
    return h.existsSync(t) ? (h.unlinkSync(t), { success: !0 }) : { success: !1, error: "File not found" };
  } catch (e) {
    return { success: !1, error: e.message };
  }
});
a.handle("convert-mp4-to-gif", async (o, { inputPath: t, outputPath: e, width: s, fps: n = 30 }) => {
  try {
    const { spawn: c } = await import("node:child_process"), d = `fps=${n},scale=${s}:-1:flags=lanczos:sws_dither=none,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`, g = [
      "-i",
      t,
      "-vf",
      d,
      "-y",
      e
    ];
    return console.log("[Main] Generating optimized GIF with filter:", d), await new Promise((w, v) => {
      c("ffmpeg", g).on("close", (S) => S === 0 ? w(null) : v(new Error(`GIF generation failed with code ${S}`)));
    }), h.existsSync(t) && h.unlinkSync(t), { success: !0 };
  } catch (c) {
    return console.error("[Main] convert-mp4-to-gif failed:", c), { success: !1, error: c.message };
  }
});
m.on("will-quit", () => {
  u && u.kill("SIGKILL");
});
m.on("window-all-closed", () => {
  process.platform !== "darwin" && (m.quit(), r = null);
});
m.on("activate", () => {
  D.getAllWindows().length === 0 && T();
});
m.whenReady().then(() => {
  M.registerFileProtocol("nuvideo", (o, t) => {
    const e = o.url.replace("nuvideo://load/", "");
    try {
      const s = i.join(m.getPath("temp"), e);
      t({ path: s });
    } catch (s) {
      console.error("Failed to register protocol", s);
    }
  }), M.registerFileProtocol("asset", (o, t) => {
    let e = o.url.replace("asset://", "");
    e.startsWith("/") && (e = e.substring(1));
    let s = "";
    P ? s = i.join(process.env.VITE_PUBLIC, e) : s = i.join(R, e), t({ path: i.normalize(s) });
  }), T();
});
a.on("window-control", (o, t, e) => {
  if (r)
    switch (t) {
      case "set-content-protection":
        r.setContentProtection(!!e);
        break;
      case "minimize":
        r.minimize();
        break;
      case "toggle-maximize":
        r.isMaximized() ? r.unmaximize() : r.maximize();
        break;
      case "toggle-fullscreen":
        r.setFullScreen(!r.isFullScreen());
        break;
      case "close":
        r.close();
        break;
    }
});
export {
  N as MAIN_DIST,
  R as RENDERER_DIST,
  P as VITE_DEV_SERVER_URL
};
