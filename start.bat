@echo off
cd /d "%~dp0"
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p = '%~f0'; $c = Get-Content -LiteralPath $p -Encoding UTF8; $i = [Array]::IndexOf($c, '# === TRAY_SCRIPT ==='); Invoke-Expression ($c[($i+1)..($c.Length-1)] -join [Environment]::NewLine)"
exit /b

# === TRAY_SCRIPT ===
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$workDir = Split-Path -Parent $p
Set-Location -LiteralPath $workDir

if (Test-Path "C:\Program Files\nodejs") {
    $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}
$ffmpegLocalDir = Join-Path $workDir "node_modules\@ffmpeg-installer\win32-x64"
if (Test-Path $ffmpegLocalDir) {
    $env:PATH = "$ffmpegLocalDir;" + $env:PATH
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

# 防止重复启动多个托盘实例（若已在运行则支持一键重启）
$mutexName = "Local\CallGM_Tray_App_Mutex"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    $res = [System.Windows.Forms.MessageBox]::Show("检测到 CallGM 已经在运行中！`r`n`r`n是否立即重启服务？`r`n（点击「否」可直接在右下角系统托盘双击 GM 图标打开窗口）", "CallGM 提示", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($res -eq [System.Windows.Forms.DialogResult]::Yes) {
        Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $PID -and $_.Name -match 'powershell|node|cmd' -and $_.CommandLine -match 'CallGM|server\.ts'
        } | ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
        Start-Sleep -Milliseconds 800
        $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    } else {
        exit
    }
}

# 动态绘制一个带 "GM" 字样的托盘图标
$bmp = New-Object System.Drawing.Bitmap(32, 32)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$brushBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(37, 99, 235))
$g.FillEllipse($brushBg, 1, 1, 30, 30)
$fontIcon = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("GM", $fontIcon, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 1, 32, 32)), $sf)
$g.Dispose()
$appIcon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

# 创建主控制台窗口（默认隐藏在系统托盘）
$form = New-Object System.Windows.Forms.Form
$form.Text = "CallGM 服务控制台 (http://localhost:4000)"
$form.Size = New-Object System.Drawing.Size(860, 540)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Icon = $appIcon
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)

# 顶部工具栏面板
$topPanel = New-Object System.Windows.Forms.Panel
$topPanel.Dock = [System.Windows.Forms.DockStyle]::Top
$topPanel.Height = 44
$topPanel.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 48)

$btnOpenWeb = New-Object System.Windows.Forms.Button
$btnOpenWeb.Text = "打开网页 (localhost:4000)"
$btnOpenWeb.Location = New-Object System.Drawing.Point(12, 8)
$btnOpenWeb.Size = New-Object System.Drawing.Size(170, 28)
$btnOpenWeb.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnOpenWeb.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$btnOpenWeb.ForeColor = [System.Drawing.Color]::White
$btnOpenWeb.FlatAppearance.BorderSize = 0
$btnOpenWeb.Add_Click({ Start-Process "http://localhost:4000" })

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text = "清空日志"
$btnClear.Location = New-Object System.Drawing.Point(192, 8)
$btnClear.Size = New-Object System.Drawing.Size(85, 28)
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnClear.BackColor = [System.Drawing.Color]::FromArgb(62, 62, 66)
$btnClear.ForeColor = [System.Drawing.Color]::White
$btnClear.FlatAppearance.BorderSize = 0

$btnHide = New-Object System.Windows.Forms.Button
$btnHide.Text = "缩回托盘"
$btnHide.Location = New-Object System.Drawing.Point(287, 8)
$btnHide.Size = New-Object System.Drawing.Size(85, 28)
$btnHide.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnHide.BackColor = [System.Drawing.Color]::FromArgb(62, 62, 66)
$btnHide.ForeColor = [System.Drawing.Color]::White
$btnHide.FlatAppearance.BorderSize = 0

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "彻底退出服务"
$btnStop.Location = New-Object System.Drawing.Point(382, 8)
$btnStop.Size = New-Object System.Drawing.Size(110, 28)
$btnStop.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatAppearance.BorderSize = 0

$topPanel.Controls.AddRange(@($btnOpenWeb, $btnClear, $btnHide, $btnStop))

# 日志输出文本框
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$txtLog.ReadOnly = $true
$txtLog.Dock = [System.Windows.Forms.DockStyle]::Fill
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 20)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 10)
$txtLog.BorderStyle = [System.Windows.Forms.BorderStyle]::None

$form.Controls.Add($txtLog)
$form.Controls.Add($topPanel)

$btnClear.Add_Click({ $txtLog.Clear() })

# 窗口显示与隐藏逻辑
$script:allowClose = $false

function Show-MainWindow {
    $form.Show()
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.ShowInTaskbar = $true
    $form.Activate()
}

function Hide-MainWindow {
    $form.ShowInTaskbar = $false
    $form.Hide()
}

$btnHide.Add_Click({ Hide-MainWindow })

# 最小化时自动缩回系统托盘
$form.Add_Resize({
    if ($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        Hide-MainWindow
    }
})

