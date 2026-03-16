# zundamon-voice 🟢

Discord のテキストチャンネルのメッセージを、**ずんだもん**（VOICEVOX）の声でボイスチャンネルに読み上げる Bot です。

---

## 📋 必要なもの

| 要件 | 詳細 |
|------|------|
| **Node.js** | v18 以上 |
| **VOICEVOX Engine** | ローカルで起動 (port 50021) → [ダウンロード](https://voicevox.hiho.jp/) |
| **Discord Bot Token** | [Developer Portal](https://discord.com/developers/applications) で取得 |
| **ffmpeg** | `ffmpeg-static` npm パッケージに同梱されています |

> **「Message Content Intent」を有効にしてください！**  
> Developer Portal → Bot → Privileged Gateway Intents → **Message Content Intent** をオン

---

## ⚙️ セットアップ

### 1. リポジトリをクローン & 依存関係をインストール

```bash
git clone https://github.com/<あなたのユーザー名>/zundamon-voice.git
cd zundamon-voice
npm install
```

### 2. `.env` ファイルを作成

`.env.example` をコピーして編集します：

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
VOICEVOX_URL=http://localhost:50021
VOICEVOX_SPEAKER=3   # 3 = ずんだもん (ノーマル)
```

**CLIENT_ID** は Developer Portal のアプリケーション画面で確認できます。

### 3. VOICEVOX Engine を起動

VOICEVOX アプリを起動するか、VOICEVOX Engine を単体で起動してください（デフォルトで port 50021 に立ち上がります）。

### 4. Bot を起動

```bash
npm start
```

コンソールに `✅ ログイン成功: BotName#XXXX` と表示されれば成功です。  
スラッシュコマンドは初回起動時に自動登録されます（`CLIENT_ID` が設定されている場合）。

---

## 🎮 使い方

| コマンド | 説明 |
|---------|------|
| `/join` | あなたのボイスチャンネルに Bot を呼ぶ |
| `/setchannel #チャンネル` | 読み上げ対象のテキストチャンネルを設定 |
| `/status` | 現在の接続・設定状況を確認 |
| `/leave` | ボイスチャンネルから退出 |

### 手順

1. ボイスチャンネルに参加する
2. `/join` でBotを呼ぶ
3. `/setchannel #テキストチャンネル` で読み上げチャンネルを設定
4. そのテキストチャンネルに書き込むと Bot が読み上げます！

---

## 🗣️ ずんだもん スピーカー ID 一覧

| ID | スタイル |
|----|--------|
| `3` | ノーマル（デフォルト） |
| `1` | あまあま |
| `22` | ツンツン |
| `38` | セクシー |

`.env` の `VOICEVOX_SPEAKER` を変更してお好みのスタイルに切り替えられます。

---

## 📁 ファイル構成

```
zundamon-voice/
├── src/
│   ├── index.js        # メインエントリポイント
│   ├── commands.js     # スラッシュコマンド定義・ハンドラ
│   ├── player.js       # ボイス接続・キュー再生
│   ├── tts.js          # VOICEVOX TTS 合成
│   └── config.js       # サーバーごとの設定保存
├── deploy-commands.js  # コマンド登録スクリプト (任意)
├── .env.example
└── package.json
```
