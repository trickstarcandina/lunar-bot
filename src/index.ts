import 'dotenv/config';
import { SapphireClient, LogLevel, container } from '@sapphire/framework';
import { ChannelType, GatewayIntentBits } from 'discord.js';
import { openDb, resetVoiceSessions, flushVoice, type DB } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { syncVoiceChannel } from './listeners/voice.js';

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

setInterval(() => flushVoice(db, Math.floor(Date.now() / 1000)), 60_000);

await client.login(process.env.DISCORD_TOKEN);
