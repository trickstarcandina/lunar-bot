import { Command, type Args } from '@sapphire/framework';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Message,
  type MessageComponentInteraction,
  type TextBasedChannel
} from 'discord.js';
import { addBoxes, ensureUser } from '../lib/db.js';
import { cfg, setConfig, type Config } from '../lib/config.js';
import { RARITIES, type Rarity } from '../lib/items.js';
import { buttonRow, embed, isOwner, ownerCollector, selectRow, type AnySelectMenuBuilder } from '../lib/ui.js';

function parseIntList(s: string): number[] | null {
  const nums = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  if (!nums.length || nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parsePositive(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 'YYYY-MM-DD HH:mm' giờ Việt Nam (UTC+7, không có DST) → epoch giây. Chuỗi rỗng → null. */
function parseVNTime(s: string): number | null | 'invalid' {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v);
  if (!m) return 'invalid';
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+07:00`);
  return Number.isNaN(ms) ? 'invalid' : Math.floor(ms / 1000);
}

function fmtTime(epoch: number | null): string {
  if (epoch === null) return 'không giới hạn';
  return new Date(epoch * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function cfgPayload() {
  const c = cfg();
  const e = embed('⚙️ Cấu hình event Trung Thu')
    .addFields(
      { name: 'Trạng thái', value: c.enabled ? '🟢 Đang bật' : '🔴 Đang tắt', inline: true },
      { name: 'Hộp mỗi ngày', value: String(c.daily_boxes), inline: true },
      { name: 'Độ dài tin nhắn tối thiểu', value: `${c.min_msg_len} ký tự`, inline: true },
      { name: 'Bắt đầu', value: fmtTime(c.event_start), inline: true },
      { name: 'Kết thúc', value: fmtTime(c.event_end), inline: true },
      { name: 'Cooldown chat', value: `${c.msg_cooldown}s`, inline: true },
      {
        name: 'Kênh được tính chat',
        value: c.channels.length ? c.channels.map((id) => `<#${id}>`).join(' ') : '_chưa đặt — không kênh nào được tính_'
      },
      { name: 'Mốc chat', value: c.msg_tiers.join(', '), inline: true },
      { name: 'Mốc voice (phút)', value: c.voice_tiers.join(', '), inline: true },
      { name: 'Kênh log', value: c.log_channel ? `<#${c.log_channel}>` : '_chưa đặt_', inline: true },
      { name: 'Tỉ lệ gacha', value: RARITIES.map((r) => `${r}: ${c.rarity_weights[r]}`).join(' · ') },
      { name: 'Điểm rarity', value: RARITIES.map((r) => `${r}: ${c.rarity_points[r]}`).join(' · ') }
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('cfg:pick')
    .setPlaceholder('Chọn mục cần sửa')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Kênh được tính chat').setValue('channels').setEmoji('💬'),
      new StringSelectMenuOptionBuilder().setLabel('Kênh log').setValue('log_channel').setEmoji('📋'),
      new StringSelectMenuOptionBuilder().setLabel('Thời gian event').setValue('time').setEmoji('🕒'),
      new StringSelectMenuOptionBuilder().setLabel('Mốc chat').setValue('msg_tiers').setEmoji('📈'),
      new StringSelectMenuOptionBuilder().setLabel('Mốc voice').setValue('voice_tiers').setEmoji('🔊'),
      new StringSelectMenuOptionBuilder().setLabel('Tỉ lệ gacha').setValue('rarity_weights').setEmoji('🎲'),
      new StringSelectMenuOptionBuilder().setLabel('Điểm rarity').setValue('rarity_points').setEmoji('💎'),
      new StringSelectMenuOptionBuilder().setLabel('Số & cooldown khác').setValue('numbers').setEmoji('🔢')
    );

  const toggle = buttonRow(
    new ButtonBuilder()
      .setCustomId('cfg:toggle')
      .setLabel(cfg().enabled ? 'Tắt event' : 'Bật event')
      .setStyle(cfg().enabled ? ButtonStyle.Danger : ButtonStyle.Success)
  );

  return { embeds: [e], components: [selectRow(menu), toggle] };
}

function textInput(id: string, label: string, value: string, required = false) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setValue(value)
  );
}

