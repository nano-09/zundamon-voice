using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Net;

class Program
{
    static void Main(string[] args)
    {
        string currentDir = AppDomain.CurrentDomain.BaseDirectory;
        Console.WriteLine("Starting Zundamon Dashboard Ecosystem...");

        // Check if dashboard is already responding (suggests it's already running)
        bool isDashboardRunning = false;
        try {
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString("http://localhost:3000/api/guilds");
                isDashboardRunning = true;
            }
        } catch {}

        if (isDashboardRunning) {
            Console.WriteLine("========================================================");
            Console.WriteLine("Zundamon Bot is already running!");
            Console.WriteLine("If you want to restart it, please run ShutdownZundamon.bat first.");
            Console.WriteLine("========================================================");
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
            return;
        }

        // 1. Start Voicevox (minimized)
        string voicevoxPath = FindVoicevoxPath();
        try {
            if (!string.IsNullOrEmpty(voicevoxPath) && File.Exists(voicevoxPath)) {
                Process.Start(new ProcessStartInfo {
                    FileName = voicevoxPath,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Minimized
                });
                Console.WriteLine("[OK] Started VOICEVOX: " + voicevoxPath);
            } else {
                Console.WriteLine("[WARN] VOICEVOX was not found automatically. Please start it manually.");
            }
        } catch {}

        // 2. Start Dashboard Server (only if not already running)
        if (!isDashboardRunning) {
            try {
                ProcessStartInfo dashboardInfo = new ProcessStartInfo {
                    FileName = "cmd.exe",
                    Arguments = "/c title Zundamon Dashboard && node dashboard/server.js",
                    WorkingDirectory = currentDir,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Normal
                };
                Process.Start(dashboardInfo);
                Console.WriteLine("[OK] Started Web Dashboard Server.");
            } catch {}

            Console.WriteLine("Opening browser in 2 seconds...");
            Thread.Sleep(2000); // Give server a second to boot

            // 4. Open Browser to Dashboard
            try {
                Process.Start(new ProcessStartInfo {
                    FileName = "http://localhost:3000",
                    UseShellExecute = true
                });
                Console.WriteLine("[OK] Opened Dashboard in Browser.");
            } catch {}
        } else {
            Console.WriteLine("[SKIP] Dashboard is already listening on port 3000. Not opening browser again.");
        }
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
}
