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
            Console.WriteLine("OK: Node.js と Git がインストールされています。\n");

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

            string supabaseUrl = PromptInput(
                "Supabase プロジェクトURL",
                "1. https://supabase.com/dashboard にアクセスしてプロジェクトを作成（または選択）します。\n" +
                "2. 左メニューの下部「Project Settings (歯車アイコン)」を開きます。\n" +
                "3. 「API」メニューを選択します。\n" +
                "4. 「Project URL」の部分にあるURLをコピーして貼り付けてください。",
                "https://xyz.supabase.co"
            );

            string supabaseKey = PromptInput(
                "Supabase Service Role Key",
                "1. 上記と同じ「API」メニューページを開きます。\n" +
                "2. 「Project API keys」の表の中に「service_role」と書かれたキーがあります。\n" +
                "3. 目玉アイコンを押して表示し、その長い文字列をコピーして貼り付けてください。",
                "eyJh..."
            );

            string discordToken = PromptInput(
                "Discord Bot トークン",
                "1. https://discord.com/developers/applications にアクセスします。\n" +
                "2. 「New Application」からアプリを作成します（例: ずんだもんボット）。\n" +
                "3. 左メニューの「Bot」を開き、「Reset Token」をクリックします。\n" +
                "4. 表示された長い文字列をコピーして貼り付けてください。\n" +
                "注意: 同じページの下部にある「Message Content Intent」などを必ずオンにしてください！",
                "MTQ..."
            );

            string clientId = PromptInput(
                "Discord Client ID (Application ID)",
                "1. https://discord.com/developers/applications の対象アプリのページを開きます。\n" +
                "2. 左メニューの「General Information」を開きます。\n" +
                "3. 「APPLICATION ID」の横にある数字のみの文字列をコピーして貼り付けてください。",
                "148..."
            );

            string ownerId = PromptInput(
                "あなたの Discord ユーザーID",
                "1. Discordアプリを開き、左下の自分のアイコン横の歯車（ユーザー設定）を開きます。\n" +
                "2. 「詳細設定」から「開発者モード」をONにします。\n" +
                "3. チャット欄などで自分のアイコンを右クリックし、「ユーザーIDをコピー」を選択して貼り付けてください。",
                "915..."
            );

            // 4. .envファイルの生成
            string envPath = Path.Combine(targetDir, ".env");
            Console.WriteLine("\n[構成ファイルの作成] .env ファイルを作成しています...");
            
            StringBuilder envContent = new StringBuilder();
            envContent.AppendLine("# ── Required ─────────────────────────────────────");
            envContent.AppendLine();
            envContent.AppendLine("# ── Supabase (Required for Database/2FA) ─────────");
            envContent.AppendLine(string.Format("SUPABASE_URL={0}", supabaseUrl));
            envContent.AppendLine(string.Format("SUPABASE_KEY={0}", supabaseKey));
            envContent.AppendLine();
            envContent.AppendLine("# ── Discord ───────────────────────────────────────");
            envContent.AppendLine(string.Format("DISCORD_TOKEN={0}", discordToken));
            envContent.AppendLine(string.Format("CLIENT_ID={0}", clientId));
            envContent.AppendLine(string.Format("OWNER_DISCORD_ID={0}", ownerId));
            envContent.AppendLine();
            envContent.AppendLine("# ── Email / SMTP ──────────────────────────────────");
            envContent.AppendLine("OWNER_EMAIL=");
            envContent.AppendLine("SMTP_HOST=smtp.gmail.com");
            envContent.AppendLine("SMTP_PORT=587");
            envContent.AppendLine("SMTP_USER=");
            envContent.AppendLine("SMTP_PASS=");
            envContent.AppendLine();
            envContent.AppendLine("# ── Ollama (Local AI) ─────────────────────────────");
            envContent.AppendLine("OLLAMA_URL=http://localhost:11434");
            envContent.AppendLine("OLLAMA_MODEL=qwen2.5:7b");
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
            Console.ReadLine();
        }

        static string PromptInput(string fieldName, string guide, string placeholder)
        {
            Console.WriteLine(string.Format("\n▶ 【 {0} 】 の取得方法:", fieldName));
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(guide);
            Console.ResetColor();

            while (true)
            {
                Console.Write(string.Format("\n{0} を入力してください (例: {1}): ", fieldName, placeholder));
                string _input = Console.ReadLine();
                string input = _input != null ? _input.Trim() : "";
                if (!string.IsNullOrEmpty(input))
                {
                    return input;
                }
                Console.WriteLine("※入力が空です。正しく入力してください。");
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
                process.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Console.WriteLine("  [ERROR] " + e.Data); };

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
