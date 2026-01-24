# nuvideo-el

<p align="center">
  <img src="./public/logo.svg" width="120" alt="nuvideo-el logo">
</p>

<p align="center">
  <strong>ScreenStudio 的 Windows 开源平替</strong><br>
  下一代专业演示视频录制与后期处理工具
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-MVP-orange.svg" alt="Project Status">
  <img src="https://img.shields.io/badge/Platform-Windows-blue.svg" alt="Platform">
  <img src="https://img.shields.io/badge/License-AGPLv3--Commercial-blue.svg" alt="License">
</p>

---

## 📸 项目简介

**nuvideo-el** 是一个致力于为 Windows 用户提供类似 Mac 端 **ScreenStudio** 体验的开源项目。它不仅能捕获你的屏幕，还能通过内置的智能算法，让普通的录屏瞬间变成极具专业感的演示视频。

目前项目正处于 **MVP (最小可行性产品)** 阶段，核心录制与编辑链路已跑通。正在高频迭代中，旨在打造 Windows 平台上最优雅的演示录制方案。

## ✨ 核心特性

- 🧠 **智能自动缩放 (Smart Auto-Zoom)**：内置 Spring 物理引擎，自动识别光标活动区域并实时计算最佳视口，生成如丝般顺滑的缩放视角切换。
- 🖱️ **精密光标追踪**：在高帧率下捕获光标路径，并应用物理平滑算法，告别生硬的鼠标移动，支持点击波动特效。
- 🎞️ **专业级时间轴编辑器**：基于 Canvas 开发的高性能时间轴，支持精确到帧的剪辑预览。
- 🚀 **高性能导出引擎**：底层调用 WebCodecs API 结合 `mp4-muxer`，充分利用机硬件加速，实现极速渲染导出。
- 🎨 **现代 UI 设计**：基于 Radix UI 与 Tailwind CSS 打造的极简黑幕风格界面，提供原生般的交互触感。

## 🛠️ 技术栈

- **Frontend**: React 18 / TypeScript / Vite
- **Shell**: Electron (跨进程高性能通信)
- **Animation**: Framer Motion / Spring Physics
- **Audio/Video**: WebCodecs API / MP4 Muxing
- **Styling**: Tailwind CSS / Lucide Icons

## 🚀 快速开始

### 开发环境搭建

1. **克隆仓库**

   ```bash
   git clone https://github.com/your-username/nuvideo-el.git
   cd nuvideo-el
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

### 构建打包

```bash
npm run build
```

## 🗺️ 未来计划 (Roadmap)

- [ ] 导出性能进一步优化
- [ ] 增加更多光标视觉主题
- [ ] 支持摄像头画中画 (PIP) 录制
- [ ] 丰富的转场预设库

## 🤝 参与贡献

这是一个处于早期的项目，非常欢迎开发者提交 Issue 或 Pull Request 来帮助我们完善功能。如果你喜欢这个项目，请给我们一个 ⭐️！

## 📄 许可证 (License)

本项目采用 **双重许可 (Dual Licensing)** 模式：

1. **开源许可**：本项目在 [GNU Affero General Public License v3.0 (AGPLv3)](./LICENSE) 协议下开源。如果您在自己的项目中使用了本代码并提供网络服务，您必须按照协议要求开源您的衍生作品。
2. **商业许可**：如果您希望在闭源项目或不符合 AGPLv3 条款的场景下使用本项目，我们提供商业授权方案。商业授权可免除 AGPLv3 的开源义务。

> 关于商业授权详情，请通过 Issue 联络或发送邮件至kangdeng28@gmail.com。

---

_注意：本项目目前处于持续开发阶段，建议仅用于测试与学习。_
