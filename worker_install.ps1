# AI Worker Professional Installation & Daemon Script
# 用法: 在节点机器上打开 PowerShell，运行此脚本。

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$SERVER_BASE_URL = "http://192.168.1.100:4000" # 请在此修改你的主服务器初始地址
$INSTALL_DIR = Join-Path $HOME "AI_Worker"
$CONFIG_FILE = Join-Path $INSTALL_DIR "config.json"
$ZIP_PATH = Join-Path $INSTALL_DIR "update.zip"

# 1. 确保安装目录存在
if (!(Test-Path "$INSTALL_DIR")) {
    New-Item -ItemType Directory -Path "$INSTALL_DIR" -Force | Out-Null
}
Set-Location "$INSTALL_DIR"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   AI Worker 节点管理器 (增强型)          " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 2. 配置检查与初始化
if (!(Test-Path "$CONFIG_FILE")) {
    Write-Host "[配置] 未检测到配置文件，开始初始化..." -ForegroundColor Yellow
    $server_ip = Read-Host "请输入主服务器地址 (默认: $SERVER_BASE_URL)"
    if ($server_ip -eq "") { $server_ip = $SERVER_BASE_URL }
    
    $token = Read-Host "请输入节点的 Worker Token (从服务器后台获取)"
    
    $config_obj = @{
        SERVER_URL = $server_ip
        WORKER_TOKEN = $token
    }
    $config_obj | ConvertTo-Json | Out-File -FilePath "$CONFIG_FILE" -Encoding utf8
    Write-Host "[配置] 已创建: $CONFIG_FILE" -ForegroundColor Green
}

# 从配置中读取最新的服务器地址
$current_config = Get-Content "$CONFIG_FILE" | ConvertFrom-Json
$REMOTE_URL = $current_config.SERVER_URL

function Update-Files {
    Write-Host "[更新] 正在检查最新代码: $REMOTE_URL/api/worker/download" -ForegroundColor Cyan
    try {
        # 下载最新的 worker 代码包
        Invoke-WebRequest -Uri "$REMOTE_URL/api/worker/download" -OutFile "$ZIP_PATH" -ErrorAction Stop
        
        Write-Host "[更新] 正在备份本地配置..." -ForegroundColor Cyan
        if (Test-Path "$CONFIG_FILE") {
            Copy-Item "$CONFIG_FILE" "$INSTALL_DIR\config_bak.json" -Force
        }

        Write-Host "[更新] 正在同步最新代码包..." -ForegroundColor Cyan
        Expand-Archive -Path "$ZIP_PATH" -DestinationPath "$INSTALL_DIR" -Force
        
        # 还原配置
        if (Test-Path "$INSTALL_DIR\config_bak.json") {
            Move-Item "$INSTALL_DIR\config_bak.json" "$CONFIG_FILE" -Force
            Write-Host "[配置] 已还原本地配置" -ForegroundColor Gray
        }

        # 清理压缩包
        Remove-Item "$ZIP_PATH" -ErrorAction SilentlyContinue
        Write-Host "[更新] 成功同步最新代码！" -ForegroundColor Green
        
        # 📦 自动检测并安装依赖
        Write-Host "[依赖] 正在为您自动检测并补全节点运行依赖 (npm install)..." -ForegroundColor Cyan
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            npm install --no-audit --no-fund
        } else {
            Write-Host "[错误] 无法在系统 PATH 中找到 'npm'。请确保此电脑已安装 Node.js (推荐 v18+)。" -ForegroundColor Red
        }
        
        return $true
    } catch {
        Write-Host "[错误] 无法获取更新: $($_.Exception.Message)" -ForegroundColor Red
        if (Test-Path "$INSTALL_DIR\worker.js" -or Test-Path "$INSTALL_DIR\worker.ts") {
            Write-Host "[警告] 将尝试使用本地缓存的代码启动..." -ForegroundColor Yellow
            
            # 本地依赖检测兜底
            if (!(Test-Path "$INSTALL_DIR\node_modules")) {
                Write-Host "[依赖] 未找到 node_modules，正在尝试自动安装依赖..." -ForegroundColor Yellow
                if (Get-Command npm -ErrorAction SilentlyContinue) {
                    npm install --no-audit --no-fund
                } else {
                    Write-Host "[错误] 未找到 'npm' Command！请手动安装 Node.js 后重试。" -ForegroundColor Red
                }
            }
            return $true
        }
        return $false
    }
}

# 3. 主运行循环
while($true) {
    # 每次循环开始前，先执行一次更新检查
    $ready = Update-Files
    
    if ($ready) {
        Write-Host "[运行] 正在启动 Worker 服务..." -ForegroundColor Green
        
        # 判断运行模式 (如果有编译后的 js 跑 js，否则尝试跑 tsx/node ts)
        if (Test-Path "worker.js") {
            node worker.js
        } elseif (Test-Path "worker.ts") {
            # 如果你有 tsx 或 ts-node 环境
            npx tsx worker.ts
        } else {
            Write-Host "[错误] 未找到入口文件 (worker.js 或 worker.ts)" -ForegroundColor Red
            Start-Sleep -Seconds 10
            continue
        }
        
        # 当 node 进程退出时
        Write-Host "[状态] Worker 进程已退出。" -ForegroundColor Yellow
    } else {
        Write-Host "[重试] 无法准备运行环境，5秒后重试..." -ForegroundColor Red
    }
    
    Write-Host "------------------------------------------"
    Start-Sleep -Seconds 5
}
