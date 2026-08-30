export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Group = 'banh' | 'den' | 'khac';

export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  group: Group;
  emoji: string;
}

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '⚪ Thường',
  uncommon: '🟢 Hiếm',
  rare: '🔵 Quý',
  epic: '🟣 Cực quý',
  legendary: '🌕 Huyền thoại'
};

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x99aab5,
  uncommon: 0x57f287,
  rare: 0x3498db,
  epic: 0x9b59b6,
  legendary: 0xf1c40f
};

export const GROUP_LABEL: Record<Group, string> = {
  banh: 'Bánh',
  den: 'Đèn',
  khac: 'Đồ chơi & khác'
};

export const ITEMS: Item[] = [
  { id: 'banh_thap_cam',   name: 'Bánh nướng thập cẩm',      rarity: 'common',    group: 'banh', emoji: '🥮' },
  { id: 'banh_deo_sen',    name: 'Bánh dẻo hạt sen',         rarity: 'common',    group: 'banh', emoji: '🌸' },
  { id: 'tra_sen',         name: 'Trà sen',                  rarity: 'common',    group: 'khac', emoji: '🍵' },
  { id: 'banh_trung_muoi', name: 'Bánh trứng muối tan chảy', rarity: 'uncommon',  group: 'banh', emoji: '🥚' },
  { id: 'den_ong_sao',     name: 'Đèn ông sao',              rarity: 'uncommon',  group: 'den',  emoji: '⭐' },
  { id: 'mat_na',          name: 'Mặt nạ giấy bồi',          rarity: 'uncommon',  group: 'khac', emoji: '🎭' },
  { id: 'banh_sau_rieng',  name: 'Bánh dẻo lạnh sầu riêng',  rarity: 'rare',      group: 'banh', emoji: '🍡' },
  { id: 'den_keo_quan',    name: 'Đèn kéo quân',             rarity: 'rare',      group: 'den',  emoji: '🏮' },
  { id: 'trong_boi',       name: 'Trống bỏi',                rarity: 'rare',      group: 'khac', emoji: '🥁' },
  { id: 'banh_vi_ca',      name: 'Bánh nướng vi cá 4 trứng', rarity: 'epic',      group: 'banh', emoji: '🍱' },
  { id: 'dau_lan',         name: 'Đầu lân',                  rarity: 'epic',      group: 'khac', emoji: '🦁' },
  { id: 'chi_hang',        name: 'Chị Hằng',                 rarity: 'legendary', group: 'khac', emoji: '🧚' },
  { id: 'chu_cuoi',        name: 'Chú Cuội',                 rarity: 'legendary', group: 'khac', emoji: '🌳' },
  { id: 'tho_ngoc',        name: 'Thỏ Ngọc',                 rarity: 'legendary', group: 'khac', emoji: '🐇' }
];

export const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));

export function rollRarity(weights: Record<Rarity, number>, rnd: () => number = Math.random): Rarity {
  const total = RARITIES.reduce((s, r) => s + Math.max(0, weights[r] ?? 0), 0);
  if (total <= 0) return 'common';
  let x = rnd() * total;
  for (const r of RARITIES) {
    x -= Math.max(0, weights[r] ?? 0);
    if (x < 0) return r;
  }
  return 'common';
}

export function rollItem(weights: Record<Rarity, number>, rnd: () => number = Math.random): Item {
  const rarity = rollRarity(weights, rnd);
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  return pool[Math.floor(rnd() * pool.length)]!;
}

export function craftGain(ids: string[], rarityPoints: Record<Rarity, number>): number {
  return 2 * ids.reduce((s, id) => s + rarityPoints[ITEM_MAP.get(id)!.rarity], 0);
}
