using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace ZundamonInstaller
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.Title = "ずんだもんボット - インストーラー";
            
            PrintAsciiArt();
            Console.WriteLine("=================================================");
            Console.WriteLine("  ずんだもんボット (Zundamon Voice) セットアップ");
            Console.WriteLine("=================================================");
            Console.WriteLine();
            Console.WriteLine("このインストーラーは、不要な外部アプリや手動設定なしで");
            Console.WriteLine("ボットの導入・必要なファイルの構築・セットアップを全自動で行います。");
            Console.WriteLine();

            // 1. 環境チェック
            Console.WriteLine("[1/4] システム環境の確認中...");
            if (!CheckCommand("node -v"))
            {
                ErrorExit("Node.jsがインストールされていません。 https://nodejs.org/ からインストールしてください。");
            }
            if (!CheckCommand("git --version"))
            {
                ErrorExit("Gitがインストールされていません。 https://git-scm.com/ からインストールしてください。");
            }
            Console.WriteLine("OK: Node.js と Git がインストールされています。");

            string voicevoxPath = FindVoicevoxPath();
            if (!string.IsNullOrEmpty(voicevoxPath))
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine(string.Format("✅ VOICEVOX を検出しました: {0}", voicevoxPath));
                Console.ResetColor();
                Console.WriteLine("準備が整いました。");
            }
            else
            {
                Console.WriteLine("\n[?] VOICEVOX はインストールされていますか？");
                Console.WriteLine("このボットを動かすには VOICEVOX (アプリ) が必要です。");
                Console.WriteLine("まだインストールしていない場合は、以下のリンクからダウンロードして実行してください：");
                Console.WriteLine("👉 https://voicevox.hiroshiba.jp/");
                Console.Write("準備ができたら Enter キーを押してください...");
                Console.ReadLine();
            }
            Console.WriteLine();

            // 2. ディレクトリの選択とクローン
            Console.WriteLine("[2/4] インストール先のフォルダを指定してください。");
            string currentDir = Directory.GetCurrentDirectory();
            Console.WriteLine(string.Format("デフォルト: {0}", currentDir));
            Console.Write("インストール先のフルパスを入力（そのままEnterでデフォルトを使用）: ");
            string _targetDirInput = Console.ReadLine();
            string targetDir = _targetDirInput != null ? _targetDirInput.Trim() : "";
            
            if (string.IsNullOrEmpty(targetDir)) 
            {
                targetDir = currentDir;
            }

            if (!Directory.Exists(targetDir))
            {
                Console.WriteLine(string.Format("フォルダが存在しません。作成します: {0}", targetDir));
                Directory.CreateDirectory(targetDir);
            }

            // Check if repo already exists here
            string packageJsonPath = Path.Combine(targetDir, "package.json");
            if (!File.Exists(packageJsonPath))
            {
                // If directory is not empty, append a subfolder so git clone doesn't fail
                if (Directory.Exists(targetDir) && Directory.GetFileSystemEntries(targetDir).Length > 0)
                {
                    targetDir = Path.Combine(targetDir, "ZundamonBot");
                    if (!Directory.Exists(targetDir))
                    {
                        Directory.CreateDirectory(targetDir);
                    }
                    Console.WriteLine(string.Format("指定されたフォルダには既にファイルが存在するため、「{0}」内にインストールします。", targetDir));
                }

                Console.WriteLine("\n指定されたフォルダにボットのファイルがありません。GitHubから最新のファイルをダウンロードします...");
                int cloneResult = RunCommandWait("git", "clone https://github.com/nano-09/zundamon-voice .", targetDir);
                if (cloneResult != 0)
                {
                    ErrorExit("ファイルのダウンロード（git clone）に失敗しました。");
                }
                Console.WriteLine("ダウンロードが完了しました。\n");
            }
            else
            {
                Console.WriteLine("\nボットのファイルが既に存在するため、ダウンロードをスキップします。\n");
            }

            // 3. 環境変数（.env）のセットアップ
            Console.WriteLine("[3/4] ボットの認証情報の入力");
            Console.WriteLine("ボットを動かすために必要な情報を順番に入力してください。");
            Console.WriteLine("-------------------------------------------------");

            Console.WriteLine("\n--- [ セクション 1: データベース (Supabase) ] ---");
            Console.WriteLine("Supabaseはボットの設定保存や、二段階認証(2FA)に必要です。");
            Console.WriteLine("\n[?] まだプロジェクトを作成していない場合:");
            Console.WriteLine("  1. https://supabase.com/dashboard にアクセスしてログインします。");
            Console.WriteLine("  2. 「New Project」をクリックします。");
            Console.WriteLine("  3. 以下の設定が推奨されます：");
            Console.WriteLine("     - Region: ボットを動かす場所に近い地域 (例: Tokyo など)");
            Console.WriteLine("     - Database Password: 忘れないようにメモしてください");
            Console.WriteLine("     - Pricing: 「Free」プランで十分です");
            Console.WriteLine();

            string supabaseUrlInput = PromptInput(
                "Supabase プロジェクトURL",
                "1. https://supabase.com/dashboard にアクセスしてプロジェクトを選択します。\n" +
                "2. プロジェクト名の下にあるURL（例: https://xyz.supabase.co）をコピーしてください。",
                "https://xyz.supabase.co"
            );

            // Robust Project ID extraction
            string projectId = "";
            try {
                if (supabaseUrlInput.Contains(".supabase.co")) {
                    // Domain format: https://xyz.supabase.co
                    projectId = supabaseUrlInput.Split('.')[0].Split(new[] { "//" }, StringSplitOptions.None)[1];
                } else if (supabaseUrlInput.Contains("/project/")) {
                    // Dashboard format: https://supabase.com/dashboard/project/xyz
                    var parts = supabaseUrlInput.Split('/');
                    projectId = parts[parts.Length - 1];
                }
            } catch { }

            if (string.IsNullOrEmpty(projectId)) {
                Console.WriteLine("⚠️ 注意: プロジェクトIDの自動解析に失敗しました。URLが正しいか確認してください。");
            }

            string supabaseKey = PromptInput(
                "Supabase service_role Key",
                "1.左メニュー下部の「Project Settings（ギアアイコン）」から「API」を開きます。\n" +
                "2.「Project API keys」内にある「service_role (secret)」項目の横の「Reveal」を押し、「Copy」ボタンでコピーしてください。",
                "eyJ..."
            );

            // Open Supabase SQL Editor helper
            try {
                if (!string.IsNullOrEmpty(projectId)) {
                    string sqlEditorUrl = string.Format("https://supabase.com/dashboard/project/{0}/sql/new", projectId);
                    Console.WriteLine("\n[自動操作] ブラウザで Supabase SQL エディタを開きますか？");
                    Console.Write("Enterキーを押すと開きます (スキップする場合は Ctrl+C 以外を入力): ");
                    Console.ReadLine();
                    Process.Start(new ProcessStartInfo(sqlEditorUrl) { UseShellExecute = true });
                }
            } catch {
                Console.WriteLine("\n[情報] ブラウザを開けませんでした。手動で Supabase ダッシュボードの SQL Editor を開いてください。");
            }

            Console.WriteLine("\n--- [ Supabase テーブル作成用 SQL ] ---");
            Console.WriteLine("以下の SQL をコピーして、開いた SQL エディタに貼り付けて実行(Run)してください：");
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine(@"
-- 以下のすべてをコピーして貼り付けてください --
CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id TEXT PRIMARY KEY,
    name TEXT,
    icon_url TEXT,
    owner_id TEXT,
    member_count INTEGER,
    permissions JSONB,
    settings JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT '待機中',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_analytics (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    guild_id TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ DEFAULT NOW(),
    texts_spoken INTEGER DEFAULT 0,
    ai_queries INTEGER DEFAULT 0,
    voice_minutes INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    members_active INTEGER DEFAULT 0,
    commands_used JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS logs_v2 (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    guild_id TEXT,
    type TEXT,
    message TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_presets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    voice_id INTEGER NOT NULL,
    speed DOUBLE PRECISION NOT NULL,
    pitch DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS music_lyrics (
    video_url TEXT PRIMARY KEY,
    lyrics TEXT,
    source TEXT,
    found BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- RLS (Row Level Security) の有効化
ALTER TABLE guild_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_lyrics ENABLE ROW LEVEL SECURITY;

-- 簡易的なポリシー作成 (ボット/ダッシュボード用)
DO $$ 
BEGIN
    -- すべてのテーブルに対して全アクセスポリシーを作成
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access' AND tablename = 'guild_configs') THEN
        CREATE POLICY ""Allow all access"" ON public.guild_configs FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access' AND tablename = 'guild_analytics') THEN
        CREATE POLICY ""Allow all access"" ON public.guild_analytics FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access' AND tablename = 'logs_v2') THEN
        CREATE POLICY ""Allow all access"" ON public.logs_v2 FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access' AND tablename = 'user_presets') THEN
        CREATE POLICY ""Allow all access"" ON public.user_presets FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access' AND tablename = 'music_lyrics') THEN
        CREATE POLICY ""Allow all access"" ON public.music_lyrics FOR ALL USING (true);
    END IF;
END $$;

-- ⚠️ 重要: Supabase Storage の設定
-- 1. Dashboard -> Storage -> New Bucket で ""sounds"" という名前のバケットを作成してください。
-- 2. ""Public bucket"" をオンに設定してください。
--------------------------------------------------");
            Console.ResetColor();
            
            while (true)
            {
                Console.WriteLine("\n実行(Run)が完了したら、この画面に戻ってエンターキーを押してください。");
                Console.WriteLine("データベースの構成を自動検証します...");
                Console.ReadLine();

                if (VerifySupabase(supabaseUrlInput, supabaseKey))
                {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("✅ データベースの正常な構成を確認しました！");
                    Console.ResetColor();
                    break;
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("\n❌ エラー: データベースの構成が正しくないか、テーブルが見つかりません。");
                    Console.ResetColor();
                    Console.WriteLine("SQLエディタで「Run」ボタンを押し、すべてのステートメントが成功したか確認してください。");
                    Console.WriteLine("再試行するにはエンターキーを、中断するには Ctrl+C を押してください。");
                }
            }

            Console.WriteLine("\n--- [ セクション 2: Discord 認証情報 ] ---");

            string discordToken = PromptInput(
                "Discord Bot トークン",
                "1. https://discord.com/developers/applications にアクセスします。\n" +
                "2. 左メニュー「Bot」で「Reset Token」をクリックし、文字列をコピーします。\n" +
                "3. 重要: 同じページの下部にある「Message Content Intent」を必ずオンにしてください！",
                "MTQ..."
            );

            Console.WriteLine("\n[💡 推奨設定: Botのサーバー招待URLの作成]");
            Console.WriteLine("  1. 左メニュー「OAuth2」>「URL Generator」を開きます。");
            Console.WriteLine("  2. SCOPES: 「bot」と「applications.commands」にチェック。");
            Console.WriteLine("  3. BOT PERMISSIONS: 以下をオンにします：");
            Console.WriteLine("     - Send Messages, Manage Messages, Read Message History");
            Console.WriteLine("     - Connect, Speak, Use Voice Activity");
            Console.WriteLine("  4. 生成されたURLをコピーして、別のブラウザタブで開き、自分のサーバーにボットを招待してください。");
            Console.WriteLine();

            string clientId = PromptInput(
                "Discord Client ID (Application ID)",
                "1. https://discord.com/developers/applications の対象アプリのページを開きます。\n" +
                "2. 左メニューの「General Information」を開きます。\n" +
                "3. 「APPLICATION ID」の横にある数字のみの文字列をコピーして貼り付けてください。",
                "148..."
            );

            string ownerId = PromptInput(
                "あなたの Discord ユーザーID",
                "1. Discordアプリ内の右下ユーザーアイコン > 右上の歯車をクリックします。\n" +
                "2. 「詳細設定」>「開発者モード」をONにします。\n" +
                "3. チャット欄で自分のアイコンを右クリックし、「ユーザーIDをコピー」してください。",
                "915..."
            );

            Console.WriteLine("\n--- [ セクション 3: メール送信設定 (SMTP) ] ---");
            Console.WriteLine("ボットが新しいサーバーに参加した際の認証コード送信に使用します。\n(後で手動で設定する場合は、すべて空欄のままエンターを押してください)");

            string gmailAddress = "";
            while (true)
            {
                gmailAddress = PromptInput(
                    "Gmail アドレス",
                    "ボットの通知受信および送信に使用する Gmail アドレスを入力してください。\n(※ @gmail.com で終わる必要があります)",
                    "yourname@gmail.com",
                    true
                );
                if (string.IsNullOrEmpty(gmailAddress) || gmailAddress.ToLower().EndsWith("@gmail.com"))
                    break;
                Console.WriteLine("❌ エラー: Gmail アドレス (@gmail.com) を入力してください。");
            }

            string ownerEmail = gmailAddress;
            string smtpUser = gmailAddress;

            string smtpPass = "";
            if (!string.IsNullOrEmpty(gmailAddress))
            {
                // Open Google App Password helper
                try {
                    Console.WriteLine("\n[自動操作] ブラウザで Google アプリパスワード設定ページを開きますか？");
                    Console.Write("Enterキーを押すと開きます: ");
                    Console.ReadLine();
                    Process.Start(new ProcessStartInfo("https://myaccount.google.com/apppasswords") { UseShellExecute = true });
                } catch { }

                smtpPass = PromptInput(
                    "Gmail アプリパスワード",
                    "1. Googleアカウントの「2段階認証プロセス」がONであることを確認します。\n" +
                    "2. 「アプリ パスワード」設定（または検索）から「その他」等で名前を付けて作成します。\n" +
                    "3. 生成された16桁のパスワードをここに貼り付けてください。",
                    "abcd efgh ijkl mnop",
                    true
                );
            }

            // 4. .envファイルの生成
            string envPath = Path.Combine(targetDir, ".env");
            Console.WriteLine("\n[構成ファイルの作成] .env ファイルを作成しています...");
            
            StringBuilder envContent = new StringBuilder();
            envContent.AppendLine("# ── Required ─────────────────────────────────────");
            envContent.AppendLine();
            envContent.AppendLine("# ── Supabase (Required for Database/2FA) ─────────");
            envContent.AppendLine(string.Format("SUPABASE_URL={0}", supabaseUrlInput));
            envContent.AppendLine(string.Format("SUPABASE_KEY={0}", supabaseKey));
            envContent.AppendLine();
            envContent.AppendLine("# ── Discord ───────────────────────────────────────");
            envContent.AppendLine(string.Format("DISCORD_TOKEN={0}", discordToken));
            envContent.AppendLine(string.Format("CLIENT_ID={0}", clientId));
            envContent.AppendLine(string.Format("OWNER_DISCORD_ID={0}", ownerId));
            envContent.AppendLine();
            envContent.AppendLine("# ── Email / SMTP ──────────────────────────────────");
            envContent.AppendLine(string.Format("OWNER_EMAIL={0}", ownerEmail));
            envContent.AppendLine("SMTP_HOST=smtp.gmail.com");
            envContent.AppendLine("SMTP_PORT=587");
            envContent.AppendLine(string.Format("SMTP_USER={0}", smtpUser));
            envContent.AppendLine(string.Format("SMTP_PASS={0}", smtpPass));
            envContent.AppendLine();
            envContent.AppendLine("# ── VoiceVox (TTS Engine) ─────────────────────────");
            envContent.AppendLine("VOICEVOX_URL=http://localhost:50021");
            envContent.AppendLine("VOICEVOX_SPEAKER=3");

            File.WriteAllText(envPath, envContent.ToString());
            Console.WriteLine("ファイルを作成しました！\n");

            // 5. パッケージのインストールとコマンド登録
            Console.WriteLine("[4/4] ボットの依存パッケージをインストール中... (数分かかる場合があります)");
            int npmInstallResult = RunCommandWait("npm", "install", targetDir);
            if (npmInstallResult != 0)
            {
                ErrorExit("パッケージのインストール(npm install)に失敗しました。Node.jsが正しく動作しているか確認してください。");
            }

            Console.WriteLine("\nDiscordにスラッシュコマンドを登録しています...");
            int deployResult = RunCommandWait("node", "deploy-commands.js", targetDir);
            if (deployResult != 0)
            {
                Console.WriteLine("警告: コマンドの登録に失敗しました。トークンやClient IDが間違っている可能性があります。");
                Console.WriteLine("後で手動で 'node deploy-commands.js' を実行して修正できます。");
            }

            // Create Launcher if not exists
            string launcherPath = Path.Combine(targetDir, "StartZundamon.exe");
            if (!File.Exists(launcherPath) && File.Exists(Path.Combine(targetDir, "Launcher.cs")))
            {
                Console.WriteLine("\nランチャー (StartZundamon.exe) をコンパイルしています...");
                string compilerPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\Framework64\v4.0.30319\csc.exe");
                if (File.Exists(compilerPath))
                {
                    RunCommandWait(compilerPath, "/out:StartZundamon.exe /nologo Launcher.cs", targetDir);
                }
            }

            Console.WriteLine("\n=================================================");
            Console.WriteLine(" 🎉 セットアップがすべて完了しました！");
            Console.WriteLine("=================================================");
            Console.WriteLine(string.Format("\nこれからは フォルダ「{0}」内の", targetDir));
            Console.WriteLine("【 StartZundamon.exe 】 をダブルクリックするだけでボットが起動します！");
            
            Console.WriteLine("\nエンターキーを押すと終了します...");
            CreateShortcut(targetDir);
            Console.ReadLine();
        }

        static void CreateShortcut(string targetDir)
        {
            try
            {
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                string shortcutPath = Path.Combine(desktopPath, "ずんだもんボット.lnk");
                string targetPath = Path.Combine(targetDir, "StartZundamon.exe");
                string iconPath = Path.Combine(targetDir, "zundamon-icon.ico");

                // PowerShell component for creating the shortcut
                string script = string.Format(
                    "$s=(New-Object -COM WScript.Shell).CreateShortcut('{0}');" +
                    "$s.TargetPath='{1}';" +
                    "$s.WorkingDirectory='{2}';" +
                    "$s.IconLocation='{3}';" +
                    "$s.Save()",
                    shortcutPath, targetPath, targetDir, iconPath
                );

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "powershell",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + script + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process.Start(psi).WaitForExit();
                Console.WriteLine("\n[🎉] デスクトップに「ずんだもんボット」のショートカットを作成しました！");
            }
            catch
            {
                // Non-critical failure
            }
        }

        static string PromptInput(string fieldName, string guide, string placeholder, bool optional = false)
        {
            Console.WriteLine(string.Format("\n▶ 【 {0} 】 の取得方法:", fieldName));
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(guide);
            Console.ResetColor();

            while (true)
            {
                if (optional)
                    Console.Write(string.Format("\n{0} を入力 (Enterでスキップ): ", fieldName));
                else
                    Console.Write(string.Format("\n{0} を入力してください (例: {1}): ", fieldName, placeholder));

                string _input = Console.ReadLine();
                string input = _input != null ? _input.Trim() : "";
                
                if (!string.IsNullOrEmpty(input) || optional)
                {
                    return input;
                }
                Console.WriteLine("※入力が必須の項目です。正しく入力してください。");
            }
        }

        static bool CheckCommand(string commandStr)
        {
            try
            {
                string[] parts = commandStr.Split(new[] { ' ' }, 2);
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = parts[0],
                        Arguments = parts.Length > 1 ? parts[1] : "",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    }
                };
                process.Start();
                process.WaitForExit();
                return process.ExitCode == 0;
            }
            catch
            {
                return false;
            }
        }

        static int RunCommandWait(string fileName, string arguments, string workingDirectory)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = fileName.EndsWith("npm") || fileName.EndsWith("npm.cmd") ? "cmd.exe" : fileName,
                    Arguments = (fileName == "npm" || fileName == "npm.cmd") ? string.Format("/c npm {0}", arguments) : arguments,
                    WorkingDirectory = workingDirectory,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                Process process = new Process { StartInfo = psi };

                // イベントハンドラを追加して出力をリアルタイムで表示
                process.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Console.WriteLine("  " + e.Data); };
                process.ErrorDataReceived += (s, e) => { 
                    if (!string.IsNullOrEmpty(e.Data)) {
                        if (e.Data.ToLower().Contains("warn") || e.Data.ToLower().Contains("deprecated") || e.Data.ToLower().Contains("cloning into"))
                            Console.WriteLine("  [情報] " + e.Data);
                        else
                            Console.WriteLine("  [エラー] " + e.Data);
                    }
                };

                process.Start();
                
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                process.WaitForExit();
                return process.ExitCode;
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("コマンド {0} '{1}' の実行中にエラーが発生しました: {2}", fileName, arguments, ex.Message));
                return -1;
            }
        }

        static bool VerifySupabase(string url, string key)
        {
            try
            {
                // Verify Tables exist
                string[] tables = { "guild_configs", "guild_analytics", "logs_v2", "user_presets", "music_lyrics" };
                foreach (var table in tables)
                {
                    string script = string.Format(
                        "$ProgressPreference = 'SilentlyContinue'; " +
                        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
                        "$headers = @{{ 'apikey'='{0}'; 'Authorization'='Bearer {0}' }}; " +
                        "$url = '{1}/rest/v1/{2}?limit=1'; " +
                        "try {{ $res = Invoke-WebRequest -Uri $url -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop; exit 0 }} catch {{ Write-Output $_.Exception.Response; Write-Output $_.Exception.Message; exit 1 }}",
                        key, url.TrimEnd('/'), table
                    );

                    string errorOutput;
                    if (!RunPowerShellExitCode(script, out errorOutput))
                    {
                        if (errorOutput.Contains("(401)"))
                        {
                            Console.WriteLine("  [検証失敗] 認証エラー (401 Unauthorized)。");
                            Console.WriteLine("  APIキー (service_role Key) が間違っているか、正しくコピーされていません。");
                            Console.WriteLine("  お手数ですが、インストーラーを(Ctrl+Cなどで)一度終了し、正しいキーで最初からやり直してください。");
                        }
                        else
                        {
                            Console.WriteLine(string.Format("  [検証失敗] テーブル '{0}' が見つかりません。詳細: {1}", table, errorOutput));
                        }
                        return false;
                    }
                }

                // Verify guild_configs has 'status' column
                string columnScript = string.Format(
                    "$ProgressPreference = 'SilentlyContinue'; " +
                    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
                    "$headers = @{{ 'apikey'='{0}'; 'Authorization'='Bearer {0}' }}; " +
                    "$url = '{1}/rest/v1/guild_configs?select=status&limit=1'; " +
                    "try {{ $res = Invoke-WebRequest -Uri $url -Headers $headers -Method Get -UseBasicParsing -ErrorAction Stop; exit 0 }} catch {{ Write-Output $_.Exception.Message; exit 1 }}",
                    key, url.TrimEnd('/')
                );
                
                string columnError;
                if (!RunPowerShellExitCode(columnScript, out columnError))
                {
                    Console.WriteLine("  [検証失敗] 'guild_configs' テーブルに 'status' カラムがありません。詳細: " + columnError);
                    return false;
                }

                return true;
            }
            catch
            {
                return false;
            }
        }

        static bool RunPowerShellExitCode(string script, out string errorOutput)
        {
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "powershell",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + script + "\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            var process = Process.Start(psi);
            string output = process.StandardOutput.ReadToEnd();
            string err = process.StandardError.ReadToEnd();
            process.WaitForExit();
            errorOutput = (output + "\n" + err).Trim();
            return process.ExitCode == 0;
        }

        static string FindVoicevoxPath()
        {
            try
            {
                // 1. Check Registry (HKCU and HKLM)
                string[] registryPaths = {
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
                };
                Microsoft.Win32.RegistryKey[] roots = { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine };

                foreach (var root in roots)
                {
                    foreach (var path in registryPaths)
                    {
                        using (Microsoft.Win32.RegistryKey key = root.OpenSubKey(path))
                        {
                            if (key == null) continue;
                            foreach (string subkeyName in key.GetSubKeyNames())
                            {
                                using (Microsoft.Win32.RegistryKey subkey = key.OpenSubKey(subkeyName))
                                {
                                    if (subkey == null) continue;
                                    string displayName = subkey.GetValue("DisplayName") as string;
                                    if (displayName != null && displayName.IndexOf("VOICEVOX", StringComparison.OrdinalIgnoreCase) >= 0)
                                    {
                                        string installDir = subkey.GetValue("InstallLocation") as string;
                                        if (!string.IsNullOrEmpty(installDir) && File.Exists(Path.Combine(installDir, "VOICEVOX.exe")))
                                            return Path.Combine(installDir, "VOICEVOX.exe");

                                        // fallback to display icon path if install location is empty
                                        string iconPath = subkey.GetValue("DisplayIcon") as string;
                                        if (!string.IsNullOrEmpty(iconPath))
                                        {
                                            string cleanPath = iconPath.Split(',')[0].Trim('"');
                                            if (File.Exists(cleanPath)) return cleanPath;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Check default paths
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string defaultPath = Path.Combine(localAppData, @"Programs\VOICEVOX\VOICEVOX.exe");
                if (File.Exists(defaultPath)) return defaultPath;

                // 3. Check if process is already running
                Process[] procs = Process.GetProcessesByName("VOICEVOX");
                if (procs.Length > 0)
                {
                    try { return procs[0].MainModule.FileName; } catch { }
                }
            }
            catch { }
            return null;
        }

        static void ErrorExit(string message)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("\n[エラー] " + message);
            Console.ResetColor();
            Console.WriteLine("エンターキーを押して終了します...");
            Console.ReadLine();
            Environment.Exit(1);
        }

        static void PrintAsciiArt()
        {
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine(@"
 #######  #     #  #     #  ######    ###    #     #  #######  #     # 
      #   #     #  ##    #  #     #  #   #   ##   ##  #     #  ##    # 
     #    #     #  # #   #  #     #  #   #   # # # #  #     #  # #   # 
    #     #     #  #  #  #  #     #  #####   #  #  #  #     #  #  #  # 
   #      #     #  #   # #  #     #  #   #   #     #  #     #  #   # # 
  #       #     #  #    ##  #     #  #   #   #     #  #     #  #    ## 
 #######   #####   #     #  ######   #   #   #     #  #######  #     # 
");
            Console.ResetColor();
        }
    }
}
