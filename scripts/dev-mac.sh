#!/bin/bash
# ==============================================================================
# macOS / Linux 啟動腳本 (帶 NVIDIA_API_KEY 啟動 Tauri 開發環境)
# ==============================================================================

# 如果環境變數尚未設定，嘗試從 .env 讀取
if [ -z "$NVIDIA_API_KEY" ] && [ -f ".env" ]; then
    key_from_env=$(grep -E "^NVIDIA_API_KEY=" .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r' | xargs)
    if [ -n "$key_from_env" ]; then
        export NVIDIA_API_KEY="$key_from_env"
        echo "✅ 已由 .env 載入 NVIDIA_API_KEY"
    fi
fi

# 如果仍然未設定，提示手動輸入
if [ -z "$NVIDIA_API_KEY" ]; then
    echo "⚠️  未偵測到 NVIDIA_API_KEY 環境變數或 .env 檔案。"
    read -p "請輸入您的 NVIDIA API Key (nvapi-...，直接按 Enter 則以 Fallback 模式啟動): " input_key
    if [ -n "$input_key" ]; then
        export NVIDIA_API_KEY="$input_key"
        echo "✅ 已設定 NVIDIA_API_KEY"
    else
        echo "ℹ️  以無 Key 模式啟動（將自動 fallback 至正規表達式偵測）"
    fi
fi

echo "🚀 正在啟動 AgentERP (Tauri Dev)..."
npm run tauri dev
