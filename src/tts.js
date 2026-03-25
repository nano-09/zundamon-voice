// src/tts.js
// Handles VOICEVOX TTS synthesis using Zundamon voice

import axios from 'axios';
import { Readable } from 'stream';
import { getBotConfig } from './botConfig.js';

const VOICEVOX_URL = getBotConfig('VOICEVOX_URL', 'http://localhost:50021');
const SPEAKER_ID = parseInt(getBotConfig('VOICEVOX_SPEAKER', '3'), 10);

// Maximum text length to synthesize at once (VOICEVOX can handle long text but
// extremely long messages may be truncated for usability)
const MAX_TEXT_LENGTH = 200;

/**
 * Synthesizes text using VOICEVOX and returns a Readable stream (WAV audio).
 * @param {string} text - The text to synthesize
 * @param {number} [speakerId] - Optional specific speaker ID to use
 * @param {number} [speed=1.0] - Speech speed
 * @param {number} [pitch=0.0] - Speech pitch
 * @param {number} [volume=1.0] - Speech volume
 * @returns {Promise<Readable>} A readable stream containing WAV audio bytes
 */
export async function synthesize(text, speakerId, speed = 1.0, pitch = 0.0, volume = 1.0) {
  const truncated = text.slice(0, MAX_TEXT_LENGTH);
  const targetSpeakerId = speakerId !== undefined ? speakerId : SPEAKER_ID;

  // Step 1: Get the audio query (phoneme/pitch/speed data)
  console.log(`[TTS] Generating query for speaker ${targetSpeakerId}...`);
  const queryRes = await axios.post(
    `${VOICEVOX_URL}/audio_query`,
    null,
    {
      params: { text: truncated, speaker: targetSpeakerId },
      headers: { 'Content-Type': 'application/json' },
    }
  ).catch(err => {
    console.error(`[TTS] VOICEVOX audio_query failed: ${err.message}`);
    throw err;
  });

  const query = queryRes.data;
  if (speed !== undefined) query.speedScale = speed;
  if (pitch !== undefined) query.pitchScale = pitch;
  if (volume !== undefined) query.volumeScale = volume;

  // Step 2: Synthesize WAV audio from the query
  const synthRes = await axios.post(
    `${VOICEVOX_URL}/synthesis`,
    query,
    {
      params: { speaker: targetSpeakerId },
      headers: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
    }
  );

  // Wrap the raw WAV buffer in a Node.js Readable stream
  const buffer = Buffer.from(synthRes.data);
  console.log(`[TTS] Synthesis complete. Buffer size: ${buffer.length} bytes.`);
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
