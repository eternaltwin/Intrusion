import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../../assets');

describe('@intrusion/server — Auth, Multi-Decks, Store, Storage & Daily Challenge API', () => {
  it('completes end-to-end hacker lifecycle on in-memory SQLite', async () => {
    const { app } = createApp({
      dbPath: ':memory:',
      assetsDir,
    });

    // 1. Register secure account
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'CipherZero', password: 'secretPassword42' }),
    });
    expect(regRes.status).toBe(201);
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
          ...(startJson.init.mission.cards ?? []),
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

    // 5. Check Hard Drive storage, sell pack, redeem stolen card by id & by card number, and check classic static assets
    const storageRes = await app.request('/api/storage', { headers: { Cookie: cookie } });
    const storageJson = await storageRes.json();
    expect(storageJson.files.length).toBe(1);
    expect(storageJson.cards.length).toBe(
      3 + (startJson.init.mission.cards ? startJson.init.mission.cards.length : 0)
    );
    expect(storageJson.cards.some((c: any) => c.id === 'forged_cc')).toBe(false);

    const sellRes = await app.request('/api/storage/sell-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ valuableId: 'mp3', count: 1 }),
    });
    expect(sellRes.status).toBe(200);

    const cardToRedeemById = storageJson.cards.find(
      (c: any) => c.number !== startJson.init.cards[0]
    );
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

    const chalBoard = await (await app.request('/api/challenges/today', { headers: { Cookie: cookie } })).json();
    expect(chalBoard.challenges.length).toBe(3);
    expect(chalBoard.challenges.map((c: any) => c.level)).toEqual([5, 7, 9]);
    expect(chalBoard.challenges.map((c: any) => c.difficulty)).toEqual(['easy', 'medium', 'hard']);
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
    const beforeRefresh = await (await app.request('/api/missions', { headers: { Cookie: cookie } })).json();
    expect(beforeRefresh.available.length).toBeGreaterThan(0);
    const missionToStart = beforeRefresh.available[0];
    const startActiveRes = await app.request(`/api/missions/${missionToStart.missionKey}/start`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(startActiveRes.status).toBe(200);

    const midCheck = await (await app.request('/api/missions', { headers: { Cookie: cookie } })).json();
    expect(midCheck.active.length).toBe(1);

    const meBeforeRefresh = await (await app.request('/api/auth/me', { headers: { Cookie: cookie } })).json();
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

    const afterRefresh = await (await app.request('/api/missions', { headers: { Cookie: cookie } })).json();
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
    const { app, db } = createApp({
      dbPath: ':memory:',
      assetsDir,
    });

    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ScoutRunner', password: 'secretPassword42' }),
    });
    expect(regRes.status).toBe(201);
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
    db.prepare("INSERT INTO user_items (user_id, item_type, item_id, quantity) VALUES (?, 'chipset', 'scout', 1)").run(
      userId
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
    db.prepare('DELETE FROM missions WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET xp = 2 WHERE id = ?').run(userId); // xp=2 => level 3

    const lvl3List1 = await (await app.request('/api/missions', { headers: { Cookie: cookie } })).json();
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
    const lvl4List = await (await app.request('/api/missions', { headers: { Cookie: cookie } })).json();
    expect(lvl4List.available.length).toBe(9);
    expect(lvl4List.available.every((m: any) => m.level >= 4)).toBe(true);
  });
});
