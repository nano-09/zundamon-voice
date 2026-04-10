using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static void Main(string[] args)
    {
        Console.Title = "Zundamon Silent Shutdown";
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("===================================================");
        Console.WriteLine("    Gracefully shutting down all services...       ");
        Console.WriteLine("===================================================");
        Console.ResetColor();

        // 1. Stop Node.js processes (Dashboard & Bot)
        Console.WriteLine("[1/3] Closing Dashboard and Discord Bot...");
        KillProcess("node");

        // 2. Stop Ollama
        Console.WriteLine("[2/3] Closing Ollama...");
        KillProcess("ollama");
        KillProcess("ollama_app");

        // 3. Stop Voicevox
        Console.WriteLine("[3/3] Closing VOICEVOX...");
        KillProcess("VOICEVOX");

        Console.WriteLine("\n---------------------------------------------------");
        Console.WriteLine("Cleanly exited all Zundamon components!");
        Console.WriteLine("---------------------------------------------------");
        
        // Wait a bit before closing
        Thread.Sleep(2000);
    }

    static void KillProcess(string name)
    {
        try
        {
            Process[] processes = Process.GetProcessesByName(name);
            foreach (var p in processes)
            {
                try
                {
                    // For Node.js, we try to kill the whole tree if possible
                    p.Kill();
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  [!] Failed to kill {0}: {1}", name, ex.Message);
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("  [!] Error searching for {0}: {1}", name, ex.Message);
        }
    }
}
