import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * 助手函数：将渲染进程录制的原生音频 Blob 保存到当前会话目录
 */
ipcMain.handle('save-session-audio', async (_event, { sessionId, arrayBuffer }) => {
  try {
    const sessionDir = path.join(app.getPath('temp'), 'nuvideo_sessions', sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw new Error('Session directory does not exist');
    }

    const audioPath = path.join(sessionDir, 'audio_native.webm');
    fs.writeFileSync(audioPath, Buffer.from(arrayBuffer));
    
    console.log(`[Main] Native audio saved for session ${sessionId}: ${audioPath}`);
    return { success: true, path: audioPath };
  } catch (err) {
    console.error('[Main] Failed to save session audio:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('save-session-webcam', async (_event, { sessionId, arrayBuffer }) => {
  try {
    const sessionDir = path.join(app.getPath('temp'), 'nuvideo_sessions', sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw new Error('Session directory does not exist');
    }

    const webcamPath = path.join(sessionDir, 'webcam.webm');
    fs.writeFileSync(webcamPath, Buffer.from(arrayBuffer));
    
    console.log(`[Main] Webcam video saved for session ${sessionId}: ${webcamPath}`);
    return { success: true, path: webcamPath };
  } catch (err) {
    console.error('[Main] Failed to save session webcam:', err);
    return { success: false, error: (err as Error).message };
  }
});
