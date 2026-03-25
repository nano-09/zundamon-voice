// src/ai.js
// Handles STT (Whisper via @xenova/transformers) and LLM (Ollama) locally

import 'dotenv/config';
import { pipeline } from '@xenova/transformers';
import olla from 'ollama'; // Keep the original spelling in case
import { saveMessage, getRecentHistory } from './db.js';
import { getGuildConfig } from './config.js';
import { initMcpClient, callMcpTool } from './mcpClient.js';
import { logToSupabase } from './db_supabase.js';
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
async function searchWeb(guildId, query, maxResults = 5) {
  try {
    console.log(`[G:${guildId}] [BOT] Searching the web for: "${query}"`);
    logToSupabase(guildId, 'bot', `Searching web: ${query}`);

    // Ensure MCP client is running
    await initMcpClient();

    // Call the "search" tool from open-websearch
    const result = await callMcpTool('search', {
      query: query,
      limit: 10,
      engines: ['brave', 'duckduckgo'] // Brave often has better snippets than DDG
    });

    if (!result || !result.content || result.content.length === 0) {
      console.log(`[Search] No content returned from MCP.`);
      return { text: '', urls: [] };
    }

    // open-websearch returns a stringified JSON array (or object with results array)
    const jsonString = result.content[0].text;
    let items;
    try {
      items = JSON.parse(jsonString);
    } catch (e) {
      console.error(`[Search] Failed to parse MCP response as JSON. Raw text:`, jsonString);
      return { text: '', urls: [] };
    }

    // Safety check: sometimes search tools wrap results in an object or return an error object
    if (!Array.isArray(items)) {
      if (items && Array.isArray(items.results)) items = items.results;
      else if (items && Array.isArray(items.data)) items = items.data;
      else {
        console.log(`[Search] MCP did not return an array of results. Returned:`, items);
        return { text: '', urls: [] };
      }
    }

    if (!items || items.length === 0) {
      console.log(`[Search] Parsed MCP JSON was empty.`);
      return { text: '', urls: [] };
    }

    const compiledResults = [];
    const uniqueUrls = [];

    // Filter out "JavaScript is disabled" or "site won't allow us" filler results
    const filteredItems = items.filter(item => {
      const desc = (item.description || '').toLowerCase();
      return !desc.includes('javascript is disabled') && !desc.includes("site won't allow us");
    });

    // If filtering left us with too few results, keep some original results to avoid 0
    const finalItems = (filteredItems.length >= 3) ? filteredItems : items;

    for (const item of finalItems.slice(0, maxResults)) {
      if (!item.url || uniqueUrls.includes(item.url)) continue;
      uniqueUrls.push(item.url);
      
      const title = item.title || 'No Title';
      const description = item.description || '(No description available)';
      compiledResults.push(`### ${title}\n${description}\nSource: ${item.url}`);
    }

    if (compiledResults.length > 0) {
      return { text: compiledResults.join('\n\n'), urls: uniqueUrls };
    } else {
      return { text: '', urls: [] };
    }
  } catch (error) {
    console.error(`[Search] MCP tool call failed:`, error);
    return { text: '', urls: [] };
  }
}

/**
 * Uses a fast direct Ollama call to correct misrecognized proper nouns
 * (game titles, company names, etc.) from Whisper's transcription.
 * Returns the corrected transcription string.
 */
