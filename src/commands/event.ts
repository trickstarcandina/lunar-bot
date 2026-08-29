import { Command } from '@sapphire/framework';
import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ActionRowBuilder,
  type Message
} from 'discord.js';
import {
  claimBoxes,
  claimDaily,
  craft,
  ensureUser,
  getItems,
  openBox,
  rankOf,
  topCount,
  topPage,
  type DB,
  type TopKey
} from '../lib/db.js';
import { cfg, isEventActive, todayVN } from '../lib/config.js';
import { GROUP_LABEL, ITEM_MAP, RARITIES, RARITY_COLOR, RARITY_LABEL, craftGain, rollItem, type Group, type Item } from '../lib/items.js';
import { buttonRow, embed, fmtDuration, ownerCollector, selectRow, type AnySelectMenuBuilder } from '../lib/ui.js';

export function closedEmbed(): EmbedBuilder {
  return embed('🌙 Event chưa mở', 'Event Trung Thu hiện không diễn ra. Hẹn gặp lại bạn nhé!');
}

export function openPayload(db: DB, userId: string) {
  const c = cfg();
  if (!isEventActive(c)) {
    return { embeds: [closedEmbed()], components: [] as ActionRowBuilder<ButtonBuilder>[] };
  }
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

  const toInv = new ButtonBuilder()
    .setCustomId('open:inv')
    .setLabel('Túi đồ')
    .setEmoji('🧺')
    .setStyle(ButtonStyle.Secondary);

  return { embeds: [e], components: [buttonRow(again, toInv)] };
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
      if (!i.isButton()) return;
      if (i.customId === 'open:again') {
        await i.update(openPayload(db, userId)).catch(() => {});
      } else if (i.customId === 'open:inv') {
        // ponytail: nút Túi đồ từ -open chỉ hiển thị lối tắt xem nhanh; các nút
        // phân trang/craft trên embed này sẽ không phản hồi vì collector của
        // OpenCommand không xử lý inv:*/craft:* — nâng cấp nếu cần luồng đầy đủ tại đây.
        const name = message.guild?.members.cache.get(userId)?.displayName ?? message.author.username;
        const payload = invPayload(db, userId, name, 0, true);
        await i.update({ embeds: payload.embeds, components: payload.components }).catch(() => {});
      }
    });

    return reply;
  }
}

const PER_PAGE = 10;
const CRAFT_GROUPS: Group[] = ['banh', 'den', 'khac'];

interface Owned {
  item: Item;
  qty: number;
}

function ownedOf(db: DB, userId: string): Owned[] {
  return getItems(db, userId)
    .map((r) => ({ item: ITEM_MAP.get(r.item_id)!, qty: r.qty }))
    .filter((x) => x.item !== undefined)
    .sort(
      (a, b) =>
        RARITIES.indexOf(b.item.rarity) - RARITIES.indexOf(a.item.rarity) ||
        a.item.name.localeCompare(b.item.name, 'vi')
    );
}

/** Item rẻ nhất của mỗi nhóm mà người chơi đang có; undefined nếu nhóm đó trống. */
function cheapestByGroup(owned: Owned[]): Partial<Record<Group, string>> {
  const out: Partial<Record<Group, string>> = {};
  for (const g of CRAFT_GROUPS) {
    const pool = owned.filter((x) => x.item.group === g);
    if (!pool.length) continue;
    out[g] = pool.reduce((a, b) =>
      RARITIES.indexOf(a.item.rarity) <= RARITIES.indexOf(b.item.rarity) ? a : b
    ).item.id;
  }
  return out;
}

export function invPayload(db: DB, userId: string, name: string, page: number, self: boolean) {
  const owned = ownedOf(db, userId);
  const u = ensureUser(db, userId);
  const maxPage = Math.max(1, Math.ceil(owned.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), maxPage - 1);
  const slice = owned.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  const lines = slice.length
    ? slice
        .map((x) => `${RARITY_LABEL[x.item.rarity].split(' ')[0]} ${x.item.emoji} **${x.item.name}** ×${x.qty}`)
        .join('\n')
    : '_Túi trống. Gõ `-open` để mở hộp bánh._';

  const canCraft = CRAFT_GROUPS.every((g) => owned.some((x) => x.item.group === g));

  const e = embed(`🧺 Túi của ${name}`, lines).setFooter({
    text: `${u.points} điểm · ${u.boxes} hộp · ${u.crafts} mâm cỗ · Trang ${p + 1}/${maxPage}`
  });

  if (!self) return { embeds: [e], components: [] as ActionRowBuilder<ButtonBuilder>[], page: p };

  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId('inv:prev').setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId('inv:next')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= maxPage - 1),
    new ButtonBuilder()
      .setCustomId('inv:craft')
      .setLabel('Craft mâm cỗ')
      .setEmoji('🥮')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canCraft),
    new ButtonBuilder()
      .setCustomId('inv:open')
      .setLabel('Mở hộp')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(u.boxes <= 0)
  ];

  return { embeds: [e], components: [buttonRow(...buttons)], page: p };
}

