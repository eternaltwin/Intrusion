import type { SoundCue } from '@intrusion/shared';

const BASE_VOLUMES: Record<string, number> = {
  absorb_02: 0.18,
  alarm_01: 0.25,
  alarm_02: 0.2,
  bleep_01: 0.12,
  bleep_02: 0.16,
  bleep_04: 0.18,
  bleep_05: 0.18,
  bleep_06: 0.2,
  bleep_07: 0.18,
  bonus_01: 0.22,
  bonus_02: 0.24,
  corrupt_01: 0.28,
  corrupt_02: 0.35,
  drone_02: 0.24,
  electro_02: 0.22,
  explode_01: 0.25,
  explode_02: 0.28,
  hit_01: 0.2,
  hit_03: 0.24,
  menu: 0.24,
  modem_03: 0.22,
  progress_01: 0.12,
  rythme_02: 0.25,
  rythme_03: 0.28,
  shield: 0.18,
  single_01: 0.18,
};

export class SoundEngine {
  private loops = new Map<string, { audio: HTMLAudioElement; channel: 'sfx' | 'ambient' | 'beat' }>();
  public enabled = {
    sfx: true,
    ambiant: true,
    beat: true,
  };

  public syncSettings(settings: { sfx: boolean; ambiant: boolean; beat: boolean }): void {
    this.enabled = { ...settings };
    for (const [, entry] of this.loops.entries()) {
      const chEnabled =
        entry.channel === 'sfx'
          ? this.enabled.sfx
          : entry.channel === 'ambient'
            ? this.enabled.ambiant
            : this.enabled.beat;
      entry.audio.muted = !chEnabled;
    }
  }

  public processCues(cues: SoundCue[]): void {
    for (const cue of cues) {
      if (cue.kind === 'sfx') {
        this.playSfx(cue.id);
      } else if (cue.kind === 'loop_start') {
        this.startLoop(cue.id, cue.channel);
      } else if (cue.kind === 'loop_stop') {
        this.stopLoop(cue.id);
      }
    }
  }

  public playSfx(id: string): void {
    if (!this.enabled.sfx) return;
    try {
      const audio = new Audio(`/assets/sfx/${id}.wav.mp3`);
      audio.volume = BASE_VOLUMES[id] ?? 0.2;
      void audio.play().catch(() => {});
    } catch {}
  }

  public startLoop(id: string, channel: 'sfx' | 'ambient' | 'beat'): void {
    if (this.loops.has(id)) return;
    try {
      const audio = new Audio(`/assets/sfx/${id}.wav.mp3`);
      audio.loop = true;
      audio.volume = BASE_VOLUMES[id] ?? 0.22;
      const chEnabled =
        channel === 'sfx'
          ? this.enabled.sfx
          : channel === 'ambient'
            ? this.enabled.ambiant
            : this.enabled.beat;
      audio.muted = !chEnabled;
      this.loops.set(id, { audio, channel });
      void audio.play().catch(() => {});
    } catch {}
  }

  public stopLoop(id: string): void {
    const entry = this.loops.get(id);
    if (!entry) return;
    try {
      entry.audio.pause();
      entry.audio.currentTime = 0;
    } catch {}
    this.loops.delete(id);
  }

  public stopAll(): void {
    for (const id of Array.from(this.loops.keys())) {
      this.stopLoop(id);
    }
  }
}

export const soundEngine = new SoundEngine();
