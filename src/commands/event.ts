import { Command } from '@sapphire/framework';
import { ButtonBuilder, ButtonStyle, EmbedBuilder, type ActionRowBuilder, type Message } from 'discord.js';
import { claimBoxes, claimDaily, ensureUser, openBox, type DB } from '../lib/db.js';
import { cfg, isEventActive, todayVN } from '../lib/config.js';
import { RARITY_COLOR, RARITY_LABEL, rollItem } from '../lib/items.js';
import { buttonRow, embed, fmtDuration, ownerCollector } from '../lib/ui.js';

export function closedEmbed(): EmbedBuilder {
  return embed('🌙 Event chưa mở', 'Event Trung Thu hiện không diễn ra. Hẹn gặp lại bạn nhé!');
}

export function openPayload(db: DB, userId: string) {
  const c = cfg();
  const item = rollItem(c.rarity_weights);
  const gain = c.rarity_points[item.rarity];
  const result = openBox(db, userId, item.id, gain);

  if (!result) {
    return {
      embeds: [
        embed(
          '🥮 Hết hộp rồi',
          'Bạn không còn hộp bánh nào.\nGõ `-box` để nhận hộp từ mốc chat và voice, hoặc `-daily` để điểm danh.'
        )
      ],
      components: [] as ActionRowBuilder<ButtonBuilder>[]
    };
  }

  const e = new EmbedBuilder()
    .setColor(RARITY_COLOR[item.rarity])
    .setTitle(`${item.emoji} ${item.name}`)
    .setDescription(`${RARITY_LABEL[item.rarity]} · **+${gain}** điểm`)
    .setFooter({ text: `Còn ${result.boxes} hộp · Tổng ${result.points} điểm` });

  const again = new ButtonBuilder()
    .setCustomId('open:again')
    .setLabel('Mở tiếp')
    .setEmoji('🎁')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(result.boxes <= 0);

  return { embeds: [e], components: [buttonRow(again)] };
}

export class DailyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'daily', aliases: ['diemdanh'], description: 'Điểm danh nhận hộp bánh' });
  }

  public override async messageRun(message: Message) {
    const c = cfg();
    if (!isEventActive(c)) return message.reply({ embeds: [closedEmbed()] });

    const r = claimDaily(this.container.db, message.author.id, todayVN(), c.daily_boxes);
    const e = r.ok
      ? embed(
          '🏮 Điểm danh thành công',
          `Bạn nhận được **${c.daily_boxes}** hộp bánh, đang có **${r.boxes}** hộp.\nGõ \`-open\` để mở.`
        )
      : embed('🏮 Đã điểm danh', `Hôm nay bạn điểm danh rồi. Mai quay lại nhé!\nĐang có **${r.boxes}** hộp.`);

    return message.reply({ embeds: [e] });
  }
}

export class BoxCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'box', aliases: ['hop', 'nhan'], description: 'Nhận hộp bánh từ mốc chat và voice' });
  }

  public override async messageRun(message: Message) {
    const c = cfg();
    if (!isEventActive(c)) return message.reply({ embeds: [closedEmbed()] });

    const r = claimBoxes(this.container.db, message.author.id, c.msg_tiers, c.voice_tiers);
    const nextMsg = c.msg_tiers.find((x) => x > r.msgCount);
    const nextVoice = c.voice_tiers.find((x) => x > Math.floor(r.voiceSec / 60));

    const e = embed(
      r.gained > 0 ? `🎁 Nhận được ${r.gained} hộp bánh` : '🎁 Chưa có hộp mới',
      [
        `💬 Đã chat **${r.msgCount}** tin nhắn` + (nextMsg ? ` · mốc kế: **${nextMsg}**` : ' · đã đạt mốc cuối'),
        `🔊 Đã voice **${fmtDuration(r.voiceSec)}**` +
          (nextVoice ? ` · mốc kế: **${nextVoice} phút**` : ' · đã đạt mốc cuối'),
        '',
        `Đang có **${r.boxes}** hộp. Gõ \`-open\` để mở.`
      ].join('\n')
    );

    return message.reply({ embeds: [e] });
  }
}

export class OpenCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'open', aliases: ['mo'], description: 'Mở hộp bánh' });
  }

  public override async messageRun(message: Message) {
    if (!isEventActive(cfg())) return message.reply({ embeds: [closedEmbed()] });

    const db = this.container.db;
    const userId = message.author.id;
    ensureUser(db, userId);

    const reply = await message.reply(openPayload(db, userId));
    const collector = ownerCollector(reply, userId);

    collector.on('collect', async (i) => {
      if (!i.isButton() || i.customId !== 'open:again') return;
      await i.update(openPayload(db, userId)).catch(() => {});
    });

    return reply;
  }
}