async function correctProperNouns(guildId, text) {
  try {
    console.log(`[G:${guildId}] [BOT] Correcting transcription...`);
    logToSupabase(guildId, 'bot', 'Correcting transcription (LLM)');

    const response = await ollama.chat({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: 'system',
          content: `あなたは音声認識の校正専門AIです。入力はWhisperの音声認識結果です。
以下のルールに厳密に従ってください：

1. カタカナで書かれた固有名詞（ゲーム名、会社名、キャラクター名、ブランド名など）が間違っていないか確認せよ。
2. 間違っている場合、正しい表記に修正せよ。例:
   - ホヨバース → HoYoverse
   - ゲンシンインパクト → 原神
   - マイクロソフト → Microsoft
   - ニンテンドー → Nintendo
   - フォートナイト → Fortnite
   - エーペックス → Apex Legends
   - バロラント → VALORANT
3. 修正が不要な場合は、入力をそのまま返せ。
4. 説明や注釈は一切不要。修正後のテキストのみを出力せよ。
5. 固有名詞以外の部分は絶対に変更するな。`
        },
        {
          role: 'user',
          content: text
        }
      ],
      options: {
        temperature: 0.1,  // Very low temperature for precise corrections
        num_predict: 256,   // Keep it short and fast
      }
    });

    const corrected = response.message?.content?.trim();

    // Safety: if corrected text is empty or drastically different in length, keep original
    if (!corrected || corrected.length < text.length * 0.3 || corrected.length > text.length * 3) {
      console.log(`[TermCorrector] Correction rejected (safety check). Keeping original.`);
      return text;
    }

    if (corrected !== text) {
      console.log(`[TermCorrector] Corrected: "${text}" → "${corrected}"`);
    } else {
      console.log(`[TermCorrector] No corrections needed.`);
    }

    return corrected;
  } catch (err) {
    console.warn(`[TermCorrector] Ollama correction failed (non-fatal):`, err.message);
    return text; // Fallback: return original text if Ollama is unreachable
  }
}

/**
 * Generates a context-aware search query.
 * If the user's input is a follow-up to the conversation, it combines the context.
 * If it's a new topic, it extracts just the new query.
 * @param {string} transcription - The user's input
 * @param {Array} history - The recent conversation history
 * @returns {Promise<string>} The optimized search query
 */
async function generateSearchQuery(guildId, transcription, history) {
  if (!history || history.length === 0) return transcription;

  try {
    console.log(`[G:${guildId}] [BOT] Analyzing search intent...`);
    logToSupabase(guildId, 'bot', 'Analyzing search intent (LLM)');
    // Format history for the prompt
    let historyText = history.map(m => {
      let role = m.role === 'assistant' ? 'ずんだもん' : 'ユーザー';
      return `${role}: ${m.content.replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<\/?thought>/gi, '').trim()}`;
    }).join('\n');

    const prompt = `あなたは検索クエリ最適化のスペシャリストです。
直近の会話履歴とユーザーの最新の発言から、ウェブ検索（GoogleやBing）で最新情報を得るための「最適な検索キーワード」だけを出力してください。

【ルール】
1. 出力は「検索キーワードのみ」とし、挨拶、説明、句読点、丁寧語（〜について、〜を教えて等）は一切含めないでください。
2. ユーザーの発言が文脈依存（「それについて」「最新のは？」等）な場合は、履歴から主語を補完してください。
3. 言語は日本語を優先しつつ、ゲーム名などは英語（VALORANT, Apex等）を適宜混ぜてください。
4. キーワードはスペース区切りで最大4つ程度に絞ってください。

【会話履歴】
${historyText}

【ユーザーの最新の発言】
${transcription}

【出力例】
VALORANT 最新 パッチノート
原神 新キャラ 性能
プロ野球 速報 結果

【検索キーワード】`;

    // console.log(`[SearchQuery] Requesting contextual rewrite for: "${transcription}"`);
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: { temperature: 0.1 }
      })
    });

    if (response.ok) {
      const data = await response.json();
      let query = data.response?.trim();
      // Clean up in case the LLM ignored instructions
      query = query.replace(/^検索キーワード[:：\s]*/gi, '');
      // Strip common conversational fluff that breaks search
      query = query.replace(/[。、！\?\?？]|(をおしえて|について|の最新)|です|ます/g, '').trim();
      
      if (query && query.length > 0) {
        console.log(`[SearchQuery] Contextual keywords generated: "${query}"`);
        return query;
      }
    }
  } catch (err) {
    console.error('[SearchQuery] Error generating contextual query:', err.message);
  }

  // Fallback to original
  return transcription;
}

// ── Shared Whisper Pipeline ──────────────────────────────────────────────────
let whisperPipe = null;
let whisperReady = false;
let whisperReadyCallback = null;

/**
 * Preloads the Whisper model in the background.
 */
