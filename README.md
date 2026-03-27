# zundamon-voice 🟢

Discordのボイスチャンネルで**ずんだもん**と直接おしゃべりしたり、テキストチャンネルのメッセージを読み上げたりできる AI Discord Bot です。

6GB VRAM 環境でも快適に動作するように最適化済み。Ollama（ローカルLLM）、Whisper（音声認識）、VOICEVOX（音声合成）、MCP Web検索を組み合わせ、ずんだもんのキャラクターを完全に保った自然な会話を実現しています。

---

## 🎯 できること

| 機能 | 説明 |
|------|------|
| 🗣️ テキスト読み上げ | テキストチャンネルのメッセージをずんだもんの声で読み上げ |
| 🤖 AI音声会話 | ボイスチャンネルで話しかけると、ずんだもんがAIで考えて声で返事 |
| 🌐 Web検索 (MCP) | MCP open-websearch で最新のネット情報を検索して回答 |
| 🎤 ユーザー別の声設定 | ユーザーごとに話者IDと音声パラメータ（速度・ピッチ・音量）を記憶 |
| 🧹 自動チャット削除 | 指定した時間ごとにチャンネルのメッセージを自動クリーンアップ |
| 😭 絵文字の読み上げ | 絵文字を日本語の感情表現に変換して読み上げ |
| 🎵 カラオケモード | YouTubeから音楽を再生・歌詞表示。`/play` で自動オン、終了で自動オフ |
| 🔊 サウンドボード | `/soundboard` でオンオフ。キーワードに反応してサウンドを再生 |
| 📊 Premium Dashboard | モダンスタイルな管理画面でBotの状態、リソース、統計をリアルタイム監視 |
| 🔒 セキュリティ管理 | 新規サーバー参加時の2FA（DM認証）とコマンドごとのロール権限設定 |
| 🔥 ワンクリック起動/終了 | `.exe` で全サービスを一括起動、ボタン一つで一括終了 |

---

## 📋 必要なもの

