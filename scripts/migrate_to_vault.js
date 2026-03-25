// scripts/migrate_to_vault.js
// Migration tool to move .env variables to a secure Supabase table (fallback for when vault is missing)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // Must be the service_role key
);

const SECRETS_TO_MIGRATE = [
  { key: 'DISCORD_TOKEN', desc: 'Discord Bot Token' },
  { key: 'CLIENT_ID', desc: 'Discord Application Client ID' },
  { key: 'OWNER_DISCORD_ID', desc: 'Bot Owner User ID' },
  { key: 'OWNER_EMAIL', desc: 'Bot Owner Email Address' },
  { key: 'SMTP_HOST', desc: 'SMTP Host for 2FA Emails' },
  { key: 'SMTP_PORT', desc: 'SMTP Port for 2FA Emails' },
  { key: 'SMTP_USER', desc: 'SMTP Username' },
  { key: 'SMTP_PASS', desc: 'SMTP Password' },
  { key: 'OLLAMA_URL', desc: 'Ollama API URL' },
  { key: 'OLLAMA_MODEL', desc: 'Ollama Model Name' },
  { key: 'VOICEVOX_URL', desc: 'VOICEVOX Engine URL' },
  { key: 'VOICEVOX_SPEAKER', desc: 'Default VOICEVOX Speaker ID' }
];

async function migrate() {
  console.log('🚀 Starting migration to Supabase bot_secrets table...');

  for (const { key, desc } of SECRETS_TO_MIGRATE) {
    const value = process.env[key];
    if (!value) {
      console.warn(`[SKIP] No value found in .env for ${key}`);
      continue;
    }

    console.log(`[MIGRATING] ${key}...`);
    
    try {
      // Upsert into our custom table
      const { error } = await supabase
        .from('bot_secrets')
        .upsert({
          name: key,
          value: value,
          description: desc,
          updated_at: new Date().toISOString()
        }, { onConflict: 'name' });

      if (error) {
        console.error(`[ERROR] Failed to migrate ${key}:`, error.message);
        console.log(`[TIP] Make sure you have run the NEW vault_setup.sql script in Supabase.`);
      } else {
        console.log(`[SUCCESS] Migrated ${key}`);
      }
    } catch (err) {
      console.error(`[ERROR] Exception migrating ${key}:`, err.message);
    }
  }

  console.log('✅ Migration process finished.');
}

migrate();
