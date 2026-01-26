import { protocol as M, ipcMain as a, desktopCapturer as z, app as h, dialog as L, screen as _, shell as j, BrowserWindow as D } from "electron";
import { fileURLToPath as A } from "node:url";
import i from "node:path";
import m from "node:fs";
import { performance as E } from "node:perf_hooks";
const T = i.dirname(A(import.meta.url));
process.env.APP_ROOT = i.join(T, "..");
const P = process.env.VITE_DEV_SERVER_URL, N = i.join(process.env.APP_ROOT, "dist-electron"), R = i.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = P ? i.join(process.env.APP_ROOT, "public") : R;
const C = () => {
  const o = !!P, t = process.platform === "win32" ? "win32" : process.platform, e = process.platform === "win32" ? ".exe" : "";
  if (o) {
    const r = i.join(process.env.APP_ROOT, "resources", "bin", t, `ffmpeg${e}`);
    return m.existsSync(r) ? r : "ffmpeg";
  }
  return i.join(process.resourcesPath, "bin", `ffmpeg${e}`);
}, $ = C();
let s;
M.registerSchemesAsPrivileged([
  { scheme: "nuvideo", privileges: { bypassCSP: !0, stream: !0, secure: !0, standard: !0, supportFetchAPI: !0 } },
  { scheme: "asset", privileges: { bypassCSP: !0, secure: !0, standard: !0, supportFetchAPI: !0 } }
]);
function k() {
  s = new D({
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
      preload: i.join(T, "preload.mjs"),
      webSecurity: !0
    }
  }), s.center(), s.once("ready-to-show", () => {
    s == null || s.show();
  }), s.webContents.on("did-finish-load", () => {
    s == null || s.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), P ? s.loadURL(P) : s.loadFile(i.join(R, "index.html"));
}
a.on("resize-window", (o, { width: t, height: e, resizable: r, position: n, mode: c }) => {
  if (s) {
    if (c === "recording") {
      const d = _.getPrimaryDisplay(), { width: g, height: w } = d.bounds;
      s.setResizable(!0), s.setBounds({ x: 0, y: 0, width: g, height: w }), s.setAlwaysOnTop(!0, "screen-saver"), s.setIgnoreMouseEvents(!0, { forward: !0 });
      return;
    }
    if (s.setResizable(!0), s.setSize(t, e), s.setResizable(r ?? !0), n === "bottom") {
      const d = _.getPrimaryDisplay(), { width: g, height: w } = d.workAreaSize, v = Math.floor((g - t) / 2), b = Math.floor(w - e - 40);
      s.setPosition(v, b), s.setAlwaysOnTop(!0, "screen-saver");
    } else
      s.center(), s.setAlwaysOnTop(!1), s.setIgnoreMouseEvents(!1);
  }
});
a.on("set-ignore-mouse-events", (o, t, e) => {
  s && s.setIgnoreMouseEvents(t, e);
});
a.handle("get-sources", async () => {
  try {
    return (await z.getSources({
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
    const e = h.getPath("temp"), r = `nuvideo_${Date.now()}.mp4`, n = i.join(e, r), c = Buffer.from(t);
    m.writeFileSync(n, c);
    const d = `nuvideo://load/${r}`;
    return console.log("[Main] Video saved to physical path:", n), console.log("[Main] Custom URL for renderer:", d), d;
  } catch (e) {
    return console.error("[Main] save-temp-video failed:", e), null;
  }
});
a.handle("show-save-dialog", async (o, t = {}) => {
  let e = "";
  return t.defaultPath ? t.defaultName && !t.defaultPath.toLowerCase().endsWith(".mp4") && !t.defaultPath.toLowerCase().endsWith(".gif") ? e = i.join(t.defaultPath, t.defaultName) : e = t.defaultPath : e = i.join(h.getPath("videos"), t.defaultName || `nuvideo_export_${Date.now()}.mp4`), await L.showSaveDialog({
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
  let r = _.getPrimaryDisplay();
  if (t && t.startsWith("screen:")) {
    const f = t.split(":")[1], l = e.find((I) => I.id.toString() === f);
    l && (r = l);
  }
  const { bounds: n, scaleFactor: c } = r, d = (f) => {
    const l = Math.round(f);
    return l % 2 === 0 ? l : l - 1;
  }, g = d(n.width * c), w = d(n.height * c), v = h.getPath("temp");
  F = i.join(v, `nuvideo_raw_${Date.now()}.mkv`);
  const b = [
    "-loglevel",
    "info",
    "-thread_queue_size",
    "8192",
    // 极致缓冲区
    "-f",
    "gdigrab",
    "-framerate",
    "60",
    "-draw_mouse",
    "0",
    "-offset_x",
    Math.round(n.x * c).toString(),
    "-offset_y",
    Math.round(n.y * c).toString(),
    "-video_size",
    `${g}x${w}`,
    "-i",
    "desktop",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    "23",
    // 稍微降低一点码率以换取巨大的性能提升
    "-threads",
    "0",
    // 使用所有核心
    "-pix_fmt",
    "yuv420p",
    F,
    "-y"
  ], { spawn: S } = await import("node:child_process");
  return u = S($, b, {
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
        if (!s || !y) return;
        const l = _.getCursorScreenPoint(), I = E.now() - y;
        s.webContents.send("mouse-update", {
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
      const r = i.basename(F);
      t(`nuvideo://load/${r}`);
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
    const r = Buffer.from(t);
    if (!r.length)
      throw new Error("Export failed: empty export buffer (no frames recorded).");
    return m.writeFileSync(e, r), console.log("[Main] Export successful:", e), { success: !0 };
  } catch (r) {
    return console.error("[Main] save-exported-video failed:", r), { success: !1, error: r.message };
  }
});
const x = /* @__PURE__ */ new Map();
a.handle("open-export-stream", async (o, { targetPath: t }) => {
  try {
    const e = m.openSync(t, "w"), r = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return x.set(r, { fd: e, path: t, bytesWritten: 0 }), console.log("[Main] Export stream opened:", t), { success: !0, streamId: r };
  } catch (e) {
    return console.error("[Main] open-export-stream failed:", e), { success: !1, error: e.message };
  }
});
a.handle("write-export-chunk", async (o, { streamId: t, chunk: e }) => {
  try {
    const r = x.get(t);
    if (!r)
      throw new Error(`Stream ${t} not found`);
    const n = Buffer.from(e);
    return m.writeSync(r.fd, n), r.bytesWritten += n.length, { success: !0, bytesWritten: r.bytesWritten };
  } catch (r) {
    return console.error("[Main] write-export-chunk failed:", r), { success: !1, error: r.message };
  }
});
a.handle("close-export-stream", async (o, { streamId: t }) => {
  try {
    const e = x.get(t);
    if (!e)
      throw new Error(`Stream ${t} not found`);
    return m.closeSync(e.fd), x.delete(t), console.log(`[Main] Export stream closed: ${e.path} (${e.bytesWritten} bytes)`), { success: !0, totalBytes: e.bytesWritten };
  } catch (e) {
    return console.error("[Main] close-export-stream failed:", e), { success: !1, error: e.message };
  }
});
a.handle("show-item-in-folder", async (o, t) => {
  t && j.showItemInFolder(t);
});
a.handle("delete-file", async (o, t) => {
  try {
    return m.existsSync(t) ? (m.unlinkSync(t), { success: !0 }) : { success: !1, error: "File not found" };
  } catch (e) {
    return { success: !1, error: e.message };
  }
});
a.handle("convert-mp4-to-gif", async (o, { inputPath: t, outputPath: e, width: r, fps: n = 30 }) => {
  try {
    const { spawn: c } = await import("node:child_process"), d = `fps=${n},scale=${r}:-1:flags=lanczos:sws_dither=none,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle`, g = [
      "-i",
      t,
      "-vf",
      d,
      "-y",
      e
    ];
    return console.log("[Main] Generating optimized GIF with filter:", d), await new Promise((w, v) => {
      c($, g).on("close", (S) => S === 0 ? w(null) : v(new Error(`GIF generation failed with code ${S}`)));
    }), m.existsSync(t) && m.unlinkSync(t), { success: !0 };
  } catch (c) {
    return console.error("[Main] convert-mp4-to-gif failed:", c), { success: !1, error: c.message };
  }
});
h.on("will-quit", () => {
  u && u.kill("SIGKILL");
});
h.on("window-all-closed", () => {
  process.platform !== "darwin" && (h.quit(), s = null);
});
h.on("activate", () => {
  D.getAllWindows().length === 0 && k();
});
h.whenReady().then(() => {
  M.registerFileProtocol("nuvideo", (o, t) => {
    const e = o.url.replace("nuvideo://load/", "");
    try {
      const r = i.join(h.getPath("temp"), e);
      t({ path: r });
    } catch (r) {
      console.error("Failed to register protocol", r);
    }
  }), M.registerFileProtocol("asset", (o, t) => {
    let e = o.url.replace("asset://", "");
    e.startsWith("/") && (e = e.substring(1));
    let r = "";
    P ? r = i.join(process.env.VITE_PUBLIC, e) : r = i.join(R, e), t({ path: i.normalize(r) });
  }), k();
});
a.on("window-control", (o, t, e) => {
  if (s)
    switch (t) {
      case "set-content-protection":
        s.setContentProtection(!!e);
        break;
      case "minimize":
        s.minimize();
        break;
      case "toggle-maximize":
        s.isMaximized() ? s.unmaximize() : s.maximize();
        break;
      case "toggle-fullscreen":
        s.setFullScreen(!s.isFullScreen());
        break;
      case "close":
        s.close();
        break;
    }
});
export {
  N as MAIN_DIST,
  R as RENDERER_DIST,
  P as VITE_DEV_SERVER_URL
};
