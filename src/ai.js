// src/ai.js
// Handles LLM (Ollama) locally for search and corrections

import 'dotenv/config';
import { saveMessage, getRecentHistory } from './db.js';
import { getGuildConfig } from './config.js';
import { initMcpClient, callMcpTool } from './mcpClient.js';
import { logToSupabase } from './db_supabase.js';
import { incrementCounter } from './stats.js';
import { getBotConfig } from './botConfig.js';
import { Ollama } from 'ollama';

const OLLAMA_MODEL = getBotConfig('OLLAMA_MODEL', 'qwen2.5:7b');
const OLLAMA_URL = getBotConfig('OLLAMA_URL', 'http://localhost:11434');
const ollama = new Ollama({ host: OLLAMA_URL });
const activeGuildControllers = new Map();

export function cancelAiGeneration(guildId) {
  if (activeGuildControllers.has(guildId)) {
    activeGuildControllers.get(guildId).abort();
    activeGuildControllers.delete(guildId);
    console.log(`[AI] Generation cancelled for guild ${guildId}`);
  }
}

// ── Built-in Web Search (MCP) ──────────────────────────────────────────
/**
 * Uses the open-websearch MCP Server to fetch structured web results.
 * @param {string} query
 * @returns {Promise<{text: string, urls: string[]}>}
 */
export async function searchWeb(guildId, query, userId = null, maxResults = 5) {
  try {
    console.log(`[G:${guildId}] [SYS] Searching the web for: "${query}"${userId ? ` (User: ${userId})` : ''}`);
    logToSupabase(guildId, 'sys', `Searching web: ${query}${userId ? ` (User: ${userId})` : ''}`);

    // Ensure MCP client is running
    await initMcpClient();

    // Call the "search" tool from open-websearch
    const result = await callMcpTool('search', {
      query: query,
      limit: 10,
      engines: ['duckduckgo']
    });

    if (!result || !result.content || result.content.length === 0) {
      console.log(`[Search] No content returned from MCP.`);
      return { text: '', urls: [] };
    }

    const jsonString = result.content[0].text;
    let items;
    try {
      items = JSON.parse(jsonString);
    } catch (e) {
      console.error(`[Search] Failed to parse MCP response as JSON.`);
      return { text: '', urls: [] };
    }

    if (!Array.isArray(items)) {
      if (items && Array.isArray(items.results)) items = items.results;
      else if (items && Array.isArray(items.data)) items = items.data;
      else return { text: '', urls: [] };
    }

    const compiledResults = [];
    const uniqueUrls = [];

    const filteredItems = items.filter(item => {
      const desc = (item.description || '').toLowerCase();
      return !desc.includes('javascript is disabled') && !desc.includes("site won't allow us");
    });

    const finalItems = (filteredItems.length >= 3) ? filteredItems : items;

    for (const item of finalItems.slice(0, maxResults)) {
      if (!item.url || uniqueUrls.includes(item.url)) continue;
      uniqueUrls.push(item.url);
      
      const title = item.title || 'No Title';
      const description = item.description || '(No description available)';
      compiledResults.push(`### ${title}\n${description}\nSource: ${item.url}`);
    }

    return { text: compiledResults.join('\n\n'), urls: uniqueUrls };
  } catch (error) {
    console.error(`[Search] MCP tool call failed:`, error);
    return { text: '', urls: [] };
  }
}

/**
 * Uses a fast direct Ollama call to correct misrecognized proper nouns.
 */
export async function correctProperNouns(guildId, text, userId = null) {
  try {
    console.log(`[G:${guildId}] [SYS] Correcting punctuation/nouns (LLM) - Input: "${text}"${userId ? ` (User: ${userId})` : ''}`);
    logToSupabase(guildId, 'sys', `Correcting text (LLM)${userId ? ` (User: ${userId})` : ''}`);

    const response = await ollama.chat({
      model: OLLAMA_MODEL,
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
    return text;
  }
}

/**
 * Generates a context-aware search query.
 */
export async function generateSearchQuery(guildId, text, history) {
  if (!history || history.length === 0) return text;

  try {
    console.log(`[G:${guildId}] [SYS] Analyzing search intent...`);
    let historyText = history.map(m => {
      let role = m.role === 'assistant' ? 'ずんだもん' : 'ユーザー';
      return `${role}: ${m.content.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()}`;
    }).join('\n');

    const prompt = `直近の会話履歴と最新の発言から、最適な検索キーワードのみを出力してください。\n\n【履歴】\n${historyText}\n\n【最新】\n${text}\n\n【回答】`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: prompt, stream: false, options: { temperature: 0.1 } })
    });

    if (response.ok) {
      const data = await response.json();
      let query = data.response?.trim();
      query = query.replace(/[。、！\?\?？]|(をおしえて|について|の最新)|です|ます/g, '').trim();
      if (query) return query;
    }
  } catch (err) {}
  return text;
}

/**
 * Helper to clean AI response.
 */
function cleanAiReply(reply) {
  let cleaned = reply;
  if (cleaned.includes('</thought>')) {
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim() || cleaned.replace(/<\/?thought>/gi, '').trim();
  } else {
    cleaned = cleaned.replace(/<thought>/gi, '').trim();
  }
  return cleaned.replace(/^(thought[：:：]|ずんだもん[：:：]|回答[：:：]|答え[：:：])/gi, '').trim();
}

/**
 * Processes a text-based search command (/search).
 */
export async function processSearchCommand(guildId, userId, text) {
  try {
    const correctedText = await correctProperNouns(guildId, text, userId).catch(() => text);
    const history = await getRecentHistory(guildId, 6);
    let searchQuery = await generateSearchQuery(guildId, correctedText, history).catch(() => correctedText);
    searchQuery += ' reddit twitter youtube';

    const searchResults = await searchWeb(guildId, searchQuery, userId);
    const searchContext = searchResults.text ? `\n\n【ウェブ検索結果】\n${searchResults.text}` : '';

    const { emitLiveSnapshot, broadcastStats } = await import('./index.js');
    incrementCounter(guildId, 'ai_queries');
    emitLiveSnapshot(guildId, { ai_queries: 1 });
    broadcastStats();

    const messages = [
      {
        role: 'system',
        content: `# あなたは「ずんだもん」なのだ。
一人称は「ボク」。文末は必ず「なのだ」「なのだ！」なのだ。
提供された検索結果を最優先して1〜3文で簡潔に回答するのだ。丸投げは禁止なのだ。`
      },
      ...history,
      {
        role: 'user',
        content: `「${correctedText}」${searchContext}`
      }
    ];

    if (activeGuildControllers.has(guildId)) activeGuildControllers.get(guildId).abort();
    const controller = new AbortController();
    activeGuildControllers.set(guildId, controller);

    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false, options: { temperature: 0.4 } })
      });
      if (!response.ok) throw new Error('Ollama error');
      const data = await response.json();
      let reply = cleanAiReply(data.message?.content || '');
      await saveMessage(guildId, userId, 'user', correctedText);
      await saveMessage(guildId, 'bot', 'assistant', reply);
      return { reply, urls: searchResults.urls };
    } finally {
      activeGuildControllers.delete(guildId);
    }
  } catch (err) {
    return { reply: 'ごめんなのだ、うまく検索できなかったのだ。', urls: [] };
  }
}