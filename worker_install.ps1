# AI Worker Professional Installation and Daemon Script
# 用法 (Usage): 在节点机器上打开 PowerShell，运行此脚本。 (In PowerShell, run this script.)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (Get-Command chcp -ErrorAction SilentlyContinue) {
    chcp 65001 | Out-Null
}

$SERVER_BASE_URL = "http://192.168.1.100:4000" # 请在此修改你的主服务器初始地址 (Please modify your server URL here)
$INSTALL_DIR = Join-Path $HOME "AI_Worker"
$CONFIG_FILE = Join-Path $INSTALL_DIR "config.json"
$ZIP_PATH = Join-Path $INSTALL_DIR "update.zip"

# 1. 确保安装目录存在 (Ensure install directory exists)
if (!(Test-Path "$INSTALL_DIR")) {
    New-Item -ItemType Directory -Path "$INSTALL_DIR" -Force | Out-Null
}
Set-Location "$INSTALL_DIR"

# 1.5 环境依赖前置检查 (Prerequisite environment check)
if (!(Get-Command node -ErrorAction SilentlyContinue) -or !(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "========================= [错误/Error] Node.js 环境缺失 (Node.js Missing) =========================" -ForegroundColor Red
    Write-Host "检测到您的电脑尚未安装 Node.js，或者尚未将其加入系统环境变量 (PATH)！" -ForegroundColor Red
    Write-Host "Node.js environment is not detected on your system or not added to PATH." -ForegroundColor Red
    Write-Host "运行 AI Worker 节点必须在本地部署 Node.js 运行环境 (推荐 v18 或 v20 以上)。" -ForegroundColor Yellow
    Write-Host "Running AI Worker requires Node.js runtime (v18+ recommended)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请按以下步骤简单配置即可运行 (Follow these steps to setup):" -ForegroundColor Cyan
    Write-Host "  1. 打开官方网站下载 (Download from official site): https://nodejs.org/" -ForegroundColor White
    Write-Host "  2. 推荐选择并下载「LTS」(长期支持稳定版本) 的 Windows Installer (.msi) 包。" -ForegroundColor White
    Write-Host "     We recommend downloading the LTS (stable) Windows Installer (.msi)." -ForegroundColor White
    Write-Host "  3. 运行安装包，一路点击 'Next' (确保勾选了 Add to PATH，安装工具默认会自动勾选)。" -ForegroundColor White
    Write-Host "     Run installer and click 'Next' (make sure 'Add to PATH' is checked, which is default)." -ForegroundColor White
    Write-Host "  4. 安装成功后，请【关闭并重新启动一个新的 PowerShell】窗口！" -ForegroundColor White
    Write-Host "     After installation completes, please CLOSE and open a NEW PowerShell window!" -ForegroundColor White
    Write-Host "  5. 重新粘贴并运行您的安装指令，即可一键完美运行！" -ForegroundColor White
    Write-Host "     Re-paste and run your installation script. It will run flawlessly!" -ForegroundColor White
    Write-Host "=========================================================================" -ForegroundColor Red
    Write-Host ""
    Read-Host "请安装完成后，按回车键退出当前窗口并重新打开 PowerShell... (Press Enter to exit after installing Node.js...)"
    exit
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   AI Worker 节点管理器 (增强型/Bilingual)  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 2. 配置检查与初始化 (Configuration check and initialization)
if (!(Test-Path "$CONFIG_FILE")) {
    Write-Host "[配置/Config] 未检测到配置文件，开始初始化... (Config not found, initializing...)" -ForegroundColor Yellow
    $server_ip = Read-Host "请输入主服务器地址 (默认: $SERVER_BASE_URL) / Enter server URL"
    if ($server_ip -eq "") { $server_ip = $SERVER_BASE_URL }
    
    $token = Read-Host "请输入节点的 Worker Token (从服务器后台获取) / Enter Worker Token"
    
    $config_obj = @{
        SERVER_URL = $server_ip
        WORKER_TOKEN = $token
    }
    # 写入 ASCII 编码以彻底避免 BOM 带来的 JSON 解析失败 (Save using ASCII to completely avoid any BOM-related JSON parsing issues)
    $config_obj | ConvertTo-Json | Out-File -FilePath "$CONFIG_FILE" -Encoding ASCII
    Write-Host "[配置/Config] 已创建 (Created): $CONFIG_FILE" -ForegroundColor Green
}

# 从配置中读取最新的服务器地址 (Read current config)
# 容错处理：如果读取带有BOM的文件或UTF-16
$config_content = Get-Content "$CONFIG_FILE" -Raw
$current_config = $config_content | ConvertFrom-Json
$REMOTE_URL = $current_config.SERVER_URL

function Update-Files {
    Write-Host "[更新/Update] 正在检查最新代码 (Checking latest code): $REMOTE_URL/api/worker/download" -ForegroundColor Cyan
    try {
        # 下载最新的 worker 代码包 (Download latest worker payload)
        Invoke-WebRequest -Uri "$REMOTE_URL/api/worker/download" -OutFile "$ZIP_PATH" -ErrorAction Stop
        
        Write-Host "[更新/Update] 正在备份本地配置... (Backup local config...)" -ForegroundColor Cyan
        if (Test-Path "$CONFIG_FILE") {
            Copy-Item "$CONFIG_FILE" "$INSTALL_DIR\config_bak.json" -Force
        }

        Write-Host "[更新/Update] 正在同步最新代码包... (Extracting script files...)" -ForegroundColor Cyan
        Expand-Archive -Path "$ZIP_PATH" -DestinationPath "$INSTALL_DIR" -Force
        
        # 还原配置 (Restore config)
        if (Test-Path "$INSTALL_DIR\config_bak.json") {
            Move-Item "$INSTALL_DIR\config_bak.json" "$CONFIG_FILE" -Force
            Write-Host "[配置/Config] 已还原本地配置 (Local configuration restored)" -ForegroundColor Gray
        }

        # 清理压缩包 (Cleanup zip)
        Remove-Item "$ZIP_PATH" -ErrorAction SilentlyContinue
        Write-Host "[更新/Update] 成功同步最新代码！ (Successfully updated code!)" -ForegroundColor Green
        
        # 📦 自动检测并安装依赖 (Dependency Management)
        Write-Host "[依赖/Deps] 正在为您自动检测并补全节点运行依赖... (Checking and resolving node_modules...)" -ForegroundColor Cyan
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            # 跳过 Chromium 下载并使用国内高速源避免卡死挂起 (Skip chromium download and use npmmirror registry to avoid hangs)
            $env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
            $env:PUPPETEER_SKIP_DOWNLOAD = "true"
            Write-Host "[加速/Mirror] 自动切换至国内淘宝/npmmirror高速依赖源... (Using high-speed registry mirror...)" -ForegroundColor Yellow
            npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
        } else {
            Write-Host "[错误/Error] 无法在系统 PATH 中找到 'npm'。请确保此电脑已安装 Node.js (推荐 v18+)。" -ForegroundColor Red
        }
        
        return $true
    } catch {
        Write-Host "[错误/Error] 无法获取更新 (Failed to download updates): $($_.Exception.Message)" -ForegroundColor Red
        if (Test-Path "$INSTALL_DIR\worker.js" -or Test-Path "$INSTALL_DIR\worker.ts") {
            Write-Host "[警告/Warning] 将尝试使用本地缓存的代码启动... (Will attempt to run from local cached code...)" -ForegroundColor Yellow
            
            # 本地依赖检测兜底 (Fallback local dependency checker)
            if (!(Test-Path "$INSTALL_DIR\node_modules")) {
                Write-Host "[依赖/Deps] 未找到 node_modules，正在尝试自动安装依赖... (Installing local modules...)" -ForegroundColor Yellow
                if (Get-Command npm -ErrorAction SilentlyContinue) {
                    $env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
                    $env:PUPPETEER_SKIP_DOWNLOAD = "true"
                    Write-Host "[加速/Mirror] 自动切换至国内淘宝/npmmirror高速依赖源... (Using high-speed registry mirror...)" -ForegroundColor Yellow
                    npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
                } else {
                    Write-Host "[错误/Error] 未找到 'npm' Command！请手动安装 Node.js 后重试。" -ForegroundColor Red
                }
            }
            return $true
        }
        return $false
    }
}

# 3. 主运行循环 (Primary execution loop)
while($true) {
    # 每次循环开始前，先执行一次更新检查 (Check for updates before boot)
    $ready = Update-Files
    
    if ($ready) {
        Write-Host "[运行/Boot] 正在启动 Worker 服务... (Starting Worker service...)" -ForegroundColor Green
        
        # 判断运行模式 (如果有编译后的 js 跑 js，否则尝试跑 tsx/node ts)
        if (Test-Path "worker.js") {
            node worker.js
        } elseif (Test-Path "worker.ts") {
            # 如果你有 tsx 或 ts-node 环境
            npx tsx worker.ts
        } else {
            Write-Host "[错误/Error] 未找到入口文件 (worker.js 或 worker.ts) (Entrance script not found)" -ForegroundColor Red
            Start-Sleep -Seconds 10
            continue
        }
        
        # 当 node 进程退出时 (On worker exit)
        Write-Host "[状态/Exit] Worker 进程已退出。 (Worker process exited.)" -ForegroundColor Yellow
    } else {
        Write-Host "[重试/Retry] 无法准备运行环境，5秒后重试... (Unable to start, retrying in 5 seconds...)" -ForegroundColor Red
    }
    
    Write-Host "------------------------------------------"
    Start-Sleep -Seconds 5
}
