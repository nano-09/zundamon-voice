# zundamon-voice 🟢

Discordのボイスチャンネルで**ずんだもん**と直接おしゃべりしたり、テキストチャンネルのメッセージを読み上げたりできる AI Discord Bot です。

6GB VRAM 環境でも快適に動作するように最適化済み。Ollama（ローカルLLM）、Whisper（音声認識）、VOICEVOX（音声合成）、MCP Web検索を組み合わせ、ずんだもんのキャラクターを完全に保った自然な会話を実現しています。

---

## 🎯 できること

| 機能 | 説明 |
|------|------|
| 🗣️ テキスト読み上げ | テキストチャンネルのメッセージをずんだもんの声で読み上げ |
| 🌐 Web検索 (MCP) | `/search` コマンドで最新のネット情報を検索して、ずんだもんが回答 |
| 🎤 ユーザー別の声設定 | ユーザーごとに話者IDと音声パラメータ（速度・ピッチ・音量）を記憶 |
| 🧹 自動チャット削除 | 指定した時間ごとにチャンネルのメッセージを自動クリーンアップ |
| 😭 絵文字の読み上げ | 絵文字を日本語の感情表現に変換して読み上げ |
| 🎵 カラオケモード | YouTubeから音楽を再生・歌詞表示。`/play` で自動オン、終了で自動オフ |
| 🎛️ 音楽コントローラー | Discordのインタラクティブなボタンで再生/一時停止、スキップ、リアルタイムの再生時間表示が可能 |
| 🔊 サウンドボード | `/soundboard` でオンオフ。キーワードに反応してサウンドを再生 |
| 📊 Premium Dashboard | モダンスタイルな管理画面でBotの状態、リソース、統計をリアルタイム監視 |
| 🔒 セキュリティ管理 | 新規サーバー参加時の2FA（DM認証）とコマンドごとのロール権限設定 |
| 🍎 マルチOS対応 | Windows用のワンクリック起動（.exe）とmacOS用の専用起動スクリプトを用意 |

---

## 📋 必要なもの

