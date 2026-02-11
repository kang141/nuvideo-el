import koffi from 'koffi';

// Win32 Constants
const IDC_ARROW = 32512;
const IDC_IBEAM = 32513;
const IDC_WAIT = 32514;
const IDC_CROSS = 32515;
const IDC_SIZENWSE = 32642;
const IDC_SIZENESW = 32643;
const IDC_SIZEWE = 32644;
const IDC_SIZENS = 32645;
const IDC_SIZEALL = 32646;
const IDC_NO = 32648;
const IDC_HAND = 32649;
const IDC_APPSTARTING = 32650;
const IDC_HELP = 32651;

// Load user32.dll
const user32 = koffi.load('user32.dll');

// Define POINT structure
const POINT = koffi.struct('POINT', {
    x: 'long',
    y: 'long'
});

// Define CURSORINFO structure
// 在 x64 架构下，intptr 是 8 字节，long 是 4 字节
// cbSize(4) + flags(4) + hCursor(8) + ptScreenPos(8) = 24 字节
const CURSORINFO = koffi.struct('CURSORINFO', {
    cbSize: 'uint32',
    flags: 'uint32',
    hCursor: 'intptr',
    ptScreenPos: POINT
});

// Define functions
// 使用 void* 指针接收 Buffer
const GetCursorInfo = user32.func('int __stdcall GetCursorInfo(void *pci)');
const LoadCursorA = user32.func('intptr __stdcall LoadCursorA(intptr hInstance, intptr lpCursorName)');

// Map of handle to name
const cursorHandles: Record<string, string> = {};

export function initCursorUtils() {
    if (process.platform !== 'win32') return;

    const cursors = {
        default: IDC_ARROW,
        pointer: IDC_HAND,
        text: IDC_IBEAM,
        wait: IDC_WAIT,
        progress: IDC_APPSTARTING,
        crosshair: IDC_CROSS,
        'ns-resize': IDC_SIZENS,
        'ew-resize': IDC_SIZEWE,
        'nwse-resize': IDC_SIZENWSE,
        'nesw-resize': IDC_SIZENESW,
        move: IDC_SIZEALL,
        'not-allowed': IDC_NO,
        help: IDC_HELP
    };

    for (const [name, id] of Object.entries(cursors)) {
        const handle = LoadCursorA(0, id);
        if (handle) {
            cursorHandles[handle.toString()] = name;
        }
    }
}

export function getCursorShape(): string {
    if (process.platform !== 'win32') return 'default';

    // 手动分配 24 字节内存 (x64 CURSORINFO)
    // Offset 0: cbSize (4 bytes)
    // Offset 4: flags (4 bytes)
    // Offset 8: hCursor (8 bytes)
    // Offset 16: ptScreenPos (8 bytes)
    const buf = Buffer.alloc(24);
    buf.writeUInt32LE(24, 0); // cbSize = 24

    if (GetCursorInfo(buf)) {
        // 读取 hCursor (offset 8)
        // 注意：Node.js Buffer 读取 64 位整数返回 BigInt
        const hCursor = buf.readBigInt64LE(8);
        const handleStr = hCursor.toString();
        
        const found = cursorHandles[handleStr];
        if (!found) {
            if (Math.random() < 0.05) console.log('[Cursor Debug] Unknown handle:', handleStr);
            return 'default';
        }
        return found;
    }
    return 'default';
}