export async function preloadWhisper() {
  if (whisperPipe) return;
  console.log('[Whisper] Loading model (Xenova/whisper-small)... This may take a moment on first run.');
  try {
    // whisper-small is much more accurate for Japanese than whisper-tiny,
    // while still being fast enough for near-real-time conversation (~244MB).
    whisperPipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
      device: 'cpu', // Use 'webgpu' or 'cuda' if supported/needed
      quantized: true, // Forces 8-bit quantized ONNX model for low RAM usage and high speed
    });
    whisperReady = true;
    console.log('[Whisper] Model loaded and ready.');
    if (whisperReadyCallback) {
      whisperReadyCallback();
    }
  } catch (err) {
    console.error('[Whisper] Failed to load model:', err);
  }
}

export function isWhisperReady() {
  return whisperReady;
}

export function onWhisperReady(callback) {
  if (whisperReady) {
    callback();
  } else {
    whisperReadyCallback = callback;
  }
}

/**
 * Detects if the transcription is likely a Whisper "hallucination" (common with silence).
 */
function isHallucination(text) {
  if (!text) return true;

  // Clean the text for checking: remove brackets/parentheses and their contents
  // Whisper often outputs [Music], (Laughter), or halluncinated tags like (サイズ)
  let clean = text.replace(/[\[\(\（\【](.*?)[\]\)\）\】]/g, '').trim();

  const t = clean.toLowerCase();

  // List of common hallucinations for Whisper-tiny on background noise/silence
  const hallucinations = [
    'thank you.', 'thanks for watching.', 'subtitles by', 'translated by',
    'you', 'go', 'oh', 'bye', 'peace', 'goodbye', 'hello',
    '視聴ありがとうございました', 'ご視聴ありがとうございました', 'チャンネル登録',
    'サイズ', // specifically requested by user
  ];

  if (hallucinations.some(h => t.includes(h))) return true;
  if (t.length <= 1 && clean.length <= 1) return true;

  // Check for "special characters" that shouldn't be in normal speech.
  // We ignore characters that aren't Alphanumeric, Japanese, or standard punctuation.
  // Allowed: a-z, A-Z, 0-9, \s, Japanese ranges, and Japanese/English punctuation.
  const hasSpecialChar = /[^a-zA-Z0-9\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF66-\uFF9F\.,!\?\?！？。、\(\)\（\）\[\]\「\」]/.test(text);
  if (hasSpecialChar) {
    console.log('[Whisper] Special character detected, ignoring:', text);
    return true;
  }

  // Check for highly repetitive text (common Whisper hallucination loop)
  // e.g., "また終わりたいし、また終わりたいし、また終わりたいし..."
  // Looks for any sequence of 4 or more characters that repeats at least 3 times consecutively.
  const repetitiveRegex = /(.{4,})\1{2,}/;
  if (repetitiveRegex.test(clean)) {
    console.log('[Whisper] Repetitive hallucination detected, ignoring:', text);
    return true;
  }

  return false;
}

/**
 * Processes incoming PCM audio (48kHz stereo Int16) and returns AI reply.
 * @param {Buffer} pcmBuffer
 * @param {string} guildId
 * @param {string} userId
 */
