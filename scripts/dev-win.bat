@echo off
REM ==============================================================================
REM Windows (CMD / 批次檔) 啟動腳本 (帶 NVIDIA_API_KEY 啟動 Tauri 開發環境)
REM ==============================================================================

if "%NVIDIA_API_KEY%"=="" if exist .env (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if "%%A"=="NVIDIA_API_KEY" (
            set NVIDIA_API_KEY=%%B
            echo [OK] 已由 .env 載入 NVIDIA_API_KEY
        )
    )
)

if "%NVIDIA_API_KEY%"=="" (
    echo [!] 未偵測到 NVIDIA_API_KEY 環境變數或 .env 檔案。
    set /p input_key="請輸入您的 NVIDIA API Key (nvapi-...，直接按 Enter 則以 Fallback 模式啟動): "
    if not "%input_key%"=="" (
        set NVIDIA_API_KEY=%input_key%
        echo [OK] 已設定 NVIDIA_API_KEY
    ) else (
        echo [i] 以無 Key 模式啟動（將自動 fallback 至正規表達式偵測）
    )
)

echo [*] 正在啟動 AgentERP (Tauri Dev)...
npm run tauri dev
