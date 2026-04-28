# AI Worker Installation & Auto-Update Script
# This script is meant to be served by the main server at http://SERVER:4000/worker_install.ps1

$SERVER_URL = "http://localhost:4000" # NOTE: Change 'localhost' to your actual Server IP in VM
$INSTALL_DIR = "C:\AI_Worker"
$ZIP_PATH = "$INSTALL_DIR\worker.zip"

# Create Directory
if (!(Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force
}
Set-Location $INSTALL_DIR

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   AI Worker Installer (Port 4000)        " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

function Update-Worker {
    Write-Host "Checking for updates from $SERVER_URL..." -ForegroundColor Cyan
    try {
        # Download the latest worker package (assuming server provides /api/worker/bundle.zip)
        Invoke-WebRequest -Uri "$SERVER_URL/api/worker/download" -OutFile $ZIP_PATH -ErrorAction Stop
        
        Write-Host "Extracting newest worker files..." -ForegroundColor Cyan
        # Close Node if it's running
        Stop-Process -Name "node" -ErrorAction SilentlyContinue
        
        Expand-Archive -Path $ZIP_PATH -DestinationPath $INSTALL_DIR -Force
        Remove-Item $ZIP_PATH
        Write-Host "Update Complete!" -ForegroundColor Green
    } catch {
        Write-Host "Failed to download update: $($_.Exception.Message)" -ForegroundColor Red
        if (!(Test-Path "$INSTALL_DIR\worker.js")) {
            Write-Host "Initial download failed. Exiting." -ForegroundColor Red
            return $false
        }
    }
    return $true
}

# Initial Config Check
if (!(Test-Path "$INSTALL_DIR\.env")) {
    $token = Read-Host "Enter your Worker Token (from Server Admin Panel)"
    "SERVER_URL=$SERVER_URL`nTOKEN=$token" | Out-File -FilePath "$INSTALL_DIR\.env" -Encoding UTF8
}

# Run the Worker Loop
while($true) {
    # Check for update every time before starting
    Update-Worker
    
    Write-Host "Starting Worker Service..." -ForegroundColor Green
    # Start node and wait for it
    # If the worker receives an 'Update' command from server, it should simply EXIT (process.exit(0))
    # This loop will then catch that, pull the new ZIP, and restart.
    node worker.js
    
    Write-Host "Worker crashed or requested restart. Re-checking in 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
