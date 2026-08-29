import 'dotenv/config';
import { SapphireClient, LogLevel, container } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits } from 'discord.js';
import { openDb, resetVoiceSessions, flushVoice, closeVoice, openVoiceIds, type DB } from './lib/db.js';
import { cfg, isEventActive, loadConfig } from './lib/config.js';
import { syncVoiceChannel, voiceEligible } from './listeners/voice.js';

declare module '@sapphire/pieces' {
  interface Container {
    db: DB;
    owners: string[];
  }
}

const db = openDb(process.env.DB_PATH ?? 'data/event.db');
loadConfig(db);
resetVoiceSessions(db);

container.db = db;
container.owners = (process.env.OWNERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const client = new SapphireClient({
  defaultPrefix: process.env.PREFIX ?? '-',
  caseInsensitiveCommands: true,
  loadMessageCommandListeners: true,
  logger: { level: LogLevel.Info },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('clientReady', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;
    for (const ch of channels.values()) {
      if (ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
        syncVoiceChannel(db, ch, now);
      }
    }
  }
  container.logger.info(`Sẵn sàng với ${container.owners.length} owner.`);
});

function currentlyEligibleVoiceIds(): Set<string> {
  const ids = new Set<string>();
  for (const guild of client.guilds.cache.values()) {
    for (const ch of guild.channels.cache.values()) {
      if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) continue;
      for (const member of ch.members.values()) {
        if (voiceEligible(ch, member)) ids.add(member.id);
      }
    }
  }
  return ids;
}

function voiceTick(): void {
  const now = Math.floor(Date.now() / 1000);
  if (!isEventActive(cfg())) {
    resetVoiceSessions(db);
    return;
  }
  const eligible = currentlyEligibleVoiceIds();
  for (const id of openVoiceIds(db)) {
    if (!eligible.has(id)) closeVoice(db, id, now);
  }
  flushVoice(db, now);
}

setInterval(voiceTick, 60_000);

function shutdown(): void {
  flushVoice(db, Math.floor(Date.now() / 1000));
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(process.env.DISCORD_TOKEN);
