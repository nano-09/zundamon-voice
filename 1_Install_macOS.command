#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Automated Installer
# This script automatically guides the user to set up .env and install dependencies.

cd "$(dirname "$0")"

echo "================================================="
echo "  ずんだもんボット (Zundamon Voice) セットアップ"
echo "================================================="
echo

if ! command -v node &> /dev/null; then
    echo "[エラー] Node.jsがインストールされていません。 https://nodejs.org/ からインストールしてください。"
    exit 1
fi

echo "[1/3] ボットの認証情報の入力"
echo "順番に必要な情報をコピーして貼り付けてください。"
echo "-------------------------------------------------"

read -p "Supabase プロジェクトURL (例: https://xyz.supabase.co): " supa_url
read -p "Supabase Service Role Key: " supa_key
read -p "Discord Bot トークン: " bot_token
read -p "Discord Client ID (Application ID): " client_id
read -p "あなたの Discord ユーザーID: " owner_id

echo "
# ── Required ─────────────────────────────────────

# ── Supabase (Required for Database/2FA) ─────────
SUPABASE_URL=$supa_url
SUPABASE_KEY=$supa_key

# ── Discord ───────────────────────────────────────
DISCORD_TOKEN=$bot_token
CLIENT_ID=$client_id
OWNER_DISCORD_ID=$owner_id

# ── Email / SMTP ──────────────────────────────────
OWNER_EMAIL=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# ── Ollama (Local AI) ─────────────────────────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

# ── VoiceVox (TTS Engine) ─────────────────────────
VOICEVOX_URL=http://localhost:50021
VOICEVOX_SPEAKER=3
" > .env

echo "✅ .env ファイルを作成しました。"
echo

echo "[2/3] ボットの依存パッケージをインストール中..."
npm install

echo
echo "[3/3] スラッシュコマンドを登録中..."
node deploy-commands.js

echo
echo "================================================="
echo " 🎉 セットアップがすべて完了しました！"
echo "================================================="
echo "今後は「2_Start_macOS.command」をダブルクリックするだけで起動できます。"
echo

read -p "エンターキーを押すと終了します..."
