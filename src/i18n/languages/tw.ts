export const tw = {
  common: {
    export: '匯出', // Export 常用「匯出」，Import 是「匯入」
    exporting: '匯出中...',
    back: '返回',
    delete: '刪除',
    settings: '設定', // 建議從「設置」改為「設定」
    language: '語言',
    none: '無',
    savedTo: '已儲存至', // 台灣習慣用「儲存」
  },
  home: {
    subtitle: '選擇素材來源',
    range: '錄製範圍',
    screen: '整個螢幕',
    window: '應用程式視窗',
    mode: '錄製模式',
    video: '高畫質影片', // 視訊 -> 影片
    gif: '高畫質 GIF',
    videoDesc: '無時長限制',
    gifDesc: '限制 15 秒內',
    quality: '畫質預設',
    globalOptions: '全域選項', // 全局 -> 全域
    autoZoom: '自動縮放',
    autoZoomDesc: '開啟後，錄製時將根據游標位置自動產生流暢的鏡頭追蹤。',
    gifExclusive: 'GIF 專屬模式',
    gifExclusiveDesc: '為確保動態圖片的輕量與相容性，GIF 錄製暫不支援開啟攝影機與錄音功能。',
    refresh: '重新整理來源', // 刷新 -> 重新整理
    scanning: '正在掃描資源...',
    foundSources: '發現 {count} 個來源',
    activeSource: '活動來源',
    noSource: '未發現可用來源',
    noSourceDesc: '請檢查系統設定並授予螢幕錄製權限。',
    engineReady: '原生擷取引擎已就緒', // 捕獲 -> 擷取
    allScreens: '所有顯示器',
    runningApps: '執行中的應用程式',
    starting: '啟動中...',
    startRecording: '開始錄製',
    initHardware: '正在初始化硬體裝置...',
    initEngine: '準備顯示卡擷取引擎...', // 顯卡 -> 顯示卡，采集 -> 擷取
    syncAudio: '同步音訊取樣流...', // 音頻 -> 音訊，采樣 -> 取樣
    configVideo: '配置影片編碼環境...',
  },
  editor: {
    appearance: '外觀',
    camera: '鏡頭',
    cursor: '游標', // 光標 -> 游標
    audio: '聲音',
    comments: '文字', // 文本 -> 文字
    canvas: '背景畫布',
    wallpaper: '選擇桌布', // 壁紙 -> 桌布
    cameraControl: '鏡頭控制',
    resetCamera: '重置鏡頭',
    fixZoom: '定焦 (2.5x)',
    cameraTip: '在畫面點擊或按 Z 鍵可自動對焦滑鼠', // 鼠標 -> 滑鼠
    cursorStyle: '游標樣式',
    arrowStyle: '箭頭樣式',
    pointerStyle: '手型樣式',
    macOSCursor: 'macOS 指標',
    circleCursor: '簡約圓形',
    cursorSize: '視覺大小', // 感官 -> 視覺（更直觀）
    clickEffect: '點擊特效',
    rippleEffect: '點擊漣漪效果',
    physics: '物理手感',
    preset: '預設',
    professional: '專業',
    snappy: '俐落', // Snappy 翻「俐落」或「靈敏」比「跟手」更像專業軟體術語
    balanced: '平衡',
    cinematic: '電影級',
    smoothing: '運動平滑度',
    speedLimit: '物理速度上限',
    engineInfo: 'NuVideo Pro Engine',
    zoomTool: '縮放工具',
    cutTool: '剪裁工具',
    zoomFilter: '縮放',
    exitFullscreen: '退出全螢幕',
    fullscreen: '全螢幕預覽',
    exportSuccess: '匯出成功！',
    openFile: '開啟檔案',
    cancel: '取消',
    close: '關閉',
    webcam: '攝影機', // 攝像頭 -> 攝影機
    webcamShape: '外型',
    webcamSize: '顯示大小',
    shapeCircle: '圓形',
    shapeRect: '圓角矩形',
    systemAudio: '系統音訊', // 音頻 -> 音訊
    systemAudioDesc: '錄製應用程式與系統發出的聲音',
    micAudio: '麥克風',
    micAudioDesc: '錄製您的旁白解說',
    audioVolume: '音量',
    volumeGain: '音量增益',
    webcamOn: '已開啟即時預覽',
    webcamOff: '開啟後可在畫面中疊加攝影機鏡頭',
    clickEffectDesc: '選擇點擊時的視覺回饋樣式，讓操作指引更清晰',
    physicsTip: '開啟「電影級」預設可顯著減緩滑鼠在縮放時的大幅跳動感',
    loading: '正在載入編輯器...',
    noAddress: '未設定匯出位置',
    exportWarning: '匯出中請勿關閉視窗...',
    ripple: '漣漪',
    ring: '圓環',
    spark: '火花',
  },
  recording: {
    stop: '停止',
    pause: '暫停',
    resume: '繼續',
  }
};