// src/ai.js
// Handles LLM (Ollama) locally for text corrections

import 'dotenv/config';
import { saveMessage, getRecentHistory } from './db.js';
import { getGuildConfig } from './config.js';
import { logToSupabase } from './db_supabase.js';
import { incrementCounter } from './stats.js';
import { getBotConfig } from './botConfig.js';
import { Ollama } from 'ollama';

function getOllamaModel() {
  return getBotConfig('OLLAMA_MODEL', process.env.OLLAMA_MODEL || 'qwen2.5:7b');
}

function getOllamaUrl() {
  return getBotConfig('OLLAMA_URL', process.env.OLLAMA_URL || 'http://localhost:11434');
}

function getOllamaClient() {
  return new Ollama({ host: getOllamaUrl() });
}

const activeGuildControllers = new Map();

export function cancelAiGeneration(guildId) {
  if (activeGuildControllers.has(guildId)) {
    activeGuildControllers.get(guildId).abort();
    activeGuildControllers.delete(guildId);
    console.log(`[AI] Generation cancelled for guild ${guildId}`);
  }
}



/**
 * Uses a fast direct Ollama call to correct misrecognized proper nouns.
 */
export async function correctProperNouns(guildId, text, userId = null) {
  try {
    console.log(`[G:${guildId}] [SYS] Correcting punctuation/nouns (LLM) - Input: "${text}"${userId ? ` (User: ${userId})` : ''}`);
    logToSupabase(guildId, 'sys', `Correcting text (LLM)${userId ? ` (User: ${userId})` : ''}`);

    const response = await getOllamaClient().chat({
      model: getOllamaModel(),
      messages: [
        {
          role: 'system',
          content: `あなたはテキスト校正専門AIです。
以下のルールに厳密に従ってください：
1. カタカナで書かれた固有名詞を修正せよ。
2. 修正が不要な場合は、入力をそのまま返せ。
3. 説明や注釈は一切不要。修正後のテキストのみを出力せよ。`
        },
        { role: 'user', content: text }
      ],
      options: { temperature: 0.1, num_predict: 256 }
    });

    const corrected = response.message?.content?.trim();
    if (!corrected || corrected.length < text.length * 0.3 || corrected.length > text.length * 3) return text;
    return corrected;
  } catch (err) {
    console.error(`[AI] Error in correctProperNouns:`, err.message);
    return text;
  }
}