| ソフトウェア | 用途 | ダウンロード |
|-------------|------|-------------|
| **Node.js** v18+ | ボット本体 | [nodejs.org](https://nodejs.org/) |
| **Ollama** | ローカルAI (LLM) | [ollama.com](https://ollama.com/) |
| **VOICEVOX** | ずんだもんの声合成 | [voicevox.hiroshiba.jp](https://voicevox.hiroshiba.jp/) |
| **yt-dlp** | YouTube音楽再生 | [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) |
| **Discord Bot Token** | Bot認証 | [Developer Portal](https://discord.com/developers/applications) |

> ⚠️ Developer Portal → 対象のBot → **Privileged Gateway Intents** → **Message Content Intent** を必ずオンにしてください。

---

## 🚀 セットアップ手順

### Step 0: Discord Bot の作成とトークン取得

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、Discordアカウントでログインする。
2. 右上の **「New Application」** をクリックし、名前を付けて（例: `ずんだもん`）作成する。
3. 左メニューの **「Bot」** をクリックし、**「Reset Token」** ボタンでトークンを生成する。
4. 表示されたトークン文字列を **コピーして安全な場所に保存** する（これが `.env` の `DISCORD_TOKEN` に入る）。
5. 同じBot画面の **「Privileged Gateway Intents」** セクションで以下を **全てオン** にする：
   - ✅ **Presence Intent**
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent** ← これが一番重要！

#### 🔗 BotをDiscordサーバーに招待する

1. 左メニューの **「OAuth2」** をクリック。
2. **「OAuth2 URL Generator」** セクションで、SCOPES から **`bot`** と **`applications.commands`** にチェック。
3. 下に表示される BOT PERMISSIONS から以下にチェック：
   - ✅ Send Messages
   - ✅ Manage Messages（`/cleanchat` に必要）
   - ✅ Read Message History
   - ✅ Connect（ボイスチャンネル参加）
   - ✅ Speak（ボイスチャンネル発話）
   - ✅ Use Voice Activity
4. ページ下部に生成された **招待URL** をコピーしてブラウザで開き、サーバーを選んで招待する。

> 💡 `CLIENT_ID` は左メニュー「General Information」の **Application ID** です。これを `.env` の `CLIENT_ID=` に入力してください。

---

### Step 1: 外部ツールの準備

```bash
# Ollamaインストール後、AIモデルをダウンロード (約4.7GB, 6GB VRAMで動作)
ollama pull qwen2.5:7b
```

**yt-dlp** をインストールし、パス（PATH）が通っていることを確認する。
VOICEVOXはインストールするだけでOK。起動はランチャーが自動で行います。

---

### Step 2: Botのインストール

```bash
git clone https://github.com/<あなたのユーザー名>/zundamon-voice.git
cd zundamon-voice
npm install
```

---

### Step 3: 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開いて以下を記入：

```env
# ── Required ─────────────────────────────────────
DISCORD_TOKEN=あなたのBotトークン
CLIENT_ID=あなたのアプリケーションID

# Bot Owner Discord User ID (for 2FA server authorization DMs)
OWNER_DISCORD_ID=あなたのDiscordユーザーID

# Bot Owner Email (for 2FA OTP)
OWNER_EMAIL=あなたのメールアドレス

# ── Email Settings (Required for bot to send 2FA codes) ──
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=あなたのメールアドレス
SMTP_PASS=アプリパスワード

# ── Ollama (Required for AI Chat Mode) ───────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

# ── VOICEVOX (Required for TTS) ──────────────────
VOICEVOX_URL=http://localhost:50021
# Speaker IDs: 3=ノーマル, 1=あまあま, 5=セクシー, 7=ツンツン
VOICEVOX_SPEAKER=3

# ── Supabase (Required for conversation memory) ──
SUPABASE_URL=あなたのSupabase URL
SUPABASE_KEY=あなたのSupabase Key
```

> 🔒 **サーバー追加時の2FA認証について**:
> `OWNER_DISCORD_ID` を設定しておくと、Botが新しいサーバーに参加した際にオーナーのDM宛に認証リンクが送付されます。リンクから承認することでそのサーバーでの利用が許可されます。

---

### Step 4: スラッシュコマンドの登録

```bash
node deploy-commands.js
```

---

### Step 5: ランチャーの作成と起動

```bash
C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe -out:StartZundamon.exe Launcher.cs
```

**`StartZundamon.exe`** をダブルクリックすると、以下が全自動で立ち上がります：

1. ✅ Ollama
2. ✅ VOICEVOX
3. ✅ Web Dashboard & Discord Bot
4. ✅ ブラウザでダッシュボード（`http://localhost:3000`）が自動で開く

#### 終了方法
- ダッシュボード上の 🔥 **SHUTDOWN ECOSYSTEM** ボタンをクリック
- または `ShutdownZundamon.bat` を実行

---

## 🎮 コマンド一覧

### 基本操作
| コマンド | 説明 |
|---------|------|
| `/vc` | ボイスチャンネルに接続・移動・退出（トグルのように動作） |
| `/setchannel <チャンネル>` | テキスト読み上げの対象チャンネルを設定 |
| `/search <テキスト>` | ウェブ検索してずんだもんがテキストで答える |
| `/serverstatus` | サーバーの設定と接続状態を確認 |
| `/mystatus` | あなた個人の声の設定を確認 |
| `/help` | コマンド一覧を表示 |

### 声の設定 / サーバー設定
| コマンド | 説明 |
|---------|------|
| `/set voice <ID>` | 自分専用の声を設定（ユーザーごとに記憶） |
| `/set <speed/pitch/volume>` | 自分専用の音声パラメータを個別に設定 |
| `/set-server voice <ID>` | サーバー全体のデフォルトの声を指定 |
| `/set-server <speed/pitch/volume>` | サーバー全体のデフォルト音声パラメータを個別に設定 |
| `/readname <True/False>` | 発言者の名前を読み上げるかどうか |
| `/announce <True/False>` | ボイスチャンネルの入退室を読み上げるかどうか |
| `/trim <文字数>` | 読み上げる最大文字数を設定（0=無効） |
| `/soundboard <T/F>` | サウンドボードモード（キーワードSE）のオン/オフ |
| `/customsound <add/rem/list>`| サーバー固有のサウンドボード音源を直接アップロード管理 |
| `/customemoji <add/rem/list>`| サーバー固有の絵文字読み上げ（文字変換）辞書を管理 |


### カラオケモード（音楽再生）
> 🔸 カラオケモードは `/play` を使うと自動的にオンになり、キューが空になると自動的にオフに戻ります。

| コマンド | 説明 |
|---------|------|
| `/play <URLまたは検索ワード>` | YouTubeから曲を再生予約（自動でカラオケモード移行） |
| `/pause` | 再生中の曲を一時停止・再開 |
| `/skip` | 現在の曲をスキップ |
| `/queue` | 現在の再生キューを表示 |
| `/lyrics` | 現在再生中の曲の歌詞を表示 |
| `/musicvolume <音量>` | カラオケのBGM音量を設定（例: 0.5で半分） |

### サーバー管理・権限 (管理用)
| コマンド | 説明 |
|---------|------|
| `/cleanchat <分>` | 指定した分数ごとにメッセージを自動削除（0 = 無効化） |
| `/permissions set <cmd> <role> <allow/deny>` | 指定コマンドに対するロール権限を設定（オーナー専用） |
| `/permissions list` | 現在の権限ルール一覧を表示 |
| `/permissions reset <cmd>` | 指定コマンドの権限ルールをリセット |

---

## 🔊 サウンドボード＆カスタム絵文字

Zundamonは各サーバーごとに独立したサウンドボード音源とカスタム絵文字を持てます！旧バージョンのようにローカルの `soundboard.json` をいじる必要は全くありません。

- **`/customsound add <キーワード> <添付ファイル>`**: Discord上で `.mp3` などの音源ファイルを直接アップロードするだけで、そのサーバー専用の効果音として登録され、即座に **Supabase Storage** のクラウドに保管されます。
- **`/customemoji add <絵文字> <読み方>`**: オリジナルのカスタム絵文字やスタンプがチャットに貼られた時、どんな言葉として読み上げるかを定義できます。

---

## 🧠 AI処理の流れ

```
🎤 ユーザーが話す
  ↓
🔊 Whisper が音声を日本語テキストに変換
  ↓
📖 カスタム辞書でスペル修正（/addwordのルール適用）
  ↓
🔧 Ollamaが固有名詞の誤変換を自動補正
  ↓
🌐 MCP open-websearch でWeb検索（必要に応じて自動発動）
  ↓
💬 ずんだもんのキャラで日本語回答生成 + 固有名詞はひらがなに変換
  ↓
🔊 VOICEVOX でずんだもんの声に合成して再生
```

---

## 📁 ファイル構成

```text
zundamon-voice/
├── dashboard/              # Webダッシュボード (Express + Socket.IO)
│   ├── server.js           # バックエンドサーバー・プロセス管理
│   └── public/             # フロントエンド (HTML/CSS/JS)
├── src/
│   ├── index.js            # Discordクライアント・イベント処理
│   ├── ai.js               # Whisper音声認識 + Ollama LLM + MCP Web検索
│   ├── commands.js         # 全スラッシュコマンド定義・ハンドラ
│   ├── player.js           # ボイス接続・TTS/音楽キュー管理 (yt-dlp経由)
│   ├── tts.js              # VOICEVOX TTS合成
│   ├── config.js           # サーバー/ユーザー設定の永続化
│   ├── db.js               # Supabase会話メモリー管理
│   ├── auth.js             # 2FAサーバー認証
│   └── mcpClient.js        # MCP Web検索クライアント
├── sounds/                 # サウンドボード用音声ファイル
├── soundboard.json         # サウンドボードのキーワード→ファイルマッピング
├── Launcher.cs             # C#製ワンクリック起動ランチャー
├── ShutdownZundamon.bat    # 全プロセス一括終了スクリプト
├── deploy-commands.js      # スラッシュコマンドのDiscord登録
├── .env.example            # 環境変数テンプレート
└── package.json
```

---

## ❓ トラブルシューティング

| 問題 | 解決方法 |
|------|---------|
| コマンドが Discord に表示されない | `node deploy-commands.js` を実行してコマンドを登録 |
| Message Content Intent エラー | Developer Portal でBot設定の Intent をオンにする |
| VOICEVOX接続エラー | VOICEVOXアプリが起動していることを確認（port 50021） |
| Whisperが固有名詞を間違える | AIが自動で文脈から補正を試みます |
| YouTube音楽が再生されない | `yt-dlp` がインストールされており、PATHが通っていることを確認 |
| AI会話モードが起動しない | Ollamaが起動していることを確認（`ollama serve`） |
| 新しいサーバーで使えない | オーナーへの2FAメールが届いているか確認し、リンクを承認する |
