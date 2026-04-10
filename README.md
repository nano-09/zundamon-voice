# zundamon-voice 🟢

Discordのボイスチャンネルで**ずんだもん**テキストチャンネルのメッセージを読み上げる Discord Bot です。

---

## 🎯 できること

| 機能 | 説明 |
|------|------|
| 🗣️ テキスト読み上げ | テキストチャンネルのメッセージをずんだもんの声で読み上げ |
| 🎤 ユーザー別の設定 | ユーザーごとに話者ID、速度、ピッチ、音量を個別に記憶 |
| 🔖 プリセット保存 | お気に入りの声設定を `/preset save` で保存していつでも切り替え可能 |
| 🧹 自動チャット削除 | 読み上げ後のボットメッセージを自動的にクリーンアップ |
| 😭 絵文字の読み上げ | 絵文字を日本語の感情表現に変換して読み上げ |
| 🎵 カラオケモード | YouTubeから音楽を再生。`/play` で自動オン、終了で自動オフ |
| 🔁 ループ再生 | `/loop` で1曲リピートや全曲リピートを設定可能 |
| 🎛️ 音楽操作 | Discordのボタン操作で再生/一時停止、スキップ、リアルタイムの時間表示が可能 |
| 📊 Premium Dashboard | モダンスタイルな管理画面でBotの状態や統計をリアルタイム監視 |
| 🔒 サーバー認証 | 新規サーバー参加時の管理者認証(2FA)とロールごとの権限管理 |
| 🍎 マルチOS対応 | Windows用の.exe版とmacOS/Linux用の.command版インストーラーを用意 |

---

## 📋 必要なもの

| ソフトウェア | 用途 | ダウンロード |
|-------------|------|-------------|
| **Node.js** v18+ | ボット本体 | [nodejs.org](https://nodejs.org/) |
| **VOICEVOX** | ずんだもんの声合成 | [voicevox.hiroshiba.jp](https://voicevox.hiroshiba.jp/) |
| **Discord Bot Token** | Bot認証 | [Developer Portal](https://discord.com/developers/applications) |

> ⚠️ Developer Portal → 対象のBot → **Privileged Gateway Intents** → **Message Content Intent** を必ずオンにしてください。

---

## 🚀 セットアップ手順

### Step 0: 外部ツールの準備

VOICEVOXはインストールするだけでOKです。起動はランチャーが自動で行います。

---

### Step 1: Botのインストール

**🪟 Windowsユーザーの方 (全自動インストーラー)**
1. **`InstallZundamon.exe`** をダウンロードし、起動します。
2. インストーラーが起動するので、画面の指示（日本語）に従って、インストール先のフォルダや必要なトークンを入力してください。
> 💡 必要なファイルの構築、`npm install`、環境変数（.env）の作成、スラッシュコマンドの登録まで全て**全自動**で行われます！完了した方はこのまま「**Step 6**」に進んでください。

<details>
<summary>🍎 macOS でインストールする手順</summary>

1. ダウンロードしたフォルダ内の **`InstallZundamon.command`** をダブルクリックします。
2. ターミナルが起動し、Windows版と同様のセットアップガイドが開始されます。
</details>

---

### Step 2: Botとシステムの起動

OSに合わせて以下の手順で起動してください。

#### 🪟 Windowsの場合
ランチャー **`StartZundamon.exe`** をダブルクリックして一括起動します。

**`StartZundamon.exe`** をダブルクリックすると、以下が全自動で立ち上がります：
1. ✅ VOICEVOX
2. ✅ Web Dashboard & Discord Bot
3. ✅ ブラウザでダッシュボード（`http://localhost:3000`）が自動で開く

**終了方法（Windows）**
- ダッシュボード上の 🔥 **SHUTDOWN ECOSYSTEM** ボタンをクリック
- または **`ShutdownZundamon.exe`** を実行

---

#### 🍎 macOSの場合
専用の起動用スクリプトを使って一括起動します。

1. **`InstallZundamon.command`** を実行して初期設定を完了させます。
2. 以降は **`StartZundamon.command`** をダブルクリックして起動します。

**終了方法（macOS）**
- **`ShutdownZundamon.command`** を実行して終了します。

## 🎮 コマンド一覧

### 基本操作
| コマンド | 説明 |
|---------|------|
| `/vc` | ボイスチャンネルに接続・移動・退出（トグルのように動作） |
| `/setchannel <チャンネル>` | テキスト読み上げの対象チャンネルを設定 |
| `/serverstatus` | サーバーの設定と接続状態を確認（音楽音量も表示） |
| `/mystatus` | あなた個人の声の設定を確認 |
| `/help` | コマンド一覧を表示 |

### 声の設定 / サーバー設定
| コマンド | 説明 |
|---------|------|
| `/set voice <ID>` | 自分専用の声を設定（ユーザーごとに記憶） |
| `/set <speed/pitch/volume>` | 自分専用の音声パラメータを個別に設定 |
| `/preset <save/load/list>` | あなたのお気に入りの声設定を保存・呼び出し |
| `/set-server voice <ID>` | サーバー全体のデフォルトの声を指定 |
| `/set-server <speed/pitch/volume>` | サーバー全体のデフォルト音声パラメータを個別に設定 |
| `/readname <True/False>` | 発言者の名前を読み上げるかどうか |
| `/announce <True/False>` | ボイスチャンネルの入退室を読み上げるかどうか |
| `/trim <文字数>` | 読み上げる最大文字数を設定（0=無効） |
| `/soundboard <True/False>` | サウンドボードモード（キーワードSE）のオン/オフ |
| `/customsound <add/remove/list>`| サーバー固有のサウンドボード音源を直接アップロード管理 |
| `/customemoji <add/remove/list>`| サーバー固有の絵文字読み上げ（文字変換）辞書を管理 |

### カラオケモード（音楽再生）
| コマンド | 説明 |
|---------|------|
| `/play <ワード/URL>` | YouTubeから曲を再生予約（自動でカラオケモード移行） |
| `/pause` | 再生中の曲を一時停止・再開 |
| `/skip` | 現在の曲をスキップ |
| `/queue` | 現在の再生キューを表示 |
| `/lyrics` | 現在再生中の曲の歌詞を表示 |
| `/musicvolume <音量>` | カラオケのBGM音量を設定（例: 0.5で半分） |
| `/loop <mode>` | ループ再生設定（オフ / 1曲 / 全曲） |

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

## 📁 ファイル構成

```text
zundamon-voice/
├── dashboard/              # Webダッシュボード
├── src/
│   ├── index.js            # Discordクライアント・イベント処理
│   ├── commands.js         # 全スラッシュコマンド定義・ハンドラ
│   ├── player.js           # ボイス接続・TTS/音楽キュー管理
│   ├── tts.js              # VOICEVOX TTS合成
│   ├── config.js           # サーバー/ユーザー設定の永続化
│   ├── db_supabase.js      # Supabaseデータベース管理
│   └── auth.js             # 2FAサーバー認証
├── Installer.cs            # Windows用インストーラーソース
├── InstallZundamon.exe     # Windows用インストーラー
├── StartZundamon.exe       # Windows用一括起動ランチャー
├── StartZundamon.command   # macOS/Linux用一括起動スクリプト
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
| 2FAメールが届かない | Gmailの設定とアプリパスワードが正しいか確認 |
| 音楽再生時、一部のYouTube動画が再生できない | `youtube-dl-exec` の一部制限です。年齢制限などがある動画は再生できない場合があります |
| 新しいサーバーで使えない | オーナーへの2FAメールが届いているか確認し、リンクを承認する |
