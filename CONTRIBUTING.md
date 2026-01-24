# Contributing Guide

感谢你对 **nuvideo-el** 的兴趣与帮助！  
我是独立开发者，也是开源新手。欢迎你以任何方式参与：提 Issue、补文档、修 bug、提 PR。

---

## 提 Issue（Bug / 建议）

### Bug 报告请尽量包含：

- Windows 版本（10/11，系统版本号可选）
- 是否多显示器、是否开启缩放（如 125%/150%）
- 录制参数（分辨率、帧率）
- 导出参数（分辨率、帧率、编码格式）
- 复现步骤（尽量可重复）
- 日志/截图/短视频（可选但很有帮助）

### 功能建议请包含：

- 你想解决的具体问题（使用场景）
- 你期望的交互/效果（最好配示例）
- 是否愿意自己实现（可选）

---

## 开发环境

- Windows 10/11
- Node.js（建议 18+）
- FFmpeg（需要在系统 PATH 可用）

---

## 如何运行

```bash
git clone https://github.com/kang141/nuvideo-el.git
cd nuvideo-el
npm install
npm run dev
```
