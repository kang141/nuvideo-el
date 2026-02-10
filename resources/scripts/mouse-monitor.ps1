$signature = @"
[DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
"@

# 使用 Add-Type 注入 P/Invoke 方法
$type = Add-Type -MemberDefinition $signature -Name "MouseWatcher" -Namespace Win32Utils -PassThru

# 强制刷新缓冲区
$host.UI.RawUI.BufferSize = New-Object Management.Automation.Host.Size(80, 25)

$lastState = 0
# VK_LBUTTON = 0x01
while ($true) {
    # 检查最高位 (0x8000) 是否被置位
    $current = $type::GetAsyncKeyState(0x01) -band 0x8000
    
    # 🎯 优化：更快的点击检测（从 30ms 降低到 10ms）
    # 这样可以更精确地捕获快速点击
    if (($current -ne 0) -and ($lastState -eq 0)) {
        Write-Output "DOWN"
    } elseif (($current -eq 0) -and ($lastState -ne 0)) {
        Write-Output "UP"
    }

    $lastState = $current
    Start-Sleep -Milliseconds 10
}