# 点击右上角 X 时缩回系统托盘而不是直接关掉服务
$form.Add_FormClosing({
    param($sender, $e)
    if (-not $script:allowClose) {
        $e.Cancel = $true
        Hide-MainWindow
    }
})

# 系统托盘图标及右键菜单
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $appIcon
$notifyIcon.Text = "CallGM 服务运行中 (双击打开窗口)"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuShow = $contextMenu.Items.Add("打开控制台窗口")
$menuWeb  = $contextMenu.Items.Add("打开网页 (http://localhost:4000)")
$contextMenu.Items.Add("-") | Out-Null
$menuExit = $contextMenu.Items.Add("退出 CallGM 服务")

$menuShow.Add_Click({ Show-MainWindow })
$menuWeb.Add_Click({ Start-Process "http://localhost:4000" })
$notifyIcon.ContextMenuStrip = $contextMenu

# 双击托盘图标打开窗口
$notifyIcon.Add_MouseDoubleClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        if ($form.Visible -and $form.WindowState -ne [System.Windows.Forms.FormWindowState]::Minimized) {
            $form.Activate()
        } else {
            Show-MainWindow
        }
    }
})

# 线程安全日志队列
$logQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
function Add-Log([string]$msg) {
    $time = (Get-Date).ToString("HH:mm:ss")
    $logQueue.Enqueue("[$time] $msg")
}

# 启动后台服务进程
$script:serverProc = $null

function Start-ServerProcess {
    Add-Log "正在启动 CallGM 服务 (工作目录: $workDir)..."
    Add-Log "服务默认地址: http://localhost:4000"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    if (-not (Test-Path (Join-Path $workDir "node_modules"))) {
        $psi.Arguments = "/c npm install && npm run dev"
    } else {
        $psi.Arguments = "/c npm run dev"
    }
    $psi.WorkingDirectory = $workDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.EnvironmentVariables["FORCE_COLOR"] = "0"

    # 自动注入 OpenCode Go 会话请求头补丁（无需修改项目源码）
    $hookFile = Join-Path $env:TEMP "callgm_opencode_hook.mjs"
    $hookCode = @'
const origFetch = globalThis.fetch;
const sessionId = 'ses_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
globalThis.fetch = function (input, init) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    if (url.includes('opencode.ai')) {
      init = init ? { ...init } : {};
      const headers = new Headers(init.headers || {});
      if (!headers.has('x-opencode-session')) {
        headers.set('x-opencode-session', sessionId);
      }
      headers.set('user-agent', 'opencode/2.0.0');
      init.headers = headers;
    }
  } catch (e) {}
  return origFetch.call(this, input, init);
};
'@
    [System.IO.File]::WriteAllText($hookFile, $hookCode, (New-Object System.Text.UTF8Encoding($false)))
    $hookUri = ([System.Uri]$hookFile).AbsoluteUri
    $psi.EnvironmentVariables["NODE_OPTIONS"] = "--import `"$hookUri`""
    Add-Log "已挂载 OpenCode Go 请求头补丁 (x-opencode-session)"

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    $outAction = {
        if (-not [string]::IsNullOrEmpty($EventArgs.Data)) {
            $Event.MessageData.Enqueue($EventArgs.Data)
        }
    }
    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $outAction -MessageData $logQueue | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $outAction -MessageData $logQueue | Out-Null

    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $script:serverProc = $proc
}

function Stop-AllAndExit {
    $script:allowClose = $true
    $timer.Stop()
    if ($null -ne $script:serverProc -and -not $script:serverProc.HasExited) {
        try {
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/F /T /PID $($script:serverProc.Id)" -WindowStyle Hidden -Wait
        } catch {}
    }
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $form.Close()
    try { $mutex.ReleaseMutex() } catch {}
    [System.Windows.Forms.Application]::Exit()
    [Environment]::Exit(0)
}

$menuExit.Add_Click({ Stop-AllAndExit })
$btnStop.Add_Click({ Stop-AllAndExit })

# 定时器：刷新日志到界面
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 120
$timer.Add_Tick({
    $sb = New-Object System.Text.StringBuilder
    $line = $null
    $count = 0
    while ($count -lt 200 -and $logQueue.TryDequeue([ref]$line)) {
        # 去除常见的 ANSI 颜色控制符
        $cleanLine = $line -replace '\x1B\[[0-9;]*[a-zA-Z]', ''
        [void]$sb.AppendLine($cleanLine)
        $count++
    }
    if ($sb.Length -gt 0) {
        $txtLog.AppendText($sb.ToString())
    }
})
$timer.Start()

Start-ServerProcess

# 启动后弹出托盘气泡通知（不弹窗，直接缩在系统托盘）
$notifyIcon.ShowBalloonTip(3000, "CallGM 已在后台启动", "双击右下角托盘图标可打开控制台窗口，访问地址: http://localhost:4000", [System.Windows.Forms.ToolTipIcon]::Info)

# 使用 ApplicationContext 启动消息循环，保持主窗口初始隐藏在系统托盘
$appContext = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appContext)
$mutex.ReleaseMutex()
