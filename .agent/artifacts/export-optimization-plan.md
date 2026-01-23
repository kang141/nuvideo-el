# 视频导出性能优化实现计划

## 问题概述

当前导出流程存在多个性能瓶颈，导致导出速度远低于预期：

1. **逐帧 seek 硬伤** - 每帧都 `video.currentTime = t` + 等待 `seeked` 事件，强迫解码器频繁跳转关键帧
2. **相机求解 O(n²)** - `computeCameraState` 每次从 t=0 积分到当前时间，时长翻倍计算量 ×4
3. **固定 60fps** - 对 30fps 素材翻倍工作量
4. **每帧 setState** - React 60fps 连续状态更新拖慢主线程
5. **无编码背压** - 只管 encode 不看队列，容易爆内存
6. **大块内存写盘** - ArrayBuffer 全量 IPC + 同步 writeFileSync

---

## 实施计划

### Phase 1: camera-solver 增量化 (优先级最高)

**文件**: `src/core/camera-solver.ts`

**改动**:

- 新增 `CameraSolverCache` 类，缓存上一帧的 state 和 lastT
- 修改 `computeCameraState` 支持增量模式：从 lastT 积分到 currentT
- 导出前调用 `resetCameraCache()` 重置缓存

**收益**: 时间复杂度 O(n²) → O(n)，越长视频提升越明显

---

### Phase 2: 连续取帧替代逐帧 seek

**文件**: `src/hooks/editor/useVideoExport.ts`

**改动**:

- 使用 `requestVideoFrameCallback` 连续取帧（预览已在用）
- 视频以 `playbackRate = 1` 正常播放，回调中处理每一帧
- 移除逐帧 seek 逻辑

**收益**: 消除 seek 开销，解码器可保持连续解码流水线

---

### Phase 3: 编码器背压 + 进度节流

**文件**: `src/hooks/editor/useVideoExport.ts`

**改动**:

- 检查 `encoder.encodeQueueSize`，超阈值时 await flush
- `setExportProgress` 节流：每 100ms 更新一次

**收益**: 平稳内存、减少 GC 毛刺、减少 React 调度开销

---

### Phase 4: FPS 自适应 (可选)

**文件**: `src/hooks/editor/useVideoExport.ts`

**改动**:

- 检测源视频帧率，导出时匹配源帧率
- 支持 QualityConfig 中的 fps 配置

**收益**: 30fps 视频省一半帧

---

### Phase 5: 流式写盘 (可选)

**文件**: `electron/main.ts`, `src/hooks/editor/useVideoExport.ts`

**改动**:

- 使用 `FileSystemWritableFileStream` 或分块 IPC
- 主进程改用 `fs.createWriteStream` 异步写入

**收益**: 避免大内存峰值、主进程阻塞

---

## 实施顺序

1. ✅ Phase 1: camera-solver 增量化 — 完成
2. ✅ Phase 2: 连续取帧 — 完成 (requestVideoFrameCallback)
3. ✅ Phase 3: 背压 + 节流 — 完成 (队列>5时 flush, 100ms 节流)
4. ⏳ Phase 4: FPS 自适应 (按需)
5. ✅ Phase 5: 流式写盘 — 完成 (1MB 分块写入)

---

## 预期效果

| 指标               | 优化前            | 优化后    |
| ------------------ | ----------------- | --------- |
| 1 分钟视频导出耗时 | ~5 分钟           | ~30-60 秒 |
| 5 分钟视频导出耗时 | ~30+ 分钟         | ~3-5 分钟 |
| 内存峰值           | 高 (长视频爆内存) | 平稳      |
| CPU 利用率         | 波动大            | 平滑      |
