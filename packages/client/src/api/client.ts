import type {
  AntivirusDef,
  ChipsetDef,
  LangCode,
  MissionEndSummary,
  MissionInitParams,
  PlayerDto,
  RawXmlBundle,
  SimpleFile,
  StolenCard,
  ValuableDef,
  VirusDef,
} from '@intrusion/shared';

export interface CatalogResponse {
  lang: LangCode;
  viruses: VirusDef[];
  antiviruses: AntivirusDef[];
  chipsets: ChipsetDef[];
  valuables: ValuableDef[];
  biosCosts: number[];
  addDeckCost: number[];
  addSlotCost: number[];
  rawXml: RawXmlBundle;
}

export interface MissionOfferDto {
  missionKey: string;
  seed: number;
  level: number;
  corp: string;
  colorHex: string;
  short: string;
  details: string;
  basePrime: number;
  effectivePrime: number;
  bonus: number;
  tries: number;
  difficulty: 'easy' | 'medium' | 'hard';
  expiresAt: number;
  status: 'tutorial' | 'available' | 'active' | 'completed';
}

export interface MissionsListResponse {
  tutorials: MissionOfferDto[];
  available: MissionOfferDto[];
  active: MissionOfferDto[];
  completed: MissionOfferDto[];
}

export interface StorageResponse {
  date: string;
  dailyQuota: number;
  soldToday: number;
  remainingQuota: number;
  marketMultipliers: Record<string, number>;
  files: Required<SimpleFile>[];
  cards: Array<StolenCard & { redeemed: number; capturedAt: string }>;
}

export interface ChallengeTodayResponse {
  date: string;
  seed: number;
  level: number;
  corp: string;
  colorHex: string;
  short: string;
  details: string;
  hasPlayedRanked: boolean;
  playerRankedRun: any;
  leaderboard: Array<{
    username: string;
    bestScore: number;
    remainingSec: number;
    kills: number;
    createdAt: string;
  }>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  me: () => requestJson<{ player: PlayerDto | null }>('/api/auth/me'),
  login: (username: string, password: string) =>
    requestJson<{ player: PlayerDto }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    requestJson<{ player: PlayerDto }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  catalog: (lang: LangCode) => requestJson<CatalogResponse>(`/api/catalog?lang=${lang}`),

  missions: () => requestJson<MissionsListResponse>('/api/missions'),
  refreshMissions: () =>
    requestJson<{ available: MissionOfferDto[]; player: PlayerDto }>('/api/missions/refresh', {
      method: 'POST',
    }),
  startMission: (missionKey: string) =>
    requestJson<{ init: MissionInitParams }>(`/api/missions/${encodeURIComponent(missionKey)}/start`, {
      method: 'POST',
    }),
  endMission: (missionKey: string, summary: MissionEndSummary) =>
    requestJson<{ earnedMoney: number; earnedXp: number; scoutRun: boolean; player: PlayerDto }>(
      `/api/missions/${encodeURIComponent(missionKey)}/end`,
      {
        method: 'POST',
        body: JSON.stringify(summary),
      }
    ),

  challengeToday: () => requestJson<ChallengeTodayResponse>('/api/challenges/today'),
  startChallenge: () =>
    requestJson<{ init: MissionInitParams }>('/api/challenges/today/start', { method: 'POST' }),
  endChallenge: (summary: MissionEndSummary) =>
    requestJson<{ isRanked: boolean; rewardMoney: number; score: number; player: PlayerDto }>(
      '/api/challenges/today/end',
      {
        method: 'POST',
        body: JSON.stringify(summary),
      }
    ),

  saveDeck: (deckId: string, payload: { name: string; content: string[]; isFavorite?: boolean }) =>
    requestJson<{ player: PlayerDto }>(`/api/decks/${encodeURIComponent(deckId)}`, {
      method: 'PUT',
      body: JSON.stringify({ deckId, ...payload }),
    }),
  setChipset: (chipsetId: string | null) =>
    requestJson<{ player: PlayerDto }>('/api/decks/chipset', {
      method: 'POST',
      body: JSON.stringify({ chipsetId }),
    }),

  buyItem: (
    payload:
      | { kind: 'virus'; id: string }
      | { kind: 'chipset'; id: string }
      | { kind: 'bios' }
      | { kind: 'new_deck' }
      | { kind: 'deck_slot'; deckId: string }
  ) =>
    requestJson<{ player: PlayerDto }>('/api/store/buy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  storage: () => requestJson<StorageResponse>('/api/storage'),
  sellPack: (valuableId: string, count: number) =>
    requestJson<{ soldQty: number; totalEarned: number; remainingQuota: number; player: PlayerDto }>(
      '/api/storage/sell-pack',
      {
        method: 'POST',
        body: JSON.stringify({ valuableId, count }),
      }
    ),
  redeemCard: (cardId: string) =>
    requestJson<{ earned: number; player: PlayerDto }>('/api/storage/redeem-card', {
      method: 'POST',
      body: JSON.stringify({ cardId }),
    }),
  redeemCardByNumber: (number: string) =>
    requestJson<{ earned: number; cardNumber: string; player: PlayerDto }>(
      '/api/storage/redeem-card-number',
      {
        method: 'POST',
        body: JSON.stringify({ number }),
      }
    ),
  deleteFile: (fileId: string) =>
    requestJson<{ ok: boolean }>(`/api/storage/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    }),

  updateProfile: (patch: Partial<PlayerDto['settings']>) =>
    requestJson<{ player: PlayerDto }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};
