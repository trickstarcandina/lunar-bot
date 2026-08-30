import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChannelSelectMenuBuilder,
  type MentionableSelectMenuBuilder,
  type Message,
  type RoleSelectMenuBuilder,
  type StringSelectMenuBuilder,
  type UserSelectMenuBuilder
} from 'discord.js';
import { container } from '@sapphire/framework';

// discord.js 14.27 không export `AnySelectMenuBuilder`; ghép lại union tương đương.
export type AnySelectMenuBuilder =
  | StringSelectMenuBuilder
  | UserSelectMenuBuilder
  | RoleSelectMenuBuilder
  | MentionableSelectMenuBuilder
  | ChannelSelectMenuBuilder;

export const BRAND = 0xf1c40f;

export function embed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(BRAND).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function buttonRow(...c: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...c);
}

export function selectRow(menu: AnySelectMenuBuilder): ActionRowBuilder<AnySelectMenuBuilder> {
  return new ActionRowBuilder<AnySelectMenuBuilder>().addComponents(menu);
}

/** Collector chỉ nhận tương tác của người gọi lệnh; hết giờ thì gỡ nút. */
export function ownerCollector(msg: Message, userId: string, ms = 300_000) {
  const collector = msg.createMessageComponentCollector({
    time: ms,
    filter: async (i) => {
      if (i.user.id === userId) return true;
      await i
        .reply({ content: 'Nút này không phải của bạn. Gõ lệnh để có bảng của riêng bạn nhé.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return false;
    }
  });
  collector.on('end', () => {
    msg.edit({ components: [] }).catch(() => {});
  });
  return collector;
}

export function isOwner(userId: string): boolean {
  return container.owners.includes(userId);
}
