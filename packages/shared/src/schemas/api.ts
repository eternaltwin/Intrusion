import { z } from 'zod';

export const AuthCredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Min 2 chars')
    .max(24, 'Max 24 chars')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, _ and - only'),
  password: z.string().min(4, 'Min 4 chars').max(128),
});

export const SaveDeckSchema = z.object({
  deckId: z.string(),
  name: z.string().trim().min(1).max(32),
  content: z.array(z.string()).max(9),
  isFavorite: z.boolean().optional(),
});

export const SetChipsetSchema = z.object({
  chipsetId: z.string().nullable(),
});

export const BuyItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('virus'), id: z.string() }),
  z.object({ kind: z.literal('chipset'), id: z.string() }),
  z.object({ kind: z.literal('bios') }),
  z.object({ kind: z.literal('deck_slot'), deckId: z.string() }),
  z.object({ kind: z.literal('new_deck') }),
]);

export const SellPackSchema = z.object({
  valuableId: z.string(),
  count: z.number().int().min(1).max(20),
});

export const RedeemCardSchema = z.object({
  cardId: z.string(),
});

export const RedeemCardByNumberSchema = z.object({
  number: z.string().trim().min(4).max(64),
});

export const UpdateProfileSchema = z.object({
  leet: z.boolean().optional(),
  adult: z.boolean().optional(),
  sfx: z.boolean().optional(),
  ambiant: z.boolean().optional(),
  beat: z.boolean().optional(),
  crtEffect: z.boolean().optional(),
  lang: z.enum(['fr', 'en']).optional(),
  cfg: z.string().max(4000).optional(),
  keybinds: z.array(z.string()).length(10).optional(),
});

export const MissionEndPayloadSchema = z.object({
  missionKey: z.string(),
  seed: z.number().int(),
  gl: z.number().int(),
  isChallenge: z.boolean(),
  scoutRun: z.boolean(),
  success: z.boolean(),
  kills: z.number().int().min(0).max(10000),
  remainingSec: z.number().int().min(0),
  valuables: z.array(z.string()).max(40),
  copiedFiles: z
    .array(
      z.object({
        name: z.string(),
        content: z.string(),
        embed: z.string().nullable(),
      })
    )
    .max(30),
  stolenCards: z
    .array(
      z.object({
        id: z.string(),
        holder: z.string(),
        number: z.string(),
        amount: z.number().int().min(0),
      })
    )
    .max(10),
  goals: z.record(z.string(), z.number().int().min(0)),
  score: z.number().int().min(0),
});

export interface PlayerDto {
  id: number;
  username: string;
  money: number;
  xp: number;
  level: number;
  nextLevelXp: number;
  biosLevel: number;
  activeChipset: string | null;
  viruses: string[];
  chipsets: string[];
  decks: Array<{
    id: string;
    slotIndex: number;
    name: string;
    capacity: number;
    isFavorite: boolean;
    content: string[];
  }>;
  valuables: Record<string, number>;
  goals: Record<string, number>;
  settings: {
    leet: boolean;
    adult: boolean;
    sfx: boolean;
    ambiant: boolean;
    beat: boolean;
    crtEffect: boolean;
    lang: 'fr' | 'en';
    cfg: string;
    keybinds: string[];
  };
}
