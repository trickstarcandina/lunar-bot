import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type VoiceBasedChannel, type VoiceState } from 'discord.js';
import { closeVoice, openVoice, type DB } from '../lib/db.js';

/**
 * Điều kiện được tính giờ voice: kênh có từ 2 người thật trở lên, bản thân không deaf.
 * ponytail: chống AFK ở mức này là đủ; muốn chặt hơn (mute lâu, không camera)
 * thì thêm điều kiện ngay trong hàm này, mọi nơi gọi đều hưởng.
 */
export function voiceEligible(channel: VoiceBasedChannel, member: GuildMember): boolean {
  if (member.user.bot) return false;
  const humans = channel.members.filter((m) => !m.user.bot);
  if (humans.size < 2) return false;
  return !member.voice.selfDeaf && !member.voice.deaf;
}

/**
 * Đồng bộ trạng thái một voice channel: ai đủ điều kiện thì mở session,
 * ai không đủ thì đóng và cộng dồn thời gian.
 */
export function syncVoiceChannel(db: DB, channel: VoiceBasedChannel, now: number): void {
  const humans = channel.members.filter((m) => !m.user.bot);
  for (const member of humans.values()) {
    if (voiceEligible(channel, member)) openVoice(db, member.id, now);
    else closeVoice(db, member.id, now);
  }
}

export class VoiceCounter extends Listener<typeof Events.VoiceStateUpdate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.VoiceStateUpdate });
  }

  public override run(oldState: VoiceState, newState: VoiceState): void {
    const db = this.container.db;
    const now = Math.floor(Date.now() / 1000);

    const member = newState.member ?? oldState.member;
    // Rời hẳn hoặc chuyển kênh: đóng session trước, syncVoiceChannel mở lại nếu vẫn hợp lệ.
    if (member && !member.user.bot && oldState.channelId && oldState.channelId !== newState.channelId) {
      closeVoice(db, member.id, now);
    }

    if (oldState.channel) syncVoiceChannel(db, oldState.channel, now);
    if (newState.channel) syncVoiceChannel(db, newState.channel, now);
  }
}
