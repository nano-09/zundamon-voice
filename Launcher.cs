using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class Program
{
    static void Main(string[] args)
    {
        string currentDir = AppDomain.CurrentDomain.BaseDirectory;
        Console.WriteLine("Starting Zundamon Dashboard Ecosystem...");

        // 1. Start Ollama (minimized)
        try {
            Process.Start(new ProcessStartInfo {
                FileName = "ollama",
                Arguments = "serve",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Minimized
            });
            Console.WriteLine("[OK] Started Ollama.");
        } catch {}


        // 2. Start Voicevox (minimized)
        string voicevoxPath = @"F:\Voicevox\VOICEVOX.exe";
        try {
            if (File.Exists(voicevoxPath)) {
                Process.Start(new ProcessStartInfo {
                    FileName = voicevoxPath,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Minimized
                });
                Console.WriteLine("[OK] Started VOICEVOX.");
            }
        } catch {}

        // 3. Start Dashboard Server (named window for reliable shutdown)
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
    }
}
