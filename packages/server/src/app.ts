import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import {
  ADD_DECK_COST,
  ADD_SLOT_COST,
  AuthCredentialsSchema,
  BuyItemSchema,
  generateMission,
  getAdjustedPrime,
  getMissionDifficultyLabel,
  MissionEndPayloadSchema,
  Rand,
  RedeemCardByNumberSchema,
  RedeemCardSchema,
  SaveDeckSchema,
  SellPackSchema,
  SetChipsetSchema,
  UpdateProfileSchema,
  type LangCode,
  type MissionInitParams,
  type PlayerDto,
} from '@intrusion/shared';
import { openDatabase } from './db/database.js';
import { getCatalog } from './catalog.js';
import {
  buildPlayerDto,
  createSession,
  deleteSession,
  getUserIdFromSession,
  registerNewUser,
  verifyPassword,
} from './services/auth.js';

export const BIOS_COSTS = [0, 0, 6000, 15000, 35000] as const; // index = target bios level (2, 3, 4)
const SESSION_COOKIE = 'intrusion_sid';
const MISSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DAILY_PACK_QUOTA = 20;

type AppVariables = {
  userId: number;
  player: PlayerDto;
};

export interface CreateAppOptions {
  dbPath: string;
  assetsDir: string;
  clientDistDir?: string;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailySeedFromDate(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 8999999 + 1000000;
}

function getDailyMarketMultipliers(dateStr: string, valuableIds: string[]): Record<string, number> {
  const rng = Rand.fromSeed(dailySeedFromDate(dateStr) ^ 0x7712ab);
  const out: Record<string, number> = {};
  for (const id of valuableIds) {
    // 0.85x to 1.30x daily black market fluctuation
    out[id] = Math.round((0.85 + (rng.random(46) / 100)) * 100) / 100;
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

export function createApp(opts: CreateAppOptions) {
  const db = openDatabase(opts.dbPath);
  const app = new Hono<{ Variables: AppVariables }>();

  // --- Auth Endpoints ---
  app.post('/api/auth/register', zValidator('json', AuthCredentialsSchema), (c) => {
    const { username, password } = c.req.valid('json');
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);
    if (existing) {
      return c.json({ error: 'Ce pseudonyme est déjà réservé par un autre opérateur.' }, 409);
    }

    const catalog = getCatalog(opts.assetsDir, 'fr');
    const userId = registerNewUser(db, catalog, username, password);
    const token = createSession(db, userId);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return c.json({ player: buildPlayerDto(db, userId) }, 201);
  });

  app.post('/api/auth/login', zValidator('json', AuthCredentialsSchema), (c) => {
    const { username, password } = c.req.valid('json');
    const row = db
      .prepare('SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: number; password_hash: string } | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      return c.json({ error: 'Identifiants invalides.' }, 401);
    }

    const token = createSession(db, row.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return c.json({ player: buildPlayerDto(db, row.id) });
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = getUserIdFromSession(db, token);
    if (!userId) return c.json({ player: null });
    return c.json({ player: buildPlayerDto(db, userId) });
  });

  // --- Public Catalog + Raw XML Bundle for Client Simulation ---
  app.get('/api/catalog', (c) => {
    const langParam = c.req.query('lang') === 'en' ? 'en' : 'fr';
    const bundle = getCatalog(opts.assetsDir, langParam);
    const xmlDir = path.join(opts.assetsDir, 'xml');
    const readXml = (f: string) => fs.readFileSync(path.join(xmlDir, f), 'utf8');

    return c.json({
      lang: langParam,
      viruses: Array.from(bundle.viruses.values()),
      antiviruses: Array.from(bundle.antiviruses.values()).filter((a) => a.key !== 'avslot'),
      chipsets: Array.from(bundle.chipsets.values()),
      valuables: Array.from(bundle.valuables.values()),
      biosCosts: BIOS_COSTS,
      addDeckCost: ADD_DECK_COST,
      addSlotCost: ADD_SLOT_COST,
      rawXml: {
        virus: readXml(langParam === 'en' ? 'virus.en.xml' : 'virus.xml'),
        antivirus: readXml(langParam === 'en' ? 'antivirus.en.xml' : 'antivirus.xml'),
        chipsets: readXml(langParam === 'en' ? 'chipsets.en.xml' : 'chipsets.xml'),
        valuables: readXml(langParam === 'en' ? 'valuables.en.xml' : 'valuables.xml'),
        langClient: readXml(`lang.client.${langParam}.xml`),
        tutorials: readXml(`tutorials.${langParam}.xml`),
        sysPatterns: readXml('sysPatterns.xml'),
        texts: readXml(`texts.${langParam}.xml`),
        fsNames: readXml(`fsNames.${langParam}.xml`),
        names: readXml(`names.${langParam}.xml`),
      },
    });
  });

  // --- Authenticated API Middleware ---
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/catalog') {
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    const userId = getUserIdFromSession(db, token);
    if (!userId) return c.json({ error: 'Non authentifié.' }, 401);
    const player = buildPlayerDto(db, userId);
    if (!player) return c.json({ error: 'Session expirée.' }, 401);
    c.set('userId', userId);
    c.set('player', player);
    return next();
  });

  // --- Helper: Ensure available missions exist & aren't expired ---
  function ensureAvailableMissions(userId: number, player: PlayerDto, lang: LangCode) {
    const now = Date.now();
    // Clean expired available missions
    db.prepare(
      "DELETE FROM missions WHERE user_id = ? AND status = 'available' AND (? - created_at) > ?"
    ).run(userId, now, MISSION_EXPIRY_MS);

    let rows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'available' ORDER BY created_at ASC")
      .all(userId) as Array<{
      mission_key: string;
      seed: number;
      level: number;
      prime: number;
      tries: number;
      created_at: number;
    }>;

    if (rows.length === 0) {
      const bundle = getCatalog(opts.assetsDir, lang);
      const count = player.level < 4 ? 1 : 9;
      const insertStmt = db.prepare(
        "INSERT INTO missions (mission_key, user_id, seed, level, prime, status, tries, created_at) VALUES (?, ?, ?, ?, ?, 'available', 0, ?)"
      );
      for (let i = 0; i < count; i++) {
        const seed = Math.floor(100000 + Math.random() * 8900000);
        const rawLvl =
          player.level < 4
            ? player.level
            : Math.max(4, Math.min(9, player.level + Math.floor(Math.random() * 3) - 1));
        const mdata = generateMission(bundle, rawLvl, seed, player.settings.adult);
        const mkey = `m_${seed}_${rawLvl}`;
        insertStmt.run(mkey, userId, seed, rawLvl, mdata.prime, now);
      }
      rows = db
        .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'available' ORDER BY created_at ASC")
        .all(userId) as typeof rows;
    }
    return rows;
  }

  function formatMissionRow(
    bundle: ReturnType<typeof getCatalog>,
    player: PlayerDto,
    row: {
      mission_key: string;
      seed: number;
      level: number;
      tries: number;
      created_at: number;
      status?: string;
    }
  ) {
    const mdata = generateMission(bundle, row.level, row.seed, player.settings.adult);
    return {
      missionKey: row.mission_key,
      seed: row.seed,
      level: mdata.gl,
      corp: mdata.corp,
      colorHex: mdata.colorHex,
      short: mdata.short,
      details: mdata.details,
      basePrime: mdata.prime,
      effectivePrime: getAdjustedPrime(mdata.prime, row.tries),
      bonus: mdata.bonus,
      tries: row.tries,
      difficulty: getMissionDifficultyLabel(mdata.gl, player.level),
      expiresAt: row.created_at + MISSION_EXPIRY_MS,
      status: row.status ?? 'available',
    };
  }

  function buildOrderedDecks(player: PlayerDto) {
    const sorted = [...player.decks].sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.slotIndex - b.slotIndex;
    });
    return sorted.map((d) => ({
      id: d.id,
      name: d.name,
      capacity: d.capacity,
      isFavorite: d.isFavorite,
      content: d.content,
    }));
  }

  // --- Missions Routes ---
  app.get('/api/missions', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const availableRows = ensureAvailableMissions(userId, player, player.settings.lang);
    const activeRows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC")
      .all(userId) as any[];
    const completedRows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 30")
      .all(userId) as any[];

    const tutorials = [1, 2, 3].map((lvl) => {
      const tSeed = 1000 + lvl * 111;
      const mdata = generateMission(bundle, lvl, tSeed, true);
      return {
        missionKey: `tuto_${lvl}`,
        seed: tSeed,
        level: lvl,
        corp: mdata.corp,
        colorHex: mdata.colorHex,
        short: mdata.short,
        details: mdata.details,
        basePrime: mdata.prime,
        effectivePrime: mdata.prime,
        bonus: 0,
        tries: 0,
        difficulty: 'easy' as const,
        expiresAt: Date.now() + MISSION_EXPIRY_MS,
        status: 'tutorial' as const,
      };
    });

    return c.json({
      tutorials,
      available: availableRows.map((r) => formatMissionRow(bundle, player, r)),
      active: activeRows.map((r) => formatMissionRow(bundle, player, r)),
      completed: completedRows.map((r) => formatMissionRow(bundle, player, r)),
    });
  });

  app.post('/api/missions/refresh', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    db.prepare("DELETE FROM missions WHERE user_id = ? AND status = 'available'").run(userId);
    const availableRows = ensureAvailableMissions(userId, player, player.settings.lang);
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    return c.json({
      available: availableRows.map((r) => formatMissionRow(bundle, player, r)),
    });
  });

  app.post('/api/missions/:missionKey/start', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const missionKey = c.req.param('missionKey');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    let seed: number;
    let level: number;
    let tries = 0;

    if (missionKey.startsWith('tuto_')) {
      level = Math.max(1, Math.min(3, parseInt(missionKey.split('_')[1] ?? '1', 10)));
      seed = 1000 + level * 111;
    } else {
      const row = db
        .prepare('SELECT * FROM missions WHERE user_id = ? AND mission_key = ?')
        .get(userId, missionKey) as
        | { seed: number; level: number; status: string; tries: number }
        | undefined;
      if (!row) return c.json({ error: 'Mission introuvable.' }, 404);
      if (row.status === 'completed') return c.json({ error: 'Mission déjà accomplie.' }, 400);
      if (row.status === 'available') {
        db.prepare("UPDATE missions SET status = 'active' WHERE user_id = ? AND mission_key = ?").run(
          userId,
          missionKey
        );
      }
      seed = row.seed;
      level = row.level;
      tries = row.tries;
    }

    const mdata = generateMission(bundle, level, seed, player.settings.adult);

    // Deterministic credit cards embedded in target network mails/docs via GNetwork.dispatchCards
    const cardStrings: string[] = [];
    if (level >= 4) {
      const cardRng = Rand.fromSeed(seed ^ 0x51a9c3);
      const insertCard = db.prepare(`
        INSERT OR IGNORE INTO stolen_cards (id, user_id, holder, card_number, amount, redeemed)
        VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (let i = 0; i < 3; i++) {
        const p1 = String(1000 + cardRng.random(9000));
        const p2 = String(1000 + cardRng.random(9000));
        const p3 = String(1000 + cardRng.random(9000));
        const num = `4971-${p1}-${p2}-${p3}`;
        const amount = (2 + cardRng.random(level * 2)) * 100;
        cardStrings.push(num);
        insertCard.run(`cc_${userId}_${seed}_${i}`, userId, mdata.corp, num, Math.min(5000, amount));
      }
    }

    const init: MissionInitParams = {
      missionKey,
      seed,
      gl: level,
      mission: mdata,
      cards: cardStrings,
      decks: buildOrderedDecks(player),
      chipset: player.activeChipset,
      isChallenge: false,
      biosLevel: player.biosLevel,
      tries,
      profile: {
        username: player.username,
        level: player.level,
        leet: player.settings.leet,
        adult: player.settings.adult,
        cfg: player.settings.cfg,
        sfx: player.settings.sfx,
        ambiant: player.settings.ambiant,
        beat: player.settings.beat,
        lang: player.settings.lang,
      },
    };

    return c.json({ init });
  });

  app.post('/api/missions/:missionKey/end', zValidator('json', MissionEndPayloadSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const missionKey = c.req.param('missionKey');
    const end = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const isTutorial = missionKey.startsWith('tuto_');
    const row = isTutorial
      ? {
          seed: end.seed,
          level: end.gl,
          prime: generateMission(bundle, end.gl, end.seed, true).prime,
          status: 'active',
          tries: 0,
        }
      : (db
          .prepare('SELECT * FROM missions WHERE user_id = ? AND mission_key = ?')
          .get(userId, missionKey) as
          | { seed: number; level: number; prime: number; status: string; tries: number }
          | undefined);

    if (!row) return c.json({ error: 'Mission introuvable.' }, 404);

    let earnedMoney = 0;
    let earnedXp = 0;

    if (end.scoutRun) {
      // Scout chipset: exploratory run — does not consume tries or complete mission
      return c.json({
        earnedMoney: 0,
        earnedXp: 0,
        scoutRun: true,
        player: buildPlayerDto(db, userId),
      });
    }

    if (end.success && row.status !== 'completed') {
      earnedMoney = getAdjustedPrime(row.prime, row.tries);
      earnedXp = isTutorial ? 0 : 1;

      db.prepare('UPDATE users SET money = money + ?, xp = xp + ? WHERE id = ?').run(
        earnedMoney,
        earnedXp,
        userId
      );

      if (!isTutorial) {
        db.prepare(
          "UPDATE missions SET status = 'completed', completed_at = ? WHERE user_id = ? AND mission_key = ?"
        ).run(Date.now(), userId, missionKey);
      }

      // Goals
      const upsertGoal = db.prepare(`
        INSERT INTO user_goals (user_id, goal_id, value) VALUES (?, ?, ?)
        ON CONFLICT(user_id, goal_id) DO UPDATE SET value = value + excluded.value
      `);
      upsertGoal.run(userId, 'missions_fulfilled', 1);
      if (row.tries === 0 && !isTutorial) {
        upsertGoal.run(userId, 'firsttry', 1);
      }
      for (const [gid, count] of Object.entries(end.goals)) {
        if (count > 0) upsertGoal.run(userId, gid, count);
      }

      // Valuables
      const upsertValuable = db.prepare(`
        INSERT INTO user_valuables (user_id, valuable_id, quantity) VALUES (?, ?, 1)
        ON CONFLICT(user_id, valuable_id) DO UPDATE SET quantity = quantity + 1
      `);
      for (const vid of end.valuables) {
        if (bundle.valuables.has(vid)) {
          upsertValuable.run(userId, vid);
        }
      }

      // Stolen files
      const insertFile = db.prepare(
        'INSERT INTO stolen_files (id, user_id, name, content, embed) VALUES (?, ?, ?, ?, ?)'
      );
      for (const sf of end.copiedFiles.slice(0, 20)) {
        insertFile.run(randomUUID(), userId, sf.name, sf.content, sf.embed);
      }

      // Stolen credit cards
      const insertCard = db.prepare(`
        INSERT OR IGNORE INTO stolen_cards (id, user_id, holder, card_number, amount, redeemed)
        VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (const card of end.stolenCards.slice(0, 5)) {
        insertCard.run(card.id, userId, card.holder, card.number, Math.min(5000, card.amount));
      }
    } else if (!end.success && !isTutorial && row.status === 'active') {
      db.prepare('UPDATE missions SET tries = tries + 1 WHERE user_id = ? AND mission_key = ?').run(
        userId,
        missionKey
      );
    }

    return c.json({
      earnedMoney,
      earnedXp,
      scoutRun: false,
      player: buildPlayerDto(db, userId),
    });
  });

  // --- Daily Challenge Routes ---
  app.get('/api/challenges/today', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const seed = dailySeedFromDate(dateStr);
    const gl = 7;
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const mdata = generateMission(bundle, gl, seed, true);

    const leaderboard = db
      .prepare(
        `SELECT username, MAX(score) as bestScore, remaining_sec as remainingSec, kills, created_at as createdAt
         FROM challenge_runs
         WHERE challenge_date = ? AND is_ranked = 1 AND success = 1
         GROUP BY user_id
         ORDER BY bestScore DESC, remainingSec DESC
         LIMIT 25`
      )
      .all(dateStr);

    const playerRankedRun = db
      .prepare(
        'SELECT * FROM challenge_runs WHERE challenge_date = ? AND user_id = ? AND is_ranked = 1 LIMIT 1'
      )
      .get(dateStr, userId);

    return c.json({
      date: dateStr,
      seed,
      level: gl,
      corp: mdata.corp,
      colorHex: mdata.colorHex,
      short: mdata.short,
      details: mdata.details,
      hasPlayedRanked: Boolean(playerRankedRun),
      playerRankedRun: playerRankedRun ?? null,
      leaderboard,
    });
  });

  app.post('/api/challenges/today/start', (c) => {
    const player = c.get('player');
    const dateStr = todayDateStr();
    const seed = dailySeedFromDate(dateStr);
    const gl = 7;
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const mdata = generateMission(bundle, gl, seed, true);

    const init: MissionInitParams = {
      missionKey: `challenge_${dateStr}`,
      seed,
      gl,
      mission: mdata,
      decks: buildOrderedDecks(player),
      chipset: player.activeChipset,
      isChallenge: true,
      biosLevel: player.biosLevel,
      tries: 0,
      profile: {
        username: player.username,
        level: player.level,
        leet: player.settings.leet,
        adult: true,
        cfg: player.settings.cfg,
        sfx: player.settings.sfx,
        ambiant: player.settings.ambiant,
        beat: player.settings.beat,
        lang: player.settings.lang,
      },
    };
    return c.json({ init });
  });

  app.post('/api/challenges/today/end', zValidator('json', MissionEndPayloadSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const end = c.req.valid('json');

    const alreadyRanked = db
      .prepare('SELECT id FROM challenge_runs WHERE challenge_date = ? AND user_id = ? AND is_ranked = 1')
      .get(dateStr, userId);

    const isRanked = alreadyRanked ? 0 : 1;
    db.prepare(
      `INSERT INTO challenge_runs (challenge_date, user_id, username, score, success, remaining_sec, kills, is_ranked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dateStr,
      userId,
      player.username,
      end.score,
      end.success ? 1 : 0,
      end.remainingSec,
      end.kills,
      isRanked
    );

    let rewardMoney = 0;
    if (isRanked === 1 && end.success) {
      rewardMoney = 1500;
      db.prepare('UPDATE users SET money = money + ?, xp = xp + 2 WHERE id = ?').run(
        rewardMoney,
        userId
      );
    }

    return c.json({
      isRanked: isRanked === 1,
      rewardMoney,
      score: end.score,
      player: buildPlayerDto(db, userId),
    });
  });

  // --- Decks & Chipset Routes ---
  app.put('/api/decks/:deckId', zValidator('json', SaveDeckSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const deckId = c.req.param('deckId');
    const body = c.req.valid('json');

    const deck = player.decks.find((d) => d.id === deckId);
    if (!deck) return c.json({ error: 'Deck introuvable.' }, 404);

    // Ensure all viruses in content are owned and within capacity
    const uniqueOwned = Array.from(new Set(body.content)).filter((vid) =>
      player.viruses.includes(vid)
    );
    if (uniqueOwned.length > deck.capacity) {
      return c.json({ error: `Capacité maximale dépassée (${deck.capacity} slots).` }, 400);
    }

    if (body.isFavorite) {
      db.prepare('UPDATE decks SET is_favorite = 0 WHERE user_id = ?').run(userId);
    }

    db.prepare(
      'UPDATE decks SET name = ?, content_json = ?, is_favorite = ? WHERE id = ? AND user_id = ?'
    ).run(
      body.name,
      JSON.stringify(uniqueOwned),
      body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : deck.isFavorite ? 1 : 0,
      deckId,
      userId
    );

    return c.json({ player: buildPlayerDto(db, userId) });
  });

  app.post('/api/decks/chipset', zValidator('json', SetChipsetSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const { chipsetId } = c.req.valid('json');

    const normalized = !chipsetId || chipsetId === 'none' ? null : chipsetId;
    if (normalized && !player.chipsets.includes(normalized)) {
      return c.json({ error: 'Chipset non possédé.' }, 400);
    }

    db.prepare('UPDATE users SET active_chipset = ? WHERE id = ?').run(normalized, userId);
    return c.json({ player: buildPlayerDto(db, userId) });
  });

  // --- Store & Upgrades (Viruses, Chipsets, BIOS, Deck Slots, New Decks) ---
  app.post('/api/store/buy', zValidator('json', BuyItemSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const req = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    if (req.kind === 'virus') {
      const v = bundle.viruses.get(req.id);
      if (!v || v.price <= 0) return c.json({ error: 'Programme indisponible.' }, 400);
      if (player.viruses.includes(v.id)) return c.json({ error: 'Déjà acquis.' }, 400);
      if (player.level < v.level) return c.json({ error: `Niveau ${v.level} requis.` }, 400);
      if (player.money < v.price) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(v.price, userId);
      db.prepare('INSERT INTO user_items (user_id, item_type, item_id) VALUES (?, ?, ?)').run(
        userId,
        'virus',
        v.id
      );
    } else if (req.kind === 'chipset') {
      const chip = bundle.chipsets.get(req.id);
      if (!chip || chip.price <= 0) return c.json({ error: 'Chipset indisponible.' }, 400);
      if (player.chipsets.includes(chip.id)) return c.json({ error: 'Déjà acquis.' }, 400);
      if (player.level < chip.level) return c.json({ error: `Niveau ${chip.level} requis.` }, 400);
      if (player.money < chip.price) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(chip.price, userId);
      db.prepare('INSERT INTO user_items (user_id, item_type, item_id) VALUES (?, ?, ?)').run(
        userId,
        'chipset',
        chip.id
      );
    } else if (req.kind === 'bios') {
      if (player.biosLevel >= 4) return c.json({ error: 'BIOS déjà au niveau maximum.' }, 400);
      const nextBios = player.biosLevel + 1;
      const cost = BIOS_COSTS[nextBios] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ?, bios_level = ? WHERE id = ?').run(
        cost,
        nextBios,
        userId
      );
    } else if (req.kind === 'new_deck') {
      if (player.decks.length >= 4) return c.json({ error: 'Maximum de 4 decks atteint.' }, 400);
      const nextIdx = player.decks.length;
      const cost = ADD_DECK_COST[nextIdx] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(cost, userId);
      db.prepare(
        'INSERT INTO decks (id, user_id, slot_index, name, capacity, is_favorite, content_json) VALUES (?, ?, ?, ?, 3, 0, ?)'
      ).run(`deck_${userId}_${nextIdx}`, userId, nextIdx, `Deck #${nextIdx + 1}`, '[]');
    } else if (req.kind === 'deck_slot') {
      const deck = player.decks.find((d) => d.id === req.deckId);
      if (!deck) return c.json({ error: 'Deck introuvable.' }, 404);
      if (deck.capacity >= 9) return c.json({ error: 'Capacité maximale atteinte (9 slots).' }, 400);
      const cost = ADD_SLOT_COST[deck.capacity] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(cost, userId);
      db.prepare('UPDATE decks SET capacity = capacity + 1 WHERE id = ? AND user_id = ?').run(
        deck.id,
        userId
      );
    }

    return c.json({ player: buildPlayerDto(db, userId) });
  });

  // --- Hard Drive & Black Market Storage Routes ---
  app.get('/api/storage', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const valIds = Array.from(bundle.valuables.keys());
    const multipliers = getDailyMarketMultipliers(dateStr, valIds);

    const saleRow = db
      .prepare('SELECT sold_count FROM market_sales WHERE user_id = ? AND sale_date = ?')
      .get(userId, dateStr) as { sold_count: number } | undefined;
    const soldToday = saleRow?.sold_count ?? 0;

    const files = db
      .prepare('SELECT id, name, content, embed, copied_at as copiedAt FROM stolen_files WHERE user_id = ? ORDER BY rowid DESC')
      .all(userId);

    const cards = db
      .prepare(
        'SELECT id, holder, card_number as number, amount, redeemed, captured_at as capturedAt FROM stolen_cards WHERE user_id = ? ORDER BY rowid DESC'
      )
      .all(userId);

    return c.json({
      date: dateStr,
      dailyQuota: DAILY_PACK_QUOTA,
      soldToday,
      remainingQuota: Math.max(0, DAILY_PACK_QUOTA - soldToday),
      marketMultipliers: multipliers,
      files,
      cards,
    });
  });

  app.post('/api/storage/sell-pack', zValidator('json', SellPackSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const { valuableId, count } = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const valDef = bundle.valuables.get(valuableId);
    if (!valDef) return c.json({ error: 'Pack inconnu.' }, 400);

    const owned = player.valuables[valuableId] ?? 0;
    if (owned <= 0) return c.json({ error: 'Aucun pack en stock.' }, 400);

    const dateStr = todayDateStr();
    const saleRow = db
      .prepare('SELECT sold_count FROM market_sales WHERE user_id = ? AND sale_date = ?')
      .get(userId, dateStr) as { sold_count: number } | undefined;
    const soldToday = saleRow?.sold_count ?? 0;
    const remainingQuota = Math.max(0, DAILY_PACK_QUOTA - soldToday);
    if (remainingQuota <= 0) return c.json({ error: 'Quota quotidien atteint (20/jour).' }, 400);

    const sellQty = Math.min(count, owned, remainingQuota);
    const mult = getDailyMarketMultipliers(dateStr, [valuableId])[valuableId] ?? 1.0;
    const unitPrice = Math.round(valDef.price * mult);
    const totalEarned = sellQty * unitPrice;

    db.prepare('UPDATE user_valuables SET quantity = quantity - ? WHERE user_id = ? AND valuable_id = ?').run(
      sellQty,
      userId,
      valuableId
    );
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(totalEarned, userId);
    db.prepare(`
      INSERT INTO market_sales (user_id, sale_date, sold_count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, sale_date) DO UPDATE SET sold_count = sold_count + excluded.sold_count
    `).run(userId, dateStr, sellQty);

    return c.json({
      soldQty: sellQty,
      totalEarned,
      remainingQuota: remainingQuota - sellQty,
      player: buildPlayerDto(db, userId),
    });
  });

  app.post('/api/storage/redeem-card', zValidator('json', RedeemCardSchema), (c) => {
    const userId = c.get('userId');
    const { cardId } = c.req.valid('json');
    const row = db
      .prepare('SELECT amount, redeemed FROM stolen_cards WHERE user_id = ? AND id = ?')
      .get(userId, cardId) as { amount: number; redeemed: number } | undefined;
    if (!row) return c.json({ error: 'Carte introuvable.' }, 404);
    if (row.redeemed === 1) return c.json({ error: 'Carte déjà encaissée.' }, 400);

    db.prepare('UPDATE stolen_cards SET redeemed = 1 WHERE user_id = ? AND id = ?').run(userId, cardId);
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(row.amount, userId);

    return c.json({
      earned: row.amount,
      player: buildPlayerDto(db, userId),
    });
  });

  app.post('/api/storage/redeem-card-number', zValidator('json', RedeemCardByNumberSchema), (c) => {
    const userId = c.get('userId');
    const { number } = c.req.valid('json');
    const normalizedInput = number.replace(/[\s-]+/g, '').toUpperCase();

    const rows = db
      .prepare('SELECT id, card_number, amount, redeemed FROM stolen_cards WHERE user_id = ?')
      .all(userId) as Array<{ id: string; card_number: string; amount: number; redeemed: number }>;

    const match = rows.find(
      (r) => r.card_number.replace(/[\s-]+/g, '').toUpperCase() === normalizedInput
    );
    if (!match) {
      return c.json({ error: 'Numéro de carte bancaire invalide ou introuvable.' }, 404);
    }
    if (match.redeemed === 1) {
      return c.json({ error: 'Cette carte bancaire a déjà été encaissée.' }, 400);
    }

    db.prepare('UPDATE stolen_cards SET redeemed = 1 WHERE user_id = ? AND id = ?').run(
      userId,
      match.id
    );
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(match.amount, userId);

    return c.json({
      earned: match.amount,
      cardNumber: match.card_number,
      player: buildPlayerDto(db, userId),
    });
  });

  app.delete('/api/storage/files/:fileId', (c) => {
    const userId = c.get('userId');
    const fileId = c.req.param('fileId');
    db.prepare('DELETE FROM stolen_files WHERE user_id = ? AND id = ?').run(userId, fileId);
    return c.json({ ok: true });
  });

  // --- Profile & .hackrc Settings ---
  app.patch('/api/profile', zValidator('json', UpdateProfileSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const patch = c.req.valid('json');

    if (patch.cfg !== undefined) {
      // Validate .hackrc syntax
      for (const rawLine of patch.cfg.split(/\r?\n/)) {
        const clean = rawLine.split('#')[0].trim();
        if (!clean) continue;
        if (!/^alias\s+[a-zA-Z0-9_-]+\s*=\s*.+$/i.test(clean)) {
          return c.json({ error: `Erreur de syntaxe .hackrc : "${rawLine}"` }, 400);
        }
      }
    }

    const updatedSettings = {
      ...player.settings,
      ...patch,
    };
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(
      JSON.stringify(updatedSettings),
      userId
    );
    return c.json({ player: buildPlayerDto(db, userId) });
  });

  // --- Static Assets (/assets/*) ---
  app.get('/assets/*', async (c, next) => {
    const rel = c.req.path.replace(/^\/assets\/?/, '');
    const resolved = path.resolve(opts.assetsDir, rel);
    if (!resolved.startsWith(path.resolve(opts.assetsDir)) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return next();
    }
    const ext = path.extname(resolved).toLowerCase();
    const buf = fs.readFileSync(resolved);
    return c.body(buf, 200, {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  // --- Classic Intrusion Static Web & Engine Assets (assets/www/*) ---
  const classicWwwDir = path.resolve(opts.assetsDir, 'www');
  if (fs.existsSync(classicWwwDir)) {
    app.use('*', async (c, next) => {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
      if (c.req.path === '/' || c.req.path.startsWith('/api/')) return next();
      const rel = c.req.path.replace(/^\/+/, '');
      if (!rel || rel === 'index.html') return next();
      const resolved = path.resolve(classicWwwDir, rel);
      if (
        !resolved.startsWith(classicWwwDir) ||
        !fs.existsSync(resolved) ||
        fs.statSync(resolved).isDirectory()
      ) {
        return next();
      }
      const ext = path.extname(resolved).toLowerCase();
      const buf = fs.readFileSync(resolved);
      return c.body(buf, 200, {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400',
      });
    });
  }

  // --- Production SPA Client Static Serving ---
  if (opts.clientDistDir && fs.existsSync(opts.clientDistDir)) {
    const distRoot = path.resolve(opts.clientDistDir);
    app.get('*', (c) => {
      const reqRel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\//, '');
      const candidate = path.resolve(distRoot, reqRel);
      const targetFile =
        candidate.startsWith(distRoot) && fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()
          ? candidate
          : path.join(distRoot, 'index.html');

      if (!fs.existsSync(targetFile)) return c.notFound();
      const ext = path.extname(targetFile).toLowerCase();
      return c.body(fs.readFileSync(targetFile), 200, {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      });
    });
  }

  return { app, db };
}