export function craftPickPayload(db: DB, userId: string, picked: Partial<Record<Group, string>>) {
  const owned = ownedOf(db, userId);
  const rows: ActionRowBuilder<AnySelectMenuBuilder>[] = [];

  for (const g of CRAFT_GROUPS) {
    const pool = owned.filter((x) => x.item.group === g).slice(0, 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`craft:${g}`)
      .setPlaceholder(`Chọn ${GROUP_LABEL[g]}`);
    if (pool.length) {
      menu.addOptions(
        pool.map((x) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${x.item.name} ×${x.qty}`)
            .setDescription(RARITY_LABEL[x.item.rarity])
            .setEmoji(x.item.emoji)
            .setValue(x.item.id)
            .setDefault(picked[g] === x.item.id)
        )
      );
    } else {
      // discord.js yêu cầu 1-25 lựa chọn; nhóm rỗng thì hiện một lựa chọn giả bị khoá.
      menu
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel(`Không có ${GROUP_LABEL[g].toLowerCase()}`).setValue('none')
        )
        .setDisabled(true);
    }
    rows.push(selectRow(menu));
  }

  const ids = CRAFT_GROUPS.map((g) => picked[g]).filter(Boolean) as string[];
  const ready = ids.length === CRAFT_GROUPS.length;
  const gain = ready ? craftGain(ids, cfg().rarity_points) : 0;

  const e = embed(
    '🥮 Craft Mâm cỗ Trung Thu',
    [
      'Chọn một món mỗi nhóm rồi bấm **Xác nhận**.',
      '',
      ...CRAFT_GROUPS.map((g) => {
        const id = picked[g];
        const item = id ? ITEM_MAP.get(id) : undefined;
        return `**${GROUP_LABEL[g]}:** ${item ? `${item.emoji} ${item.name}` : '_chưa chọn_'}`;
      }),
      '',
      ready ? `Nhận được **+${gain}** điểm.` : '_Chọn đủ ba nhóm để craft._'
    ].join('\n')
  );

  const confirmRow = buttonRow(
    new ButtonBuilder()
      .setCustomId('craft:go')
      .setLabel('Xác nhận')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!ready),
    new ButtonBuilder().setCustomId('craft:cancel').setLabel('Huỷ').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [e], components: [...rows, confirmRow] };
}

export function craftConfirmPayload(db: DB, userId: string, ids: string[]) {
  if (!isEventActive(cfg())) {
    return { embeds: [closedEmbed()], components: [] as ActionRowBuilder<ButtonBuilder>[] };
  }
  if (ids.length !== CRAFT_GROUPS.length) {
    return {
      embeds: [embed('🥮 Craft thất bại', 'Chưa chọn đủ ba nhóm nguyên liệu.')],
      components: [] as ActionRowBuilder<ButtonBuilder>[]
    };
  }
  const gain = craftGain(ids, cfg().rarity_points);
  const ok = craft(db, userId, ids, gain);
  const e = ok
    ? embed(
        '🥮 Craft thành công',
        `Bạn bày được một **Mâm cỗ Trung Thu** và nhận **+${gain}** điểm!\nTổng điểm: **${ensureUser(db, userId).points}**`
      )
    : embed('🥮 Craft thất bại', 'Nguyên liệu không còn đủ. Mở thêm hộp rồi thử lại nhé.');
  return { embeds: [e], components: [] as ActionRowBuilder<ButtonBuilder>[] };
}

export class InvCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'inv', aliases: ['tui', 'bag'], description: 'Xem túi đồ' });
  }

  public override async messageRun(message: Message) {
    const db = this.container.db;
    const target = message.mentions.users.first() ?? message.author;
    const self = target.id === message.author.id;
    const name = message.guild?.members.cache.get(target.id)?.displayName ?? target.username;

    let page = 0;
    let picked: Partial<Record<Group, string>> = {};
    const reply = await message.reply(invPayload(db, target.id, name, page, self));
    if (!self) return reply;

    const collector = ownerCollector(reply, message.author.id);

    collector.on('collect', async (i) => {
      const userId = message.author.id;

      if (i.isButton() && i.customId === 'inv:prev') {
        page -= 1;
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:next') {
        page += 1;
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:open') {
        return void (await i.update(openPayload(db, userId)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'inv:craft') {
        picked = cheapestByGroup(ownedOf(db, userId));
        return void (await i.update(craftPickPayload(db, userId, picked)).catch(() => {}));
      }
      if (i.isStringSelectMenu() && i.customId.startsWith('craft:')) {
        const g = i.customId.slice('craft:'.length) as Group;
        picked[g] = i.values[0];
        return void (await i.update(craftPickPayload(db, userId, picked)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'craft:cancel') {
        return void (await i.update(invPayload(db, userId, name, page, true)).catch(() => {}));
      }
      if (i.isButton() && i.customId === 'craft:go') {
        const ids = CRAFT_GROUPS.map((g) => picked[g]).filter(Boolean) as string[];
        picked = {};
        return void (await i.update(craftConfirmPayload(db, userId, ids)).catch(() => {}));
      }
    });

    return reply;
  }
}

const TOP_META: Record<TopKey, { label: string; emoji: string; fmt: (v: number) => string }> = {
  points: { label: 'Điểm', emoji: '🏆', fmt: (v) => `${v.toLocaleString('vi-VN')} điểm` },
  msg: { label: 'Chat', emoji: '💬', fmt: (v) => `${v.toLocaleString('vi-VN')} tin nhắn` },
  voice: { label: 'Voice', emoji: '🔊', fmt: (v) => fmtDuration(v) },
  crafts: { label: 'Mâm cỗ', emoji: '🥮', fmt: (v) => `${v} mâm` }
};

const MEDALS = ['🥇', '🥈', '🥉'];

async function displayName(message: Message, id: string): Promise<string> {
  const cached = message.guild?.members.cache.get(id);
  if (cached) return cached.displayName;
  const user = await message.client.users.fetch(id).catch(() => null);
  return user ? user.username : 'Người dùng đã rời';
}

async function topPayload(db: DB, message: Message, key: TopKey, page: number) {
  const meta = TOP_META[key];
  const total = topCount(db, key);
  const maxPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const p = Math.min(Math.max(0, page), maxPage - 1);
  const rows = topPage(db, key, p * PER_PAGE, PER_PAGE);

  const lines: string[] = [];
  for (const [idx, row] of rows.entries()) {
    const rank = p * PER_PAGE + idx + 1;
    const badge = rank <= 3 ? MEDALS[rank - 1] : `**${rank}.**`;
    lines.push(`${badge} ${await displayName(message, row.user_id)} · ${meta.fmt(row.value)}`);
  }

  const myRank = rankOf(db, key, message.author.id);
  const myValue = topPage(db, key, Math.max(0, myRank - 1), 1).find((r) => r.user_id === message.author.id);
  const footer =
    myRank > 0
      ? `Bạn: #${myRank} · ${meta.fmt(myValue?.value ?? 0)}   |   Trang ${p + 1}/${maxPage}`
      : `Bạn chưa có trên bảng này   |   Trang ${p + 1}/${maxPage}`;

  const e = embed(
    `${meta.emoji} Bảng xếp hạng · ${meta.label}`,
    lines.length ? lines.join('\n') : '_Chưa có ai trên bảng này._'
  ).setFooter({ text: footer });

  const nav = buttonRow(
    new ButtonBuilder().setCustomId('top:prev').setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId('top:next')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= maxPage - 1)
  );

  const picker = selectRow(
    new StringSelectMenuBuilder()
      .setCustomId('top:board')
      .setPlaceholder('Chọn bảng')
      .addOptions(
        (Object.keys(TOP_META) as TopKey[]).map((k) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(TOP_META[k].label)
            .setEmoji(TOP_META[k].emoji)
            .setValue(k)
            .setDefault(k === key)
        )
      )
  );

  return { embeds: [e], components: [nav, picker] };
}

export class TopCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'top', aliases: ['rank', 'bxh'], description: 'Bảng xếp hạng event' });
  }

  public override async messageRun(message: Message) {
    const db = this.container.db;
    let key: TopKey = 'points';
    let page = 0;

    const reply = await message.reply(await topPayload(db, message, key, page));
    const collector = ownerCollector(reply, message.author.id);

    collector.on('collect', async (i) => {
      if (i.isButton() && i.customId === 'top:prev') page -= 1;
      else if (i.isButton() && i.customId === 'top:next') page += 1;
      else if (i.isStringSelectMenu() && i.customId === 'top:board') {
        key = i.values[0] as TopKey;
        page = 0;
      } else return;

      await i.update(await topPayload(db, message, key, page)).catch(() => {});
    });

    return reply;
  }
}
