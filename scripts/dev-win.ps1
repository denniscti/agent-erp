# ==============================================================================
# Windows (PowerShell) 啟動腳本 (帶 NVIDIA_API_KEY 啟動 Tauri 開發環境)
# ==============================================================================

if (-not $env:NVIDIA_API_KEY -and (Test-Path ".env")) {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^\s*NVIDIA_API_KEY\s*=\s*(.+)$") {
            $env:NVIDIA_API_KEY = $matches[1].Trim().Trim('"').Trim("'")
            Write-Host "✅ 已由 .env 載入 NVIDIA_API_KEY" -ForegroundColor Green
        }
    }
}

if (-not $env:NVIDIA_API_KEY) {
    Write-Host "⚠️  未偵測到 NVIDIA_API_KEY 環境變數或 .env 檔案。" -ForegroundColor Yellow
    $inputKey = Read-Host "請輸入您的 NVIDIA API Key (nvapi-...，直接按 Enter 則以 Fallback 模式啟動)"
    if ($inputKey -and $inputKey.Trim() -ne "") {
        $env:NVIDIA_API_KEY = $inputKey.Trim()
        Write-Host "✅ 已設定 NVIDIA_API_KEY" -ForegroundColor Green
    } else {
        Write-Host "ℹ️  以無 Key 模式啟動（將自動 fallback 至正規表達式偵測）" -ForegroundColor Cyan
    }
}

Write-Host "🚀 正在啟動 AgentERP (Tauri Dev)..." -ForegroundColor Green
npm run tauri dev
