# Zundamon Bot — Feature Additions

Add 2FA server auth, per-user voice params, role-based command permissions, `/trim`, and split `/status` into two commands.

## User Review Required

> [!IMPORTANT]
> **2FA Flow**: When the bot joins a new server, it DMs the bot owner (`OWNER_DISCORD_ID` in [.env](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/.env)) with a 6-digit code. Owner replies to authorize. Unauthorized servers get "⛔" on all commands.

> [!IMPORTANT]
> **Per-User Voice Params**: `/voiceparams` stores speed/pitch/volume per-user. Guild-level values remain as fallback defaults.

> [!WARNING]
> **Slash commands must be re-deployed** after changes (`node deploy-commands.js` or restart).

---

## Proposed Changes

### Feature 1: 2FA Server Authorization

#### [NEW] [auth.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/auth.js)
- Manages `authorized_guilds.json` — `guildId → { authorized, code, authorizedAt }`
- `isGuildAuthorized(guildId)`, `generateAuthCode(guildId)`, `verifyAuthCode(guildId, code)`

#### [MODIFY] [.env.example](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/.env.example)
- Add `OWNER_DISCORD_ID=your_discord_user_id`

#### [MODIFY] [index.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/index.js)
- Add `GuildCreate` event → generate auth code → DM owner
- Add `DirectMessages` intent for DM code replies
- Guard TTS listener with auth check

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js)
- Auth check at top of [handleCommand](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js#113-466)

---

### Feature 2: Per-User Voice Params (Persistent)

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js)
- `/voiceparams` stores under `userParams.{userId}` instead of guild-level

#### [MODIFY] [player.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/player.js)
- [processQueue](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/player.js#246-274) reads `cfg.userParams[userId]` for speed/pitch/volume, falls back to guild defaults

---

### Feature 3: Split `/status` → `/serverstatus` + `/mystatus`

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js)
- **`/serverstatus`** — shows guild-wide settings: voice connection, channels, chat mode, announce, trim, permissions rules
- **`/mystatus`** — shows the user's personal voice settings: voice ID, speed, pitch, volume
- Remove old `/status` command

---

### Feature 4: Role-Based Command Permissions

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js)
- Add `/permissions` command (server owner only):
  - `/permissions set <command> <role> <allow|deny>`
  - `/permissions list` — show current rules
  - `/permissions reset <command>` — clear rules for a command
- Store in config: `permissions.{commandName}.{roleId} = "allow"|"deny"`
- Permission check in [handleCommand](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js#113-466):
  - No rules → allowed for all (default open)
  - If "allow" rules exist → whitelist mode (only allowed roles)
  - If only "deny" rules → blacklist mode
  - Server owner always bypasses

---

### Feature 5: `/trim` Command

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js)
- `/trim <wordcount>` — sets `trimWordCount` in guild config (0 = disable)

#### [MODIFY] [index.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/index.js)
- In `MessageCreate` TTS listener: if text exceeds `trimWordCount` characters, truncate and append `以下略`

---

### Feature 6: Update Help Command & Dashboard

#### [MODIFY] [commands.js](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/src/commands.js) — `/help`
- Add entries for `/voiceparams`, `/permissions`, `/trim`, `/serverstatus`, `/mystatus`
- Remove old `/status` entry

#### [MODIFY] [index.html](file:///c:/Users/Nanolife09_/Documents/GitHub/zundamon-voice/dashboard/public/index.html)
- Update Help tab tables:
  - Basic Controls: replace `/status` with `/serverstatus` and `/mystatus`
  - Voice Settings: update `/voiceparams` description to mention per-user
  - Add new section "🔒 Administration" with `/permissions` and `/trim`

---

## Verification Plan

### Manual Testing
1. **2FA**: Set `OWNER_DISCORD_ID` → invite bot to new server → verify DM → authorize → commands work
2. **Per-User Params**: Two users set different `/voiceparams` → verify different speech speeds → restart → verify persistence
3. **Status split**: `/serverstatus` shows server info, `/mystatus` shows personal voice settings
4. **Permissions**: Owner sets deny rule → regular user gets blocked → reset → unblocked
5. **Trim**: `/trim wordcount:10` → send long message → verify truncation + "以下略"
6. **Help/Dashboard**: Check `/help` includes all new commands; dashboard Help tab shows updated tables
