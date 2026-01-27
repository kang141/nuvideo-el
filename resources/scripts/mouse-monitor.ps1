$signature = @"
[DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
"@

# 使用 Add-Type 注入 P/Invoke 方法
# 这在首次运行时可能需要几百毫秒进行编译
$type = Add-Type -MemberDefinition $signature -Name "MouseWatcher" -Namespace Win32Utils -PassThru

# 强制刷新缓冲区
$host.UI.RawUI.BufferSize = New-Object Management.Automation.Host.Size(80, 25)

$lastState = 0
# VK_LBUTTON = 0x01
while ($true) {
    # 检查最高位 (0x8000) 是否被置位
    $current = $type::GetAsyncKeyState(0x01) -band 0x8000
    
    # 简单的去抖动/状态变更检测
    # 由于 GetAsyncKeyState 是实时的，且我们轮询间隔短，这能较好反映按键
    if (($current -ne 0) -and ($lastState -eq 0)) {
        Write-Output "DOWN"
    } elseif (($current -eq 0) -and ($lastState -ne 0)) {
        Write-Output "UP"
    }

    $lastState = $current
    Start-Sleep -Milliseconds 30
}