/** Mở modal, chờ người dùng submit tối đa 5 phút. Trả về map giá trị, hoặc null nếu bỏ qua. */
async function askModal(
  i: MessageComponentInteraction,
  id: string,
  title: string,
  rows: ActionRowBuilder<TextInputBuilder>[]
) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...rows);
  await i.showModal(modal);
  const submit = await i
    .awaitModalSubmit({ time: 300_000, filter: (m) => m.customId === id && m.user.id === i.user.id })
    .catch(() => null);
  return submit;
}

export class CfgCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'cfg', aliases: ['config', 'setting'], description: 'Cấu hình event (owner)' });
  }

  public override async messageRun(message: Message) {
    if (!isOwner(message.author.id)) {
      return message.reply({ embeds: [embed('⛔ Không đủ quyền', 'Lệnh này chỉ dành cho owner của event.')] });
    }

    const db = this.container.db;
    const reply = await message.reply(cfgPayload());
    const collector = ownerCollector(reply, message.author.id, 600_000);

    collector.on('collect', async (i) => {
      const c = cfg();

      if (i.isButton() && i.customId === 'cfg:toggle') {
        setConfig(db, 'enabled', !c.enabled);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (i.isChannelSelectMenu() && i.customId === 'cfg:channels') {
        setConfig(db, 'channels', [...i.values]);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (i.isChannelSelectMenu() && i.customId === 'cfg:log') {
        setConfig(db, 'log_channel', i.values[0] ?? null);
        return void (await i.update(cfgPayload()).catch(() => {}));
      }

      if (!i.isStringSelectMenu() || i.customId !== 'cfg:pick') return;
      const choice = i.values[0]!;

      if (choice === 'channels' || choice === 'log_channel') {
        const menu = new ChannelSelectMenuBuilder()
          .setCustomId(choice === 'channels' ? 'cfg:channels' : 'cfg:log')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setPlaceholder(choice === 'channels' ? 'Chọn các kênh được tính chat' : 'Chọn kênh log')
          .setMinValues(choice === 'channels' ? 0 : 1)
          .setMaxValues(choice === 'channels' ? 25 : 1);
        return void (await i
          .update({
            embeds: [
              embed(
                choice === 'channels' ? '💬 Chọn kênh được tính chat' : '📋 Chọn kênh log',
                'Chọn xong là lưu ngay, danh sách cũ bị thay thế.'
              )
            ],
            components: [selectRow(menu as unknown as AnySelectMenuBuilder)]
          })
          .catch(() => {}));
      }

      if (choice === 'time') {
        const submit = await askModal(i, 'cfg:modal:time', 'Thời gian event (giờ VN)', [
          textInput('start', 'Bắt đầu — YYYY-MM-DD HH:mm (trống = bỏ)', c.event_start ? fmtTime(c.event_start) : ''),
          textInput('end', 'Kết thúc — YYYY-MM-DD HH:mm (trống = bỏ)', c.event_end ? fmtTime(c.event_end) : '')
        ]);
        if (!submit || !submit.isFromMessage()) return;
        const start = parseVNTime(submit.fields.getTextInputValue('start'));
        const end = parseVNTime(submit.fields.getTextInputValue('end'));
        if (start === 'invalid' || end === 'invalid') {
          return void (await submit.reply({ content: 'Sai định dạng. Dùng `YYYY-MM-DD HH:mm`.', flags: MessageFlags.Ephemeral }));
        }
        if (start !== null && end !== null && end <= start) {
          return void (await submit.reply({ content: 'Thời gian kết thúc phải sau thời gian bắt đầu.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, 'event_start', start);
        setConfig(db, 'event_end', end);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'msg_tiers' || choice === 'voice_tiers') {
        const key = choice as 'msg_tiers' | 'voice_tiers';
        const submit = await askModal(i, `cfg:modal:${key}`, key === 'msg_tiers' ? 'Mốc chat' : 'Mốc voice (phút)', [
          textInput('v', 'Các số cách nhau bởi dấu phẩy', c[key].join(', '), true)
        ]);
        if (!submit || !submit.isFromMessage()) return;
        const list = parseIntList(submit.fields.getTextInputValue('v'));
        if (!list) {
          return void (await submit.reply({ content: 'Chỉ nhận số nguyên dương, cách nhau bởi dấu phẩy.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, key, list);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'rarity_weights' || choice === 'rarity_points') {
        const key = choice as 'rarity_weights' | 'rarity_points';
        const submit = await askModal(
          i,
          `cfg:modal:${key}`,
          key === 'rarity_weights' ? 'Tỉ lệ gacha' : 'Điểm mỗi rarity',
          RARITIES.map((r) => textInput(r, r, String(c[key][r]), true))
        );
        if (!submit || !submit.isFromMessage()) return;
        const next = {} as Record<Rarity, number>;
        for (const r of RARITIES) {
          const n = parsePositive(submit.fields.getTextInputValue(r));
          if (n === null) {
            return void (await submit.reply({ content: `Giá trị của \`${r}\` phải là số nguyên không âm.`, flags: MessageFlags.Ephemeral }));
          }
          next[r] = n;
        }
        if (key === 'rarity_weights' && RARITIES.every((r) => next[r] === 0)) {
          return void (await submit.reply({ content: 'Không thể đặt toàn bộ tỉ lệ bằng 0.', flags: MessageFlags.Ephemeral }));
        }
        setConfig(db, key, next);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }

      if (choice === 'numbers') {
        const submit = await askModal(i, 'cfg:modal:numbers', 'Các số khác', [
          textInput('daily_boxes', 'Hộp mỗi ngày', String(c.daily_boxes), true),
          textInput('min_msg_len', 'Độ dài tin nhắn tối thiểu', String(c.min_msg_len), true),
          textInput('msg_cooldown', 'Cooldown chat (giây)', String(c.msg_cooldown), true)
        ]);
        if (!submit || !submit.isFromMessage()) return;
        const fields: (keyof Config)[] = ['daily_boxes', 'min_msg_len', 'msg_cooldown'];
        const values: number[] = [];
        for (const f of fields) {
          const n = parsePositive(submit.fields.getTextInputValue(f));
          if (n === null) {
            return void (await submit.reply({ content: `Giá trị của \`${f}\` phải là số nguyên không âm.`, flags: MessageFlags.Ephemeral }));
          }
          values.push(n);
        }
        setConfig(db, 'daily_boxes', values[0]!);
        setConfig(db, 'min_msg_len', values[1]!);
        setConfig(db, 'msg_cooldown', values[2]!);
        return void (await submit.update(cfgPayload()).catch(() => {}));
      }
    });

    return reply;
  }
}

export class AddBoxCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'addbox', aliases: ['themhop'], description: 'Cấp hoặc trừ hộp bánh (owner)' });
  }

  public override async messageRun(message: Message, args: Args) {
    if (!isOwner(message.author.id)) {
      return message.reply({ embeds: [embed('⛔ Không đủ quyền', 'Lệnh này chỉ dành cho owner của event.')] });
    }

    const target = await args.pick('user').catch(() => null);
    const amount = await args.pick('integer').catch(() => null);
    if (!target || amount === null || amount === 0) {
      return message.reply({
        embeds: [embed('Cách dùng', '`-addbox @user <số>`\nSố âm để trừ. Ví dụ: `-addbox @Thắng 5`')]
      });
    }

    const db = this.container.db;
    const boxes = addBoxes(db, target.id, amount);
    const points = ensureUser(db, target.id).points;

    const e = embed(
      '🎁 Đã cập nhật hộp bánh',
      `${amount > 0 ? 'Cấp' : 'Trừ'} **${Math.abs(amount)}** hộp cho ${target}.\nHiện có **${boxes}** hộp · **${points}** điểm.`
    );
    await message.reply({ embeds: [e] });

    const logId = cfg().log_channel;
    if (logId) {
      const ch = await message.client.channels.fetch(logId).catch(() => null);
      if (ch?.isTextBased() && 'send' in ch) {
        await (ch as TextBasedChannel & { send: Function })
          .send({
            embeds: [
              embed(
                '📋 Log cấp hộp',
                `${message.author} → ${target}\nSố lượng: **${amount > 0 ? '+' : ''}${amount}**\nCòn lại: **${boxes}** hộp`
              )
            ]
          })
          .catch(() => {});
      }
    }

    return;
  }
}