| ソフトウェア | 用途 | ダウンロード |
|-------------|------|-------------|
| **Node.js** v18+ | ボット本体 | [nodejs.org](https://nodejs.org/) |
| **VOICEVOX** | ずんだもんの声合成 | [voicevox.hiroshiba.jp](https://voicevox.hiroshiba.jp/) |
| **Ollama** | ローカルAI (※ `/search` 機能に必要) | [ollama.com](https://ollama.com/) |
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
# （任意）/search コマンドを使用する場合、Ollamaインストール後、AIモデルをダウンロード (約4.7GB, 6GB VRAM以上推奨)
ollama pull qwen2.5:7b
```

VOICEVOXはインストールするだけでOKです。起動はランチャーが自動で行います。
※YouTube再生用の `ffmpeg` などの依存関係は Node のインストール時に自動でセットアップされます。

---

### Step 2: Botのインストール

```bash
git clone https://github.com/<あなたのユーザー名>/zundamon-voice.git
cd zundamon-voice
npm install
```

---

### Step 3: Supabase (データベースとVault) のセットアップ

このボットのデータ保存やアクセスログ、認証システムは Supabase を使用します。

1. [Supabase](https://supabase.com) で新しいプロジェクトを作成します。
2. ダッシュボードから **SQL Editor** を開き、以下のSQLスクリプトを貼り付けて実行してください。これにより必要なテーブル群、公開アップロード用バケット、そしてVaultから環境変数を取得するためのRPC(関数)が自動作成されます。

<details>
<summary>📋 必要なSQLスクリプト (クリックで展開)</summary>

```sql
-- 1. 必要な拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";

-- 2. guild_configs テーブル (サーバーごとの設定・権限を保存)
CREATE TABLE IF NOT EXISTS public.guild_configs (
    guild_id TEXT PRIMARY KEY,
    name TEXT,
    icon_url TEXT,
    owner_id TEXT,
    member_count INTEGER,
    permissions JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT '待機中',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. guild_analytics テーブル (ダッシュボード用のアクティビティ履歴)
CREATE TABLE IF NOT EXISTS public.guild_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    texts_spoken INTEGER DEFAULT 0,
    ai_queries INTEGER DEFAULT 0,
    voice_minutes INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    members_active INTEGER DEFAULT 0,
    commands_used JSONB DEFAULT '{}'::jsonb
);

-- 4. logs_v2 テーブル (ダッシュボード用のログ)
CREATE TABLE IF NOT EXISTS public.logs_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT,
    type TEXT NOT NULL, -- 'bot', 'sys', または 'err'
    message TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Vault RPC 関数 (ボットがVaultの機密情報を取得するため)
CREATE OR REPLACE FUNCTION get_bot_secret(secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_value TEXT;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;
  
  RETURN secret_value;
END;
$$;

-- 6. カスタムサウンドボード用ストレージバケット ('sounds')
INSERT INTO storage.buckets (id, name, public) 
VALUES ('sounds', 'sounds', true)
ON CONFLICT (id) DO NOTHING;

-- パブリック読み取りとボットからの操作権限を設定
CREATE POLICY "Public Read Access sounds" ON storage.objects FOR SELECT USING (bucket_id = 'sounds');
CREATE POLICY "Bot Upload Access sounds" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'sounds');
CREATE POLICY "Bot Delete Access sounds" ON storage.objects FOR DELETE USING (bucket_id = 'sounds');
CREATE POLICY "Bot Update Access sounds" ON storage.objects FOR UPDATE USING (bucket_id = 'sounds');
```

</details>

---

### Step 4: 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開いて以下を記入：

```env
# ── Required ─────────────────────────────────────

# ── Supabase (Required for Database/2FA) ─────────
# Get this from your Supabase Project Settings > API
SUPABASE_URL=your_supabase_url_here
SUPABASE_KEY=your_supabase_anon_or_service_key_here
```

> 💡 **その他の環境変数について:**
> `DISCORD_TOKEN` や `CLIENT_ID` などの各種設定値は、セキュリティ上の理由から **Supabase Vault**（Vault Secrets）に保存する仕組みになっています。Supabase ダッシュボードの `Settings > Vault` から以下のシークレットを追加してください：
> 
> - `DISCORD_TOKEN` (必須): ボットのトークン
> - `CLIENT_ID` (必須): アプリケーションID
> - `OWNER_DISCORD_ID` (推奨): 新規サーバー参加時の2FA / オーナー機能など
> - `OWNER_EMAIL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: 2FAメール送信用設定
> 
> ※Vault を使用しない場合は、上記の `.env` ファイルに直接キーと値（例: `DISCORD_TOKEN=...`）を追記することでフォールバック（代用）として動作します。
> 
> 🔒 **サーバー追加時の2FA認証について**:
> Vault または `.env` 内で `OWNER_EMAIL` 等を設定しておくと、Botが新しいサーバーに参加した際に指定先へメールで認証コードが送付されます。DMで承認することでそのサーバーで利用可能になります。

---

### Step 5: スラッシュコマンドの登録

```bash
node deploy-commands.js
```

---

### Step 6: Botとシステムの起動

OSに合わせて以下の手順で起動してください。

#### 🪟 Windowsの場合
ランチャーを作成し、ダブルクリックで一括起動します。
```bash
C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe -out:StartZundamon.exe Launcher.cs
```

**`StartZundamon.exe`** をダブルクリックすると、以下が全自動で立ち上がります：
1. ✅ Ollama (インストールされている場合)
2. ✅ VOICEVOX
3. ✅ Web Dashboard & Discord Bot
4. ✅ ブラウザでダッシュボード（`http://localhost:3000`）が自動で開く

**終了方法（Windows）**
- ダッシュボード上の 🔥 **SHUTDOWN ECOSYSTEM** ボタンをクリック
- または `ShutdownZundamon.bat` を実行

---

#### 🍎 macOSの場合
専用の起動用スクリプトを使って一括起動します。VOICEVOXアプリがインストール済みであることを確認してください。

```bash
# スクリプトに実行権限を付与（初回のみ）
chmod +x start-macOS.command

# 起動
./start-macOS.command
```
または、Finderから `start-macOS.command` をダブルクリックしても起動できます。

**終了方法（macOS）**
- スクリプトが実行されているターミナルウィンドウで `Ctrl + C` を押して終了します。

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

## 🧠 AI処理の流れ (`/search` コマンド実行時)

```
⌨️ ユーザーが /search コマンドで質問する
  ↓
📖 カスタム辞書でスペル修正（/addwordのルール適用）
  ↓
🔧 Ollamaが固有名詞の誤変換を自動補正、最適な検索キーワードを生成
  ↓
🌐 MCP open-websearch でWeb検索を自動実行
  ↓
💬 ずんだもんのキャラで日本語回答生成 + 検索結果を元に要約
  ↓
🔊 (VC接続時) VOICEVOX でずんだもんの声に合成して再生しつつテキスト返信
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
│   ├── ai.js               # Ollama LLM + MCP Web検索
│   ├── commands.js         # 全スラッシュコマンド定義・ハンドラ
│   ├── player.js           # ボイス接続・TTS/音楽キュー・インタラクティブUI管理
│   ├── tts.js              # VOICEVOX TTS合成
│   ├── config.js           # サーバー/ユーザー設定の永続化
│   ├── db.js               # Supabase会話メモリー管理
│   ├── auth.js             # 2FAサーバー認証
│   └── mcpClient.js        # MCP Web検索クライアント
├── sounds/                 # サウンドボード用音声ファイル
├── soundboard.json         # サウンドボードのキーワード→ファイルマッピング
├── Launcher.cs             # C#製ワンクリック起動ランチャー (Windows向け)
├── ShutdownZundamon.bat    # 全プロセス一括終了スクリプト (Windows向け)
├── start-macOS.command     # macOS用起動スクリプト
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
| VOICEVOX接続エラー | VOICEVOXアプリが手動で起動しているか確認（port 50021） |
| /search コマンドが機能しない | Ollamaが起動していることを確認（`ollama serve`）。Ollamaが不要な場合は設定や使用を控える |
| 音楽再生時、一部のYouTube動画が再生できない | `youtube-dl-exec` の一部制限です。年齢制限などがある動画は再生できない場合があります |
| 新しいサーバーで使えない | オーナーへの2FAメールが届いているか確認し、リンクを承認する |
