// src/auth.js
// Manages 2FA server authorization via Local OTP to the bot owner's email

import nodemailer from 'nodemailer';
import { getGuildConfig, setGuildConfig, getFullGuildConfig } from './config.js';
import { getBotConfig } from './botConfig.js';
import supabase from './db_supabase.js';

/**
 * Checks if a guild is authorized to use the bot.
 * @param {string} guildId
 * @returns {boolean}
 */
export function isGuildAuthorized(guildId) {
  return getGuildConfig(guildId).authorized === true;
}

/**
 * Checks if the entire bot is globally locked.
 * @returns {boolean}
 */
export function isBotLocked() {
  const cfg = getFullGuildConfig('SYSTEM');
  return cfg.settings?.isLocked === true;
}

/**
 * Sets the global lock state of the bot.
 * @param {boolean} locked 
 */
export async function setBotLocked(locked) {
  await setGuildConfig('SYSTEM', { isLocked: locked });
}

/**
 * Checks if a guild has been manually blocked by the bot owner.
 * @param {string} guildId
 * @returns {boolean}
 */
export function isGuildBlocked(guildId) {
  return getGuildConfig(guildId).blocked === true;
}

/**
 * Generates a local 6-digit OTP code, saves it, and sends it via email.
 * @param {string} guildId
 * @param {string} guildName
 */
export async function sendLocalOtp(guildId, guildName) {
  // Generate a random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Commit pending 2FA parameters directly onto the settings json payload
  await setGuildConfig(guildId, {
    authorized: false,
    guildName,
    requestedAt: Date.now(),
    otpCode: code
  });

  const email = getBotConfig('OWNER_EMAIL');
  if (!email || !getBotConfig('SMTP_USER') || !getBotConfig('SMTP_PASS')) {
    console.warn('[2FA] OWNER_EMAIL or SMTP_USER/PASS not configured. Cannot send local OTP.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: getBotConfig('SMTP_HOST', 'smtp.gmail.com'),
    port: parseInt(getBotConfig('SMTP_PORT', '465'), 10),
    secure: (getBotConfig('SMTP_PORT') === '465' || !getBotConfig('SMTP_PORT')), 
    auth: {
      user: getBotConfig('SMTP_USER'),
      pass: getBotConfig('SMTP_PASS'),
    },
  });

  try {
    await transporter.sendMail({
      from: `"Zundamon Bot" <${getBotConfig('SMTP_USER')}>`,
      to: email,
      subject: `[Zundamon] サーバー認証コード: ${code}`,
      text: `新しいサーバー「${guildName}」でのボット使用リクエストがありました。\n\n以下の6桁の認証コードをDiscordのDMでボットに送信してください:\n\n${code}\n\n※このメールに心当たりがない場合は無視してください。`,
    });
    console.log(`[2FA] Local OTP (${code}) sent to ${email} for guild ${guildName}.`);
  } catch (err) {
    console.error('[2FA] Error sending local OTP via Nodemailer:', err.message);
  }
}

/**
 * Generates a global 6-digit OTP code and sends it via email for sensitive dashboard actions.
 * @param {string} actionName 
 */
export async function sendGlobalOtp(actionName = 'Dashboard Action') {
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await setGuildConfig('SYSTEM', {
    requestedAt: Date.now(),
    otpCode: code,
    action: actionName
  });

  const email = getBotConfig('OWNER_EMAIL');
  if (!email || !getBotConfig('SMTP_USER') || !getBotConfig('SMTP_PASS')) {
    console.warn('[2FA] OWNER_EMAIL or SMTP_USER/PASS not configured. Cannot send global OTP.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: getBotConfig('SMTP_HOST', 'smtp.gmail.com'),
    port: parseInt(getBotConfig('SMTP_PORT', '465'), 10),
    secure: (getBotConfig('SMTP_PORT') === '465' || !getBotConfig('SMTP_PORT')), 
    auth: {
      user: getBotConfig('SMTP_USER'),
      pass: getBotConfig('SMTP_PASS'),
    },
  });

  try {
    await transporter.sendMail({
      from: `"Zundamon Bot" <${getBotConfig('SMTP_USER')}>`,
      to: email,
      subject: `[Zundamon] セキュリティ認証コード: ${code}`,
      text: `「${actionName}」の実行リクエストがありました。\n\n以下の6桁の認証コードをDashboardに入力するか、DiscordのDMでボットに送信してください:\n\n${code}\n\n※このメールに心当たりがない場合は無視してください。`,
    });
    console.log(`[2FA] Global OTP (${code}) sent to ${email} for ${actionName}.`);
  } catch (err) {
    console.error('[2FA] Error sending global OTP via Nodemailer:', err.message);
  }
}

/**
 * Verifies a 6-digit global OTP code and unlocks the bot if it matches.
 * @param {string} code 
 * @returns {Promise<boolean>}
 */
export async function verifyGlobalOtp(code) {
  const { data, error } = await supabase.from('guild_configs').select('settings').eq('guild_id', 'SYSTEM').single();
  if (error || !data) return false;

  const s = data.settings || {};
  if (s.otpCode === code) {
    await setGuildConfig('SYSTEM', {
      isLocked: false,
      otpCode: null
    });
    return true;
  }
  return false;
}

/**
 * Verifies a 6-digit local OTP code.
 * @param {string} code
 * @returns {Promise<{ guildId: string, guildName: string } | null>}
 */
export async function verifyLocalOtp(code) {
  let matchedGuildId = null;
  let latestTime = 0;
  let guildNameStr = '';

  // Because the bot may not have every single offline server cached in memory,
  // we must query the database to find the matching pending request.
  const { data, error } = await supabase.from('guild_configs').select('guild_id, name, settings');
  if (error || !data) return null;

  for (const row of data) {
    const s = row.settings || {};
    if (s.authorized === false && s.otpCode === code && s.requestedAt > latestTime) {
      latestTime = s.requestedAt;
      matchedGuildId = row.guild_id;
      guildNameStr = s.guildName || row.name;
    }
  }

  if (matchedGuildId) {
    await setGuildConfig(matchedGuildId, {
      authorized: true,
      authorizedAt: Date.now(),
      otpCode: null // Erase the code
    });
    return { guildId: matchedGuildId, guildName: guildNameStr };
  }

  return null;
}

/**
 * Returns all pending (unauthorized) guild entries.
 * @returns {Array<{ guildId: string, guildName: string }>}
 */
export async function getPendingGuilds() {
  const { data, error } = await supabase.from('guild_configs').select('guild_id, settings');
  if (error || !data) return [];

  return data
    .filter(row => row.guild_id !== 'SYSTEM' && row.settings?.authorized === false)
    .map(row => ({ guildId: row.guild_id, guildName: row.settings.guildName }));
}
