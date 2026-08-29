import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { addMsg } from '../lib/db.js';
import { cfg, isEventActive } from '../lib/config.js';

const lastAt = new Map<string, number>();

export class MessageCounter extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate });
  }

  public override run(message: Message): void {
    if (message.author.bot || !message.inGuild()) return;
    const c = cfg();
    if (!isEventActive(c)) return;
    if (!c.channels.includes(message.channelId)) return;
    if (message.content.length < c.min_msg_len) return;

    const now = Date.now();
    const prev = lastAt.get(message.author.id) ?? 0;
    if (now - prev < c.msg_cooldown * 1000) return;
    lastAt.set(message.author.id, now);

    addMsg(this.container.db, message.author.id);
  }
}

import { Listener as SapphireListener, Events as FrameworkEvents, type MessageCommandErrorPayload } from '@sapphire/framework';
import { embed } from '../lib/ui.js';

export class CommandErrorLogger extends SapphireListener<typeof FrameworkEvents.MessageCommandError> {
  public constructor(context: SapphireListener.LoaderContext, options: SapphireListener.Options) {
    super(context, { ...options, name: 'commandError', event: FrameworkEvents.MessageCommandError });
  }

  public override async run(error: unknown, payload: MessageCommandErrorPayload): Promise<void> {
    this.container.logger.error(`Lỗi lệnh ${payload.command.name}:`, error);
    await payload.message
      .reply({ embeds: [embed('💥 Có lỗi xảy ra', 'Lệnh gặp sự cố. Thử lại sau, hoặc báo owner nhé.')] })
      .catch(() => {});
  }
}