export async function processAudioLocally(pcmBuffer, guildId, userId) {
  if (!whisperPipe) {
    console.warn('[Whisper] processAudioLocally called but pipeline not loaded.');
    return null;
  }

  // ── Step 1: Transcribe with Whisper ────────────────────────────────────────
  // Convert 48kHz Stereo Int16 -> 16kHz Mono Float32
  const DOWNSAMPLE_RATIO = 3; // 48000 / 16000
  const bytesPerStereoSample = 4; // 2 channels * 2 bytes (Int16)
  const outputLength = Math.floor(pcmBuffer.length / (DOWNSAMPLE_RATIO * bytesPerStereoSample));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * DOWNSAMPLE_RATIO * bytesPerStereoSample;
    // Average left and right channels, normalize to [-1, 1]
    const left = pcmBuffer.readInt16LE(srcIdx) / 32768.0;
    const right = pcmBuffer.readInt16LE(srcIdx + 2) / 32768.0;
    output[i] = (left + right) / 2;
  }

  const transcribed = await whisperPipe(output, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: 'japanese',
    task: 'transcribe',
    // Bias the decoder toward natural Japanese conversation.
    // This significantly reduces English hallucinations and improves accuracy.
    initial_prompt: 'こんにちは、今日はいい天気ですね。ずんだもんと話しています。',
  });

  let transcription = transcribed.text.trim();
  if (!transcription) return null;

  // ── Step 1.5: Custom Dictionary Correction ─────────────────────────────
  const cfg = getGuildConfig(guildId);
  if (cfg.whisperDict) {
    for (const [bad, good] of Object.entries(cfg.whisperDict)) {
      // Create a global Regex pattern ignoring special regex chars
      const escapedBad = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      transcription = transcription.replace(new RegExp(escapedBad, 'g'), good);
    }
  }

  // ── Step 2: Hallucination filter ────────────────────────────────────────────
  if (isHallucination(transcription)) {
    console.log('[Whisper] Hallucination detected, ignoring:', transcription);
    return null;
  }

  // ── Step 3: Japanese-only filter ────────────────────────────────────────────
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF65-\uFF9F]/.test(transcription);
  if (!hasJapanese) {
    console.log('[Whisper] No Japanese detected, ignoring:', transcription);
    return null;
  }

  // ── Step 3.5: Smart Term Correction (via Ollama) ───────────────────────────
  // Uses a fast local Ollama call to identify and correct garbled proper nouns
  // (game names, company names, etc.) for accurate web search.
  const correctedTranscription = await correctProperNouns(guildId, transcription);

  // ── Step 3.6: Generate Context-Aware Search Query ───────────────────────────
  // 過去の引きずりを減らし、話題転換しやすくするため、履歴は直近6件（3ターン）に制限
  const history = await getRecentHistory(guildId, 6);
  let searchQuery = await generateSearchQuery(guildId, correctedTranscription, history);

  // We append social media priorities as keywords rather than strict 'site:' operators
  // search tools in MCP often handle keywords like 'reddit' or 'twitter' better than 'site:x.com'
  searchQuery += ' reddit twitter youtube';

  // ── Step 3.7: Search the web ────────────────────────────────────────────────
  const searchResults = await searchWeb(guildId, searchQuery);
  const searchContext = searchResults.text
    ? `\n\n【重要なウェブ検索結果（絶対にこの情報を最優先して回答の根拠にすること）】\n${searchResults.text}`
    : '';

  // ── Step 4: Generate reply ──────────────────────────────────────────────────
  try {
    const messages = [
      {
        role: 'system',
        content: `# 絶対命令：あなたは「ずんだもん」以外の何者でもない。

あなたは東北地方の妖精「ずんだもん」。ずんだ餅の精霊。少し生意気だけど憎めない元気なボクっ娘。

## 現在時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

## ルール（一つでも違反したら失格）

### 語尾ルール
- 全ての文の末尾は必ず「なのだ」「のだ」「なのだ！」「なのだ？」のいずれか。
- 一人称は「ボク」のみ。
- 以下の語尾は絶対禁止：です、ます、だよ、だね、でしょう、ですね、かも、よね、のん

❌ 悪い例：「確認するのが一番だよ！」「チェックしてみるといいかも〜」
✅ 正しい例：「ボクが教えてやるのだ！」「最新情報はこうなのだ！」

### 情報提供ルール（最重要）
- ユーザーの質問には必ず具体的な情報で答えること。
- 【超重要】最新のウェブ検索結果が提供された場合は、**過去の会話の流れを無視してでも、検索結果の内容を最優先**して回答すること。
- 以下のフレーズは絶対禁止：
  「自分で調べて」「公式サイトを見て」「チェックしてみて」「確認して」「〜で確認するのが一番」「〜を見るといい」
- 検索結果から得た情報を自分の言葉で直接伝えること。

❌ 悪い例：「公式Discordチャンネルで確認するのが一番だよ！」
✅ 正しい例：「検索した結果によると、ばろらんとでは最近新しいエージェントが追加されたみたいなのだ！あと新マップも来たのだ！」

### 出力言語ルール（音声合成用・超重要）
- 回答は100%ひらがな・カタカナ・漢字のみ。アルファベットと数字は一切禁止。
- 全ての固有名詞はひらがなで書く：
  VALORANT→ばろらんと、Discord→でぃすこーど、YouTube→ゆーちゅーぶ、
  Google→ぐーぐる、Twitter→ついったー、Fortnite→ふぉーとないと、
  Apex Legends→えーぺっくすれじぇんず、Microsoft→まいくろそふと、
  Nintendo→にんてんどー、iPhone→あいふぉん、Amazon→あまぞん、
  HoYoverse→ほよばーす、Steam→すちーむ、PlayStation→ぷれいすてーしょん
- **数字は半角英数（例: 2024, 100）を使用してOK。**
- 以下の語尾、単語、表現は絶対禁止：
  「自分で調べて」「公式サイトを見て」「チェックしてみて」「確認して」「〜で確認するのが一番」「〜を見るといい」
  です、ます、だよ、だね、でしょう、ですね、かも、よね、のん

❌ 悪い例：「VALORANTの最新情報は...」
✅ 正しい例：「ばろらんとの最新情報は...なのだ！」

### 思考プロセス
- 回答前に<thought>タグ内で自由に思考せよ（言語・形式自由）。
- <thought>タグの外だけがずんだもんとして読み上げられる。
- 1〜3文の簡潔な回答にすること。
- **重要**: 回答の中に英語（アルファベット）が残っていると読み上げエラーになるため、全ての単語を必ずひらがな・カタカナ・漢字に変換すること。特に未定義の専門用語も、聞こえ通りに「ひらがな」で書くこと。`,
      },
      ...history,
      {
        role: 'user',
        content: `以下の質問に対し、提供された検索結果を必ず最優先して回答せよ。推測より検索結果を優先すること。<thought>タグで思考後、ずんだもん口調で回答。語尾は「なのだ」。固有名詞はひらがな。情報は直接伝える。\n\nユーザーの質問：「${correctedTranscription}」${searchContext}`,
      },
    ];

    let reply = '';

    // ── LLM: Direct Ollama ──────────────────────────────────────────────────
    console.log(`[G:${guildId}] [BOT] Thinking...`);
    logToSupabase(guildId, 'bot', 'Thinking...');
    console.log(`[AI] Original: "${transcription}" → Corrected: "${correctedTranscription}"`);
    if (searchResults.text) console.log(`[AI] Search context injected (${searchResults.text.split('\n').length} results)`);

    if (activeGuildControllers.has(guildId)) {
      activeGuildControllers.get(guildId).abort();
    }

    const controller = new AbortController();
    activeGuildControllers.set(guildId, controller);

    let response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: messages,
          stream: false,
          options: { temperature: 0.4 }
        })
      });
    } finally {
      activeGuildControllers.delete(guildId);
    }

    if (!response.ok) {
      throw new Error(`Ollama API HTTP ${response.status}`);
    }

    const data = await response.json();
    reply = data.message?.content || '';

    console.log(`[AI] Raw Reply: "${reply.replace(/\n/g, '\\n')}"`);

    // ── Step 5: Clean Response ────────────────────────────────────────────────
    // 1. Strip internal reasoning (thought tags)
    // If </thought> is present, strip everything between <thought> and </thought>.
    if (reply.includes('</thought>')) {
      let cleaned = reply.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

      // If the AI put its entire answer inside the thought block, cleaned will be empty.
      // In that case, we fallback to just stripping the HTML tags and reading the thought itself.
      if (!cleaned) {
        console.log('[Ollama] AI generated no text outside <thought>. Using thought content as fallback.');
        cleaned = reply.replace(/<\/?thought>/gi, '').trim();
      }
      reply = cleaned;
    } else if (reply.includes('<thought>')) {
      // If closing tag is missing, just strip the opening tag to salvage the text.
      // (The AI probably forgot to close it and just wrote the answer)
      reply = reply.replace(/<thought>/gi, '').trim();
    }

    // 2. Post-processing: Force hiragana conversion & character enforcement
    const hiraganaMap = {
      'VALORANT': 'ばろらんと', 'Valorant': 'ばろらんと', 'valorant': 'ばろらんと',
      'Discord': 'でぃすこーど', 'discord': 'でぃすこーど', 'DISCORD': 'でぃすこーど',
      'YouTube': 'ゆーちゅーぶ', 'Youtube': 'ゆーちゅーぶ', 'youtube': 'ゆーちゅーぶ',
      'Google': 'ぐーぐる', 'google': 'ぐーぐる', 'GOOGLE': 'ぐーぐる',
      'Twitter': 'ついったー', 'twitter': 'ついったー', 'TWITTER': 'ついったー',
      'Fortnite': 'ふぉーとないと', 'fortnite': 'ふぉーとないと', 'FORTNITE': 'ふぉーとないと',
      'Microsoft': 'まいくろそふと', 'microsoft': 'まいくろそふと',
      'Nintendo': 'にんてんどー', 'nintendo': 'にんてんどー', 'NINTENDO': 'にんてんどー',
      'iPhone': 'あいふぉん', 'iphone': 'あいふぉん',
      'Amazon': 'あまぞん', 'amazon': 'あまぞん', 'AMAZON': 'あまぞん',
      'HoYoverse': 'ほよばーす', 'Hoyoverse': 'ほよばーす', 'hoyoverse': 'ほよばーす',
      'Steam': 'すちーむ', 'steam': 'すちーむ', 'STEAM': 'すちーむ',
      'PlayStation': 'ぷれいすてーしょん', 'Playstation': 'ぷれいすてーしょん',
      'Apex Legends': 'えーぺっくすれじぇんず', 'Apex': 'えーぺっくす', 'apex': 'えーぺっくす',
      'Riot Games': 'らいおっとげーむず', 'Riot': 'らいおっと',
      'Epic Games': 'えぴっくげーむず',
      'Twitch': 'とぅいっち', 'twitch': 'とぅいっち',
      'Reddit': 'れでぃっと', 'reddit': 'れでぃっと',
      'Instagram': 'いんすたぐらむ', 'instagram': 'いんすたぐらむ',
      'TikTok': 'てぃっくとっく', 'tiktok': 'てぃっくとっく',
      'Patch': 'ぱっち', 'patch': 'ぱっち', 'PATCH': 'ぱっち',
      'Notes': 'のーと', 'notes': 'のーと',
      'Client': 'くらいあんと', 'client': 'くらいあんと',
      'Update': 'あっぷでーと', 'update': 'あっぷでーと',
      'News': 'にゅーす', 'news': 'にゅーす',
      'Event': 'いべんと', 'event': 'いべんと',
      'PC': 'ぴーしー', 'Mobile': 'もばいる', 'mobile': 'もばいる',
      'X': 'えっくす',
    };
    for (const [eng, hira] of Object.entries(hiraganaMap)) {
      reply = reply.split(eng).join(hira);
    }

    // Strip only very small English artifacts or specific leftover technical junk symbols.
    // We avoid stripping all [a-zA-Z]+ because that deletes words we forgot to map.
    // Instead, we trust the LLM's system prompt more now.
    reply = reply.replace(/\b[a-zA-Z]{1,2}\b/g, '').replace(/\s{2,}/g, ' ');

    // Strip common prefixes/suffixes
    reply = reply
      .replace(/^(thought[：:：]|ずんだもん[：:：]|回答[：:：]|答え[：:：])/gi, '')
      .replace(/^(「|『)(.*)(」|』)$/s, '$2')
      .replace(/(僕は|ボクは)?ずんだもんなのだ[！!。]*$/g, '')
      .replace(/\{[\s\S]*?\}/g, '')
      .trim();

    if (!reply) {
      return { transcription, reply: '……なのだ？' };
    }

    await saveMessage(guildId, userId, 'user', correctedTranscription);
    await saveMessage(guildId, 'bot', 'assistant', reply);

    return { transcription: correctedTranscription, reply, urls: searchResults.urls };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[AI] Generation was cancelled for guild ${guildId}`);
      return null;
    }
    
    console.error('[OpenWebUI] LLM error:', err.message || err);
    return {
      transcription,
      reply: 'ごめんなのだ、うまく返事できなかったのだ。Ollamaが動いているか確かめてほしいのだ。',
      urls: []
    };
  }
}