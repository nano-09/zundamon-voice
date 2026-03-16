// src/ai.js
// Handles STT (Whisper via @xenova/transformers) and LLM (Ollama) locally

import 'dotenv/config';
import { pipeline } from '@xenova/transformers';
import ollama from 'ollama';

// ── Configuration ────────────────────────────────────────────────────────────
const OLLAMA_HOST = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

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
 */
export async function processAudioLocally(pcmBuffer) {
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

  const transcription = transcribed.text.trim();
  if (!transcription) return null;

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

  // ── Step 4: Generate reply with Ollama ──────────────────────────────────────
  try {
    const response = await ollama.chat({
      host: OLLAMA_HOST,
      model: OLLAMA_MODEL,
      messages: [
        {
          role: 'system',
          content: `あなたは東北地方の妖精「ずんだもん」なのだ。ずんだ餅がモチーフの妖精なのだ。
あなたは「少し生意気だけど憎めない、元気なボクっ娘（のような妖精）」なのだ。

【あなたの役割】
ユーザーからの質問や雑談に対して、役に立つ適切な回答を、あなたの個性（ずんだもん）を完全に保ったまま提供すること。

【RP（ロールプレイ）の厳格な掟】
1. **一人称**: 必ず「ボク」を使うのだ。
2. **語尾**: 全ての文末を「〜なのだ」「〜のだ」「〜なのだ！」「〜なのだ？」で終わらせるのだ。
3. **禁止語句**: 「です」「ます」「だね」「だよ」「でしょう」「ですね」などの敬語や標準語の丁寧な語尾は絶対に禁止なのだ。
4. **性格**: 少し上から目線で、でも親しみやすく元気なのだ。ずんだ餅を神聖視しているのだ。
5. **長さ**: 音声で読み上げられるため、1〜3文程度の簡潔な回答にするのだ。

【思考と回答のプロセス】
1. 回答の前に必ず <thought> タグを使い、ユーザーの入力に対してどう答えるべきか、そしてそれが「ずんだもん」の口調に合っているかを内部で思考せよ。
2. その後、<thought> タグの外で、実際のずんだもんとしての回答のみを出力せよ。`,
        },

        {
          role: 'user',
          content: `【最重要指示：必ず回答の冒頭で <thought> タグを使い、どう役立つ回答をするか、そして口調がずんだもんになっているかを自問自答せよ。敬語は厳禁なのだ。】\n\n入力：${transcription}`,
        },
      ],
      options: {
        temperature: 0.7,
      },
    });

    let reply = response.message.content;
    console.log(`[Ollama] Raw Reply: "${reply.replace(/\n/g, '\\n')}"`);

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

    // 2. Strip common prefixes/suffixes that the AI might hallucinate
    reply = reply
      .replace(/^(ずんだもん[：:：]|回答[：:：]|答え[：:：])/gi, '')
      .replace(/^(「|『)(.*)(」|』)$/s, '$2') // Strip surrounding quotes
      .trim();

    if (!reply) {
      return { transcription, reply: '……なのだ？' };
    }

    return { transcription, reply };
  } catch (err) {
    console.error('[Ollama] LLM error:', err.message || err);
    return {
      transcription,
      reply: 'ごめんなのだ、うまく返事できなかったのだ。Ollamaが動いているか確かめてほしいのだ。',
    };
  }
}