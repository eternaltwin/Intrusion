import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  openDatabaseFromEnv,
  resolvePgPoolConfig,
  type AppDatabase,
} from '../src/db/database.js';
import { importLegacySqliteDatabase } from '../src/db/localSqliteMigration.js';
import { parseEternaltwinSelfIdentity } from '../src/services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../../assets');

const openDbs: AppDatabase[] = [];
afterEach(async () => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    if (db) await db.close().catch(() => {});
  }
});

describe('@intrusion/server — PostgreSQL, Eternaltwin OAuth, Multi-Decks, Store, Storage & Daily Challenge API', () => {
  it('completes end-to-end hacker lifecycle on PostgreSQL', async () => {
    const { app, db } = await createApp({ assetsDir });
    openDbs.push(db);

    // 1. Authenticate operator via dev-mode Eternaltwin mock (no password stored)
    const regRes = await app.request('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'CipherZero' }),
    });
    expect(regRes.status).toBe(200);
    const cookie = regRes.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toContain('intrusion_sid=');
    const regData = await regRes.json();
    expect(regData.player.username).toBe('CipherZero');
    expect(regData.player.money).toBe(10000);
    expect(regData.player.decks.length).toBe(1);

    // 2. Reject invalid store purchase (insufficient level or funds) & accept valid purchase
    const buyHighRes = await app.request('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'virus', id: 'dmgxl' }), // requires lvl 8
    });
    expect(buyHighRes.status).toBe(400);

    const buyValidRes = await app.request('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'virus', id: 'dmgm' }), // lvl 4, 3000 CR
    });
    expect(buyValidRes.status).toBe(200);
    const afterBuy = await buyValidRes.json();
    expect(afterBuy.player.money).toBe(7000);
    expect(afterBuy.player.viruses).toContain('dmgm');

    // 3. Buy 2nd deck (2500 CR) and expand slot on Deck 1 (2500 CR)
    const buyDeck2 = await app.request('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'new_deck' }),
    });
    expect(buyDeck2.status).toBe(200);
    const afterDeck2 = await buyDeck2.json();
    expect(afterDeck2.player.decks.length).toBe(2);
    expect(afterDeck2.player.money).toBe(4500);

    // 4. List missions, start mission, complete with stolen file + valuable + card
    const missionsRes = await app.request('/api/missions', {
      headers: { Cookie: cookie },
    });
    expect(missionsRes.status).toBe(200);
    const missionsJson = await missionsRes.json();
    expect(missionsJson.tutorials.length).toBe(3);
    expect(missionsJson.available.length).toBe(9);

    const firstMission = missionsJson.available[0];
    const startRes = await app.request(`/api/missions/${firstMission.missionKey}/start`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(startRes.status).toBe(200);
    const startJson = await startRes.json();
    expect(startJson.init.decks.length).toBe(2);
    expect(startJson.init.cards.length).toBe(3);
    expect(startJson.init.ownedViruses.dmgs).toBe(1);
    expect(startJson.init.ownedViruses.dmgm).toBe(1);

    // Stolen cards must NOT be inserted into storage on /start (anti-farming protection)
    const storageBeforeEnd = await (
      await app.request('/api/storage', { headers: { Cookie: cookie } })
    ).json();
    expect(storageBeforeEnd.cards.length).toBe(0);

    const endRes = await app.request(`/api/missions/${firstMission.missionKey}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: firstMission.missionKey,
        seed: firstMission.seed,
        gl: firstMission.level,
        isChallenge: false,
        scoutRun: false,
        success: true,
        kills: 2,
        remainingSec: 140,
        valuables: ['mp3'],
        copiedFiles: [{ name: 'secret.mail', content: '<p>Top secret</p>', embed: null }],
        stolenCards: [
          {
            id: `cc_${firstMission.seed}_1`,
            holder: startJson.init.mission.corp,
            number: startJson.init.cards[1],
            amount: 500,
          },
          { id: 'forged_cc', holder: 'Forged Hacker', number: '4111-2222-3333-4444', amount: 4999 },
        ],
        goals: { av: 3, crash: 1, missions_fulfilled: 999 },
        score: 5200,
      }),
    });
    expect(endRes.status).toBe(200);
    const endJson = await endRes.json();
    expect(endJson.earnedMoney).toBe(firstMission.basePrime);
    expect(endJson.player.goals.missions_fulfilled).toBe(1);
    expect(endJson.player.goals.firsttry).toBe(1);
    expect(endJson.player.valuables.mp3).toBe(1);

    // 5. Check Hard Drive storage (only genuinely intercepted card persisted, no auto-grant leak!),
    // sell pack at exact displayed market multiplier, redeem intercepted card by id & manual card by number
    const storageRes = await app.request('/api/storage', { headers: { Cookie: cookie } });
    const storageJson = await storageRes.json();
    expect(storageJson.files.length).toBe(1);
    expect(storageJson.cards.length).toBe(1);
    expect(storageJson.cards[0].number).toBe(startJson.init.cards[1]);
    expect(storageJson.cards.some((c: any) => c.id === 'forged_cc')).toBe(false);

    const catRes = await (await app.request('/api/catalog?lang=fr')).json();
    const mp3Def = catRes.valuables.find((v: any) => v.id === 'mp3');
    const expectedMp3Price = Math.round(mp3Def.price * storageJson.marketMultipliers.mp3);

    const sellRes = await app.request('/api/storage/sell-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ valuableId: 'mp3', count: 1 }),
    });
    expect(sellRes.status).toBe(200);
    const sellJson = await sellRes.json();
    expect(sellJson.totalEarned).toBe(expectedMp3Price);

    const cardToRedeemById = storageJson.cards[0];
    const redeemRes = await app.request('/api/storage/redeem-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cardId: cardToRedeemById.id }),
    });
    expect(redeemRes.status).toBe(200);
    const redeemJson = await redeemRes.json();
    expect(redeemJson.player.goals.cards_redeemed).toBe(1);

    const redeemByNumberRes = await app.request('/api/storage/redeem-card-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ number: startJson.init.cards[0] }),
    });
    expect(redeemByNumberRes.status).toBe(200);
    const redeemByNumberJson = await redeemByNumberRes.json();
    expect(redeemByNumberJson.player.goals.cards_redeemed).toBe(2);

    const cbIconRes = await app.request('/img/icons/cb.png');
    expect(cbIconRes.status).toBe(200);

    const cssRes = await app.request('/style.css');
    expect(cssRes.status).toBe(200);
    const svgRes = await app.request('/shapes_svg/1.svg');
    expect(svgRes.status).toBe(200);

    // 6. Daily Challenge ranked run + server-side score recomputation + leaderboard check
    const chalStart = await app.request('/api/challenges/today/start', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(chalStart.status).toBe(200);
    const chalStartJson = await chalStart.json();
    expect(chalStartJson.init.decks.length).toBe(1);
    expect(chalStartJson.init.ownedViruses.dmgs).toBe(1);

    const chalEnd = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: 'challenge_today',
        seed: 999,
        gl: 7,
        isChallenge: true,
        scoutRun: false,
        success: true,
        kills: 4,
        remainingSec: 95,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 8450, // client-forged score; server recomputes 1000 + 95*5 + 4*40 = 1635
      }),
    });
    expect(chalEnd.status).toBe(200);
    const chalEndJson = await chalEnd.json();
    expect(chalEndJson.isRanked).toBe(true);
    expect(chalEndJson.score).toBe(1635);

    const chalBoard = await (
      await app.request('/api/challenges/today', { headers: { Cookie: cookie } })
    ).json();
    expect(chalBoard.challenges.length).toBe(3);
    expect(chalBoard.challenges.map((c: any) => c.level)).toEqual([5, 7, 9]);
    expect(chalBoard.challenges.map((c: any) => c.difficulty)).toEqual([
      'easy',
      'medium',
      'hard',
    ]);
    expect(chalBoard.hasPlayedRanked).toBe(true);
    expect(chalBoard.leaderboard.length).toBe(1);
    expect(chalBoard.leaderboard[0].bestScore).toBe(1635);
    // Tier 5 and Tier 9 ranked attempts are still untouched and independent from Tier 7
    expect(chalBoard.challenges[0].hasPlayedRanked).toBe(false);
    expect(chalBoard.challenges[1].hasPlayedRanked).toBe(true);
    expect(chalBoard.challenges[2].hasPlayedRanked).toBe(false);

    const chalStart9 = await app.request('/api/challenges/today/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ level: 9 }),
    });
    expect(chalStart9.status).toBe(200);
    const chalStart9Json = await chalStart9.json();
    expect(chalStart9Json.init.gl).toBe(9);
    expect(chalStart9Json.init.decks.length).toBe(1);

    // 7. Refreshing missions flushes active missions and sets midnight expiry
    const beforeRefresh = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(beforeRefresh.available.length).toBeGreaterThan(0);
    const missionToStart = beforeRefresh.available[0];
    const startActiveRes = await app.request(`/api/missions/${missionToStart.missionKey}/start`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(startActiveRes.status).toBe(200);

    const midCheck = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(midCheck.active.length).toBe(1);

    const meBeforeRefresh = await (
      await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    ).json();
    const moneyBeforeRefresh = meBeforeRefresh.player.money;

    const refreshRes = await app.request('/api/missions/refresh', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(refreshRes.status).toBe(200);
    const refreshJson = await refreshRes.json();
    expect(refreshJson.available.length).toBeGreaterThan(0);
    expect(refreshJson.player.money).toBe(moneyBeforeRefresh - 2000);

    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 0);
    expect(refreshJson.available[0].expiresAt).toBe(nextMidnight.getTime());

    const afterRefresh = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(afterRefresh.active.length).toBe(0);
    expect(afterRefresh.completed.length).toBe(0);

    // 8. Multi-copy virus purchase & shared virus pool across decks
    const buySecondDmgs = await app.request('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'virus', id: 'dmgs' }), // 700 CR
    });
    expect(buySecondDmgs.status).toBe(200);
    const secondDmgsJson = await buySecondDmgs.json();
    expect(secondDmgsJson.player.viruses.filter((v: string) => v === 'dmgs').length).toBe(2);

    const [d1, d2] = secondDmgsJson.player.decks;
    const putTwoInD1 = await app.request(`/api/decks/${d1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ deckId: d1.id, name: d1.name, content: ['dmgs', 'dmgs'] }),
    });
    expect(putTwoInD1.status).toBe(200);

    const putThirdInD2 = await app.request(`/api/decks/${d2.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ deckId: d2.id, name: d2.name, content: ['dmgs'] }),
    });
    expect(putThirdInD2.status).toBe(400);

    // 9. Reject hidden/special viruses in store & decks, and normalize .hackrc aliases/NBSP
    for (const hiddenId of ['connec', 'cd', 'exit', 'target', 'extrac', 'debug']) {
      const buyHidden = await app.request('/api/store/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'virus', id: hiddenId }),
      });
      expect(buyHidden.status).toBe(400);

      const deckHidden = await app.request(`/api/decks/${d1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: d1.id, name: d1.name, content: [hiddenId] }),
      });
      expect(deckHidden.status).toBe(400);
    }

    const cfgPatchRes = await app.request('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cfg: 'alias\u00A0D\u00A0=\u00A0dmgs # quick attack' }),
    });
    expect(cfgPatchRes.status).toBe(200);
    const cfgPatchJson = await cfgPatchRes.json();
    expect(cfgPatchJson.player.settings.cfg).toBe('alias d = dmgs # quick attack');
  });

  it('prevents tutorial replay exploits, preserves Scout challenge ranked attempts, and transitions level 3 -> 4 to 9 missions', async () => {
    const { app, db } = await createApp({ assetsDir });
    openDbs.push(db);

    const regRes = await app.request('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ScoutRunner' }),
    });
    expect(regRes.status).toBe(200);
    const cookie = regRes.headers.get('set-cookie')?.split(';')[0] ?? '';
    const regJson = await regRes.json();
    const userId = regJson.player.id as number;

    // 1. Invalid tuto_* rejected, valid tuto_3 replay grants 0 money, 0 XP, 0 loot
    const invalidTutoStart = await app.request('/api/missions/tuto_99/start', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(invalidTutoStart.status).toBe(400);

    const invalidTutoEnd = await app.request('/api/missions/tuto_99/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: 'tuto_99',
        seed: 999999,
        gl: 9,
        isChallenge: false,
        scoutRun: false,
        success: true,
        kills: 10,
        remainingSec: 100,
        valuables: ['mp3'],
        copiedFiles: [{ name: 'loot.doc', content: 'x', embed: null }],
        stolenCards: [],
        goals: { av: 5 },
        score: 9000,
      }),
    });
    expect(invalidTutoEnd.status).toBe(400);

    const tutoEnd = await app.request('/api/missions/tuto_3/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: 'tuto_3',
        seed: 999999, // forged seed/gl ignored
        gl: 9,
        isChallenge: false,
        scoutRun: false,
        success: true,
        kills: 5,
        remainingSec: 200,
        valuables: ['mp3'],
        copiedFiles: [{ name: 'loot.doc', content: 'x', embed: null }],
        stolenCards: [],
        goals: { av: 5 },
        score: 5000,
      }),
    });
    expect(tutoEnd.status).toBe(200);
    const tutoEndJson = await tutoEnd.json();
    expect(tutoEndJson.earnedMoney).toBe(0);
    expect(tutoEndJson.earnedXp).toBe(0);
    expect(tutoEndJson.player.money).toBe(10000);
    expect(tutoEndJson.player.xp).toBe(3);
    expect(tutoEndJson.player.valuables.mp3).toBeUndefined();

    // 2. Grant Scout chipset and verify Scout challenge run does NOT consume daily ranked attempt
    await db.query(
      "INSERT INTO user_items (user_id, item_type, item_id, quantity) VALUES ($1, 'chipset', 'scout', 1)",
      [userId]
    );
    const equipScout = await app.request('/api/decks/chipset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'scout' }),
    });
    expect(equipScout.status).toBe(200);

    const scoutChalEnd = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: 'challenge_today',
        seed: 777,
        gl: 7,
        isChallenge: true,
        scoutRun: true,
        success: true,
        kills: 2,
        remainingSec: 120,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 5000,
      }),
    });
    expect(scoutChalEnd.status).toBe(200);
    const scoutChalJson = await scoutChalEnd.json();
    expect(scoutChalJson.isRanked).toBe(false);
    expect(scoutChalJson.rewardMoney).toBe(0);
    expect(scoutChalJson.scoutRun).toBe(true);

    const chalAfterScout = await (
      await app.request('/api/challenges/today', { headers: { Cookie: cookie } })
    ).json();
    expect(chalAfterScout.hasPlayedRanked).toBe(false);

    // Unequip Scout and complete real ranked attempt
    await app.request('/api/decks/chipset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: null }),
    });
    const realChalEnd = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: 'challenge_today',
        seed: 777,
        gl: 7,
        isChallenge: true,
        scoutRun: false,
        success: true,
        kills: 3,
        remainingSec: 100,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 1620,
      }),
    });
    expect(realChalEnd.status).toBe(200);
    const realChalJson = await realChalEnd.json();
    expect(realChalJson.isRanked).toBe(true);
    expect(realChalJson.rewardMoney).toBe(1500);

    // 3. Level < 4 active mission does not duplicate on GET /api/missions, and Level 3 -> 4 generates 9 missions
    await db.query('DELETE FROM missions WHERE user_id = $1', [userId]);
    await db.query('UPDATE users SET xp = 2 WHERE id = $1', [userId]); // xp=2 => level 3

    const lvl3List1 = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(lvl3List1.available.length).toBe(1);
    expect(lvl3List1.available[0].level).toBe(3);

    const lvl3Key = lvl3List1.available[0].missionKey as string;
    const startLvl3 = await app.request(`/api/missions/${lvl3Key}/start`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(startLvl3.status).toBe(200);

    // Fetching /api/missions while level 3 mission is active must NOT spawn a duplicate mission
    const lvl3ListWhileActive = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(lvl3ListWhileActive.available.length).toBe(0);
    expect(lvl3ListWhileActive.active.length).toBe(1);

    // Completing level 3 mission levels up 3 -> 4 (xp: 2 -> 3)
    const endLvl3 = await app.request(`/api/missions/${lvl3Key}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: lvl3Key,
        seed: lvl3List1.available[0].seed,
        gl: 3,
        isChallenge: false,
        scoutRun: false,
        success: true,
        kills: 1,
        remainingSec: 300,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 1000,
      }),
    });
    expect(endLvl3.status).toBe(200);
    const endLvl3Json = await endLvl3.json();
    expect(endLvl3Json.player.level).toBe(4);

    // Next GET /api/missions transitions to full 9-mission level >= 4 pool
    const lvl4List = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    expect(lvl4List.available.length).toBe(9);
    expect(lvl4List.available.every((m: any) => m.level >= 4)).toBe(true);

    // 4. Scout mid-run chipset swap exploit is blocked (locked at /start), and cards from failed/Scout runs redeem by number
    const exploitTarget = lvl4List.available[0];
    await app.request('/api/decks/chipset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: null }),
    });
    const nonScoutStart = await (
      await app.request(`/api/missions/${exploitTarget.missionKey}/start`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).json();
    expect(nonScoutStart.init.chipset).toBeNull();

    // Swap to scout mid-run in another tab and attempt to dodge tries + 1 on failure
    await app.request('/api/decks/chipset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'scout' }),
    });
    const swapEndRes = await app.request(`/api/missions/${exploitTarget.missionKey}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        missionKey: exploitTarget.missionKey,
        seed: exploitTarget.seed,
        gl: exploitTarget.level,
        isChallenge: false,
        scoutRun: true,
        success: false,
        kills: 0,
        remainingSec: 0,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 0,
      }),
    });
    expect(swapEndRes.status).toBe(200);
    const swapEndJson = await swapEndRes.json();
    expect(Boolean(swapEndJson.scoutRun)).toBe(false);

    const afterSwapList = await (
      await app.request('/api/missions', { headers: { Cookie: cookie } })
    ).json();
    const activeAfterSwap = afterSwapList.active.find(
      (m: any) => m.missionKey === exploitTarget.missionKey
    );
    expect(activeAfterSwap.tries).toBe(1);

    // Card number noted during that failed run can still be redeemed manually!
    const failedRunCardRes = await app.request('/api/storage/redeem-card-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ number: nonScoutStart.init.cards[0] }),
    });
    expect(failedRunCardRes.status).toBe(200);

    // 5. Level 9 player can roll Level 10 ("hard") missions
    await db.query('UPDATE users SET xp = 300, money = 500000 WHERE id = $1', [userId]);
    let sawLevel10 = false;
    for (let i = 0; i < 6 && !sawLevel10; i++) {
      const refRes = await (
        await app.request('/api/missions/refresh', {
          method: 'POST',
          headers: { Cookie: cookie },
        })
      ).json();
      if (refRes.available.some((m: any) => m.level === 10)) {
        sawLevel10 = true;
      }
    }
    expect(sawLevel10).toBe(true);
  });

  it('tracks first-try challenge completions per tier and awards end-of-day Top 3 podium goals', async () => {
    const { app, db } = await createApp({ assetsDir });
    openDbs.push(db);

    const registerAndCookie = async (username: string) => {
      const res = await app.request('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      const setCookie = res.headers.get('set-cookie')!;
      return { cookie: setCookie.split(';')[0], userId: json.player.id as number };
    };

    const p1 = await registerAndCookie('PodiumOne');
    const p2 = await registerAndCookie('PodiumTwo');
    const p3 = await registerAndCookie('PodiumThree');
    const p4 = await registerAndCookie('PodiumFour');

    // Verify all 6 challenge stat icons are served
    for (const icon of [
      'ismiley_happy',
      'ismiley_yeah',
      'ismiley_cool',
      'lead2',
      'lead31',
      'lead3',
    ]) {
      const iconRes = await app.request(`/img/icons/${icon}.png`);
      expect(iconRes.status).toBe(200);
    }

    // P1 wins Easy (5) on 1st try -> challenge_pass_5 = 1, challenge_top3_5 still undefined (today not ended)
    const winEasy1 = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: p1.cookie },
      body: JSON.stringify({
        missionKey: 'challenge_2026-11-23_5',
        seed: 555,
        gl: 5,
        isChallenge: true,
        scoutRun: false,
        success: true,
        kills: 5,
        remainingSec: 120,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 1800,
      }),
    });
    const winEasy1Json = await winEasy1.json();
    expect(winEasy1Json.isRanked).toBe(true);
    expect(winEasy1Json.player.goals.challenge_pass_5).toBe(1);
    expect(winEasy1Json.player.goals.challenge_top3_5).toBeUndefined();

    // P1 replays Easy (5) -> unranked, challenge_pass_5 stays 1
    const replayEasy = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: p1.cookie },
      body: JSON.stringify({
        missionKey: 'challenge_2026-11-23_5',
        seed: 555,
        gl: 5,
        isChallenge: true,
        scoutRun: false,
        success: true,
        kills: 8,
        remainingSec: 200,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 2320,
      }),
    });
    const replayEasyJson = await replayEasy.json();
    expect(replayEasyJson.isRanked).toBe(false);
    expect(replayEasyJson.player.goals.challenge_pass_5).toBe(1);

    // P1 fails Hard (9) on 1st try, then succeeds on 2nd try -> challenge_pass_9 must NOT be awarded
    await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: p1.cookie },
      body: JSON.stringify({
        missionKey: 'challenge_2026-11-23_9',
        seed: 999,
        gl: 9,
        isChallenge: true,
        scoutRun: false,
        success: false,
        kills: 1,
        remainingSec: 0,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 15,
      }),
    });
    const retryHard = await app.request('/api/challenges/today/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: p1.cookie },
      body: JSON.stringify({
        missionKey: 'challenge_2026-11-23_9',
        seed: 999,
        gl: 9,
        isChallenge: true,
        scoutRun: false,
        success: true,
        kills: 5,
        remainingSec: 100,
        valuables: [],
        copiedFiles: [],
        stolenCards: [],
        goals: {},
        score: 1700,
      }),
    });
    const retryHardJson = await retryHard.json();
    expect(retryHardJson.player.goals.challenge_pass_9).toBeUndefined();

    // Seed completed past-day ('2000-01-01') ranked runs across tiers 5, 7, 9 for 4 players
    const insertPastRun = async (
      lvl: number,
      uid: number,
      uname: string,
      score: number,
      remSec: number
    ) => {
      await db.query(
        `INSERT INTO challenge_runs (challenge_date, challenge_level, user_id, username, score, success, remaining_sec, kills, is_ranked)
         VALUES ('2000-01-01', $1, $2, $3, $4, 1, $5, 3, 1)`,
        [lvl, uid, uname, score, remSec]
      );
    };
    await insertPastRun(5, p1.userId, 'PodiumOne', 2000, 120);
    await insertPastRun(5, p2.userId, 'PodiumTwo', 1800, 100);
    await insertPastRun(5, p3.userId, 'PodiumThree', 1600, 80);
    await insertPastRun(5, p4.userId, 'PodiumFour', 1400, 60);
    await insertPastRun(7, p3.userId, 'PodiumThree', 2100, 150);
    await insertPastRun(9, p2.userId, 'PodiumTwo', 2500, 180);

    const me1 = await (
      await app.request('/api/auth/me', { headers: { Cookie: p1.cookie } })
    ).json();
    const me2 = await (
      await app.request('/api/auth/me', { headers: { Cookie: p2.cookie } })
    ).json();
    const me3 = await (
      await app.request('/api/auth/me', { headers: { Cookie: p3.cookie } })
    ).json();
    const me4 = await (
      await app.request('/api/auth/me', { headers: { Cookie: p4.cookie } })
    ).json();

    expect(me1.player.goals.challenge_pass_5).toBe(2);
    expect(me1.player.goals.challenge_top3_5).toBe(1);

    expect(me2.player.goals.challenge_top3_5).toBe(1);
    expect(me2.player.goals.challenge_pass_9).toBe(1);
    expect(me2.player.goals.challenge_top3_9).toBe(1);

    expect(me3.player.goals.challenge_top3_5).toBe(1);
    expect(me3.player.goals.challenge_pass_7).toBe(1);
    expect(me3.player.goals.challenge_top3_7).toBe(1);

    expect(me4.player.goals.challenge_pass_5).toBe(1);
    expect(me4.player.goals.challenge_top3_5).toBeUndefined();
  });

  it('enforces per-tier Challenge loadouts (virus/chipset level caps, no deck-switch, max deck capacity)', async () => {
    const { app, db } = await createApp({ assetsDir });
    openDbs.push(db);

    const regRes = await app.request('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'LoadoutMaster' }),
    });
    expect(regRes.status).toBe(200);
    const cookie = regRes.headers.get('set-cookie')!.split(';')[0];
    const regJson = await regRes.json();
    const userId = regJson.player.id as number;
    const mainDeckId = regJson.player.decks[0].id as string;

    // Grant high XP + credits and buy viruses/chipsets across levels 5..9 (including dckswi & dcksw2)
    await db.query('UPDATE users SET xp = 500, money = 500000 WHERE id = $1', [userId]);
    for (const vid of ['dmgm', 'dmgl', 'dmgxl', 'dckswi', 'dcksw2', 'reboo2']) {
      const r = await app.request('/api/store/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'virus', id: vid }),
      });
      expect(r.status).toBe(200);
    }
    for (const cid of ['regen', 'smana', 'brute']) {
      const r = await app.request('/api/store/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'chipset', id: cid }),
      });
      expect(r.status).toBe(200);
    }

    // 1. Capacity initially matches largest normal deck (3 slots) -> 4 viruses rejected
    const tooManyRes = await app.request('/api/challenges/loadout/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: null, content: ['dmgs', 'dmgm', 'copy', 'scan1'] }),
    });
    expect(tooManyRes.status).toBe(400);

    // Expand normal deck to 4 slots -> 4 viruses now allowed in Challenge deck
    const expandRes = await app.request('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'deck_slot', deckId: mainDeckId }),
    });
    expect(expandRes.status).toBe(200);

    // 2. Deck-switch viruses (dckswi lvl 5, dcksw2 lvl 8) are strictly rejected even at matching/higher tier
    for (const [lvl, vid] of [
      [5, 'dckswi'],
      [7, 'dckswi'],
      [9, 'dcksw2'],
    ] as const) {
      const badSwitch = await app.request(`/api/challenges/loadout/${lvl}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ chipsetId: null, content: ['dmgs', vid] }),
      });
      expect(badSwitch.status).toBe(400);
    }

    // 3. Virus level cap: dmgl (lvl 6) rejected on Challenge 5, accepted on Challenge 7; reboo2 (lvl 9) rejected on 7, accepted on 9
    const dmglOn5 = await app.request('/api/challenges/loadout/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'regen', content: ['dmgs', 'dmgl'] }),
    });
    expect(dmglOn5.status).toBe(400);

    // 4. Chipset level cap: smana (lvl 6) rejected on Challenge 5, accepted on Challenge 7
    const smanaOn5 = await app.request('/api/challenges/loadout/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'smana', content: ['dmgs', 'dmgm'] }),
    });
    expect(smanaOn5.status).toBe(400);

    // 5. Save valid distinct loadouts for tiers 5, 7, and 9 (with 4 slots on tier 5)
    const save5 = await app.request('/api/challenges/loadout/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'regen', content: ['dmgs', 'dmgm', 'copy', 'scan1'] }),
    });
    expect(save5.status).toBe(200);

    const reboo2On7 = await app.request('/api/challenges/loadout/7', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'brute', content: ['dmgl', 'reboo2'] }),
    });
    expect(reboo2On7.status).toBe(400);

    const save7 = await app.request('/api/challenges/loadout/7', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'brute', content: ['dmgl', 'copy'] }),
    });
    expect(save7.status).toBe(200);

    const save9 = await app.request('/api/challenges/loadout/9', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ chipsetId: 'smana', content: ['dmgxl', 'reboo2', 'scan1'] }),
    });
    expect(save9.status).toBe(200);
    const save9Json = await save9.json();

    expect(save9Json.player.activeChipset).toBeNull();
    expect(save9Json.player.decks[0].content).toEqual(['dmgs', 'copy', 'scan1']);
    expect(save9Json.player.challengeLoadouts['5']).toEqual({
      chipsetId: 'regen',
      content: ['dmgs', 'dmgm', 'copy', 'scan1'],
    });
    expect(save9Json.player.challengeLoadouts['7']).toEqual({
      chipsetId: 'brute',
      content: ['dmgl', 'copy'],
    });
    expect(save9Json.player.challengeLoadouts['9']).toEqual({
      chipsetId: 'smana',
      content: ['dmgxl', 'reboo2', 'scan1'],
    });

    const start5 = await (
      await app.request('/api/challenges/today/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ level: 5 }),
      })
    ).json();
    expect(start5.init.chipset).toBe('regen');
    expect(start5.init.decks[0].content).toEqual(['dmgs', 'dmgm', 'copy', 'scan1']);

    const start9 = await (
      await app.request('/api/challenges/today/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ level: 9 }),
      })
    ).json();
    expect(start9.init.chipset).toBe('smana');
    expect(start9.init.decks[0].content).toEqual(['dmgxl', 'reboo2', 'scan1']);
  });

  it('enforces Eternaltwin Charter & Katal production compliance: PostgreSQL config, ETERNALTWIN OAuth 2.0 flow, state CSRF check, SHA-256 session hashing, zero stored secrets, prod lockdown & HTTP security headers', async () => {
    // 0. Verify PostgreSQL connection config parser (Katal DATABASE_URL with ?version=17&charset=utf8 + Katal DATABASE_* vars + prod pglite block)
    const urlCfg = resolvePgPoolConfig({
      DATABASE_URL:
        'postgresql://intrusion.staging.main:s3cr3t@localhost:5432/intrusion.staging?version=17&charset=utf8',
      DB_POOL_MAX: '15',
    });
    expect(urlCfg.connectionString).toBe(
      'postgresql://intrusion.staging.main:s3cr3t@localhost:5432/intrusion.staging?client_encoding=utf8'
    );
    expect(urlCfg.max).toBe(15);

    const katalSplitCfg = resolvePgPoolConfig({
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'intrusion.staging',
      DATABASE_USERNAME: 'intrusion.staging.main',
      DATABASE_PASSWORD: 'pg_secret_password',
    });
    expect(katalSplitCfg.host).toBe('localhost');
    expect(katalSplitCfg.port).toBe(5432);
    expect(katalSplitCfg.database).toBe('intrusion.staging');
    expect(katalSplitCfg.user).toBe('intrusion.staging.main');
    expect(katalSplitCfg.password).toBe('pg_secret_password');

    await expect(
      openDatabaseFromEnv({ DATABASE_URL: 'pglite://memory' }, true, process.cwd())
    ).rejects.toThrow(/interdit en production/);

    let mockDisplayName = 'DorianET';
    const secretOauthAccessToken = 'eternaltwin_live_secret_access_token_xyz987';

    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === 'https://eternaltwin.org/oauth/token') {
        expect(init?.method).toBe('POST');
        const authHeader = (init?.headers as Record<string, string>)?.Authorization ?? '';
        const expectedBasic = Buffer.from(
          'intrusion@clients:super_client_secret',
          'utf8'
        ).toString('base64');
        expect(authHeader).toBe(`Basic ${expectedBasic}`);
        const bodyParams = new URLSearchParams(String(init?.body ?? ''));
        if (bodyParams.get('code') !== 'valid_eternaltwin_auth_code') {
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            access_token: secretOauthAccessToken,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://eternaltwin.org/api/v1/auth/self') {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization ?? '';
        expect(authHeader).toBe(`Bearer ${secretOauthAccessToken}`);
        return new Response(
          JSON.stringify({
            type: 'AccessToken',
            scope: 'Default',
            client: {
              type: 'OauthClient',
              id: '00000000-0000-0000-0000-000000000001',
              key: 'intrusion@clients',
              display_name: 'Intrusion',
            },
            user: {
              type: 'User',
              id: '9f310484-663b-44c3-aa64-7c0d2362a684',
              display_name: {
                current: { value: mockDisplayName },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    const testPgDb = await openDatabaseFromEnv(
      { DATABASE_URL: 'pglite://memory' },
      false,
      process.cwd()
    );
    openDbs.push(testPgDb);

    const { app, db } = await createApp({
      db: testPgDb,
      assetsDir,
      isProduction: true,
      publicUrl: 'https://intrusion.eternaltwin.org',
      sourceRepoUrl: 'https://github.com/eternaltwin/intrusion',
      eternaltwinOauth: {
        internalUrl: 'https://eternaltwin.org',
        externalUrl: 'https://eternaltwin.org',
        clientId: 'intrusion@clients',
        clientSecret: 'super_client_secret',
        callbackUrl: 'https://intrusion.eternaltwin.org/api/auth/eternaltwin/callback',
        scope: 'base',
      },
      allowDevAuth: true, // Even if passed true, isProduction: true MUST strictly disable dev-login!
      fetchImpl: mockFetch,
    });

    // 1. Production strictly disables dev-login & legacy password endpoints do not exist
    const devLoginProd = await app.request(
      'https://intrusion.eternaltwin.org/api/auth/dev-login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://intrusion.eternaltwin.org',
        },
        body: JSON.stringify({ username: 'BypassAttempt' }),
      }
    );
    expect(devLoginProd.status).toBe(403);

    const legacyLogin = await app.request('https://intrusion.eternaltwin.org/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://intrusion.eternaltwin.org',
      },
      body: JSON.stringify({ username: 'a', password: 'b' }),
    });
    expect(legacyLogin.status).toBe(404);

    // 2. Security headers & HSTS are present in production
    expect(devLoginProd.headers.get('x-content-type-options')).toBe('nosniff');
    expect(devLoginProd.headers.get('x-frame-options')).toBe('DENY');
    expect(devLoginProd.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'"
    );
    expect(devLoginProd.headers.get('strict-transport-security')).toContain(
      'max-age=31536000'
    );

    // 3. Cross-origin CSRF POST is blocked with 403
    const csrfBlocked = await app.request('https://intrusion.eternaltwin.org/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil-attacker.example' },
    });
    expect(csrfBlocked.status).toBe(403);

    // 4. OAuth login initiates redirect to Eternaltwin with cryptographic state cookie
    const loginInitRes = await app.request(
      'https://intrusion.eternaltwin.org/api/auth/eternaltwin/login'
    );
    expect(loginInitRes.status).toBe(302);
    const redirectLoc = new URL(loginInitRes.headers.get('location')!);
    expect(redirectLoc.origin + redirectLoc.pathname).toBe(
      'https://eternaltwin.org/oauth/authorize'
    );
    expect(redirectLoc.searchParams.get('client_id')).toBe('intrusion@clients');
    expect(redirectLoc.searchParams.get('redirect_uri')).toBe(
      'https://intrusion.eternaltwin.org/api/auth/eternaltwin/callback'
    );
    const stateParam = redirectLoc.searchParams.get('state')!;
    expect(stateParam.length).toBe(64);
    const stateSetCookie = loginInitRes.headers.get('set-cookie')!;
    expect(stateSetCookie).toContain('HttpOnly');
    expect(stateSetCookie).toContain('Secure');
    const stateCookiePair = stateSetCookie.split(';')[0];

    // 5. Forged / mismatched OAuth state is rejected
    const badStateRes = await app.request(
      'https://intrusion.eternaltwin.org/api/auth/eternaltwin/callback?code=valid_eternaltwin_auth_code&state=forged_state',
      { headers: { Cookie: stateCookiePair } }
    );
    expect(badStateRes.status).toBe(302);
    expect(badStateRes.headers.get('location')).toBe('/?auth_error=invalid_state');

    // 6. Complete valid OAuth flow -> exchanges code, fetches /api/v1/auth/self, creates session
    const loginInit2 = await app.request(
      'https://intrusion.eternaltwin.org/api/auth/eternaltwin/login'
    );
    const state2 = new URL(loginInit2.headers.get('location')!).searchParams.get('state')!;
    const stateCookie2 = loginInit2.headers.get('set-cookie')!.split(';')[0];

    const callbackRes = await app.request(
      `https://intrusion.eternaltwin.org/api/auth/eternaltwin/callback?code=valid_eternaltwin_auth_code&state=${state2}`,
      { headers: { Cookie: stateCookie2 } }
    );
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('/');

    const setCookiesHeader = callbackRes.headers.get('set-cookie') ?? '';
    expect(setCookiesHeader).toContain('intrusion_sid=');
    expect(setCookiesHeader).toContain('HttpOnly');
    expect(setCookiesHeader).toContain('Secure');
    const sidMatch = /intrusion_sid=([a-f0-9]+)/.exec(setCookiesHeader);
    expect(sidMatch).not.toBeNull();
    const rawSid = sidMatch![1];

    // 7. Verify authenticated identity & auth config
    const meRes = await app.request('https://intrusion.eternaltwin.org/api/auth/me', {
      headers: { Cookie: `intrusion_sid=${rawSid}` },
    });
    const meJson = await meRes.json();
    expect(meJson.player.username).toBe('DorianET');
    expect(meJson.auth.etwinEnabled).toBe(true);
    expect(meJson.auth.etwinAuthorizePath).toBe('/api/auth/eternaltwin/login');
    expect(meJson.auth.devAuthEnabled).toBe(false);
    expect(meJson.auth.sourceRepoUrl).toBe('https://github.com/eternaltwin/intrusion');

    // 8. Verify PostgreSQL schema & storage compliance:
    // - No password_hash column in users
    // - Uses eternaltwin_user_id column
    // - Raw session token is NOT stored in plaintext in sessions (only SHA-256 token_hash)
    // - OAuth access_token is NOT stored anywhere in PostgreSQL
    const userColsRes = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'`
    );
    const colNames = userColsRes.rows.map((c) => c.column_name);
    expect(colNames.includes('password_hash')).toBe(false);
    expect(colNames.includes('eternaltwin_user_id')).toBe(true);

    const sessionRes = await db.query<{ token_hash: string }>(
      'SELECT token_hash FROM sessions'
    );
    expect(sessionRes.rows.length).toBe(1);
    expect(sessionRes.rows[0].token_hash).not.toBe(rawSid);
    expect(sessionRes.rows[0].token_hash.length).toBe(64);

    const allUsersRes = await db.query('SELECT * FROM users');
    const serializedUsers = JSON.stringify(allUsersRes.rows);
    const serializedSessions = JSON.stringify(sessionRes.rows);
    expect(serializedUsers).not.toContain(secretOauthAccessToken);
    expect(serializedSessions).not.toContain(secretOauthAccessToken);

    // 9. Subsequent OAuth login syncs updated Eternaltwin display_name seamlessly
    mockDisplayName = 'DorianRenamed';
    const loginInit3 = await app.request(
      'https://intrusion.eternaltwin.org/api/auth/eternaltwin/login'
    );
    const state3 = new URL(loginInit3.headers.get('location')!).searchParams.get('state')!;
    const stateCookie3 = loginInit3.headers.get('set-cookie')!.split(';')[0];
    const callbackRes2 = await app.request(
      `https://intrusion.eternaltwin.org/api/auth/eternaltwin/callback?code=valid_eternaltwin_auth_code&state=${state3}`,
      { headers: { Cookie: stateCookie3 } }
    );
    const sid2 = /intrusion_sid=([a-f0-9]+)/.exec(
      callbackRes2.headers.get('set-cookie') ?? ''
    )![1];
    const meRenamed = await (
      await app.request('https://intrusion.eternaltwin.org/api/auth/me', {
        headers: { Cookie: `intrusion_sid=${sid2}` },
      })
    ).json();
    expect(meRenamed.player.id).toBe(meJson.player.id);
    expect(meRenamed.player.username).toBe('DorianRenamed');

    // 10. Verify parseEternaltwinSelfIdentity accepts both User & AccessToken contexts and rejects Guest/OauthClient
    expect(
      parseEternaltwinSelfIdentity({
        type: 'User',
        scope: 'Default',
        user: { type: 'User', id: 'u-1', display_name: { current: { value: 'CookieUser' } } },
      })
    ).toEqual({ eternaltwinUserId: 'u-1', displayName: 'CookieUser' });
    expect(() => parseEternaltwinSelfIdentity({ type: 'Guest', scope: 'Default' })).toThrow();
    expect(() =>
      parseEternaltwinSelfIdentity({
        type: 'OauthClient',
        scope: 'Default',
        client: { type: 'OauthClient', id: 'c-1', display_name: 'Intrusion' },
      })
    ).toThrow();
  });

  it('migrates legacy local SQLite progress, decks, cards, and active session into PostgreSQL seamlessly', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intrusion-sqlite-mig-'));
    const sqliteFile = path.join(tmpDir, 'intrusion.sqlite');
    const sqliteMod = (await import('node:sqlite')) as any;
    const sq = new sqliteMod.DatabaseSync(sqliteFile);
    sq.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        etwin_user_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        money INTEGER NOT NULL,
        xp INTEGER NOT NULL,
        bios_level INTEGER NOT NULL,
        active_chipset TEXT,
        settings_json TEXT NOT NULL
      );
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE user_items (user_id INTEGER NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, quantity INTEGER NOT NULL);
      CREATE TABLE decks (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, slot_index INTEGER NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, is_favorite INTEGER NOT NULL, content_json TEXT NOT NULL);
      CREATE TABLE stolen_cards (id TEXT NOT NULL, user_id INTEGER NOT NULL, holder TEXT NOT NULL, card_number TEXT NOT NULL, amount INTEGER NOT NULL, redeemed INTEGER NOT NULL, captured_at TEXT NOT NULL);
    `);
    sq.prepare(
      "INSERT INTO users (id, etwin_user_id, username, money, xp, bios_level, active_chipset, settings_json) VALUES (1, 'dev:legacyop', 'LegacyOp', 42000, 49, 3, 'turbo', '{}')"
    ).run();
    // Hash for raw token 'legacy_raw_session_token'
    const { hashSessionToken } = await import('../src/services/auth.js');
    const rawTok = 'legacy_raw_session_token_12345';
    sq.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, ?)').run(
      hashSessionToken(rawTok),
      Date.now() + 86_400_000
    );
    sq.prepare("INSERT INTO user_items VALUES (1, 'virus', 'dmgs', 2)").run();
    sq.prepare("INSERT INTO user_items VALUES (1, 'chipset', 'turbo', 1)").run();
    sq.prepare("INSERT INTO decks VALUES ('deck_1_0', 1, 0, 'Main', 5, 1, '[\"dmgs\",\"dmgs\"]')").run();
    sq.prepare("INSERT INTO stolen_cards VALUES ('cc_1', 1, 'Corp', '4000-1111-2222-3333', 900, 0, '2026-11-26 20:00:00')").run();
    sq.close();

    try {
      const { app, db } = await createApp({ assetsDir });
      openDbs.push(db);

      // Simulate user having logged in once on empty PG before migration (creating default xp=3 row)
      await app.request('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'LegacyOp' }),
      });

      const stats = await importLegacySqliteDatabase(db, sqliteFile);
      expect(stats.importedUsers).toBe(1);
      expect(stats.importedSessions).toBe(1);
      expect(stats.importedCards).toBe(1);

      const meRes = await app.request('/api/auth/me', {
        headers: { Cookie: `intrusion_sid=${rawTok}` },
      });
      expect(meRes.status).toBe(200);
      const meJson = await meRes.json();
      expect(meJson.player.username).toBe('LegacyOp');
      expect(meJson.player.money).toBe(42000);
      expect(meJson.player.xp).toBe(49);
      expect(meJson.player.biosLevel).toBe(3);
      expect(meJson.player.activeChipset).toBe('turbo');
      expect(meJson.player.decks[0].capacity).toBe(5);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
