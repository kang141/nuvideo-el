# AGENTS.md（项目工作说明）

# ！使用中文与我进行对话

## 录制/预览/导出相关入口（优先打开这些文件，不要全仓库搜索）

- 选择录屏源：electron/main.ts -> get-sources（desktopCapturer）
- 录制 Sidecar：electron/main.ts -> start-sidecar-record / stop-sidecar-record（FFmpeg gdigrab）
- 鼠标采集：electron/main.ts -> mouse-update；renderer -> mouse-tracker.ts（App.tsx 调 align）
- 预览渲染：useVideoRenderer.ts + camera-solver.ts
- 导出：useVideoExport.ts（WebCodecs + mp4-muxer）-> IPC save-exported-video -> electron/main.ts

## 搜索规则（禁止扫大目录/生成物）

- 不要搜索以下目录/文件：
  - node_modules/
  - dist/
  - dist-\*/
  - dist-electron/
  - out/
  - build/
  - coverage/
  - \*.map
  - package-lock.json / pnpm-lock.yaml / yarn.lock

## 工作策略

1. 录制/导出相关问题：先打开上面的入口文件定位实现。
2. 确实需要搜索时，只在 src/ 和 electron/ 里搜索。
3. 优先用“指定文件/目录”的方式回答，不要全仓库 rg。
