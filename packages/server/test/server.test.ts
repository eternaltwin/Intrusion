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
        stolenCards: [{ id: 'cc_1', holder: 'John Doe', number: '4111-2222-3333-4444', amount: 450 }],
        goals: { av: 3, crash: 1 },
        score: 5200,
      }),
    });
    expect(endRes.status).toBe(200);
    const endJson = await endRes.json();
    expect(endJson.earnedMoney).toBe(firstMission.basePrime);
    expect(endJson.player.goals.firsttry).toBe(1);
    expect(endJson.player.valuables.mp3).toBe(1);

    // 5. Check Hard Drive storage, sell pack, redeem stolen card by id & by card number, and check classic static assets
    const storageRes = await app.request('/api/storage', { headers: { Cookie: cookie } });
    const storageJson = await storageRes.json();
    expect(storageJson.files.length).toBe(1);
    expect(storageJson.cards.length).toBe(4); // 3 generated in mission network + 1 from payload
    expect(startJson.init.cards.length).toBe(3);

    const sellRes = await app.request('/api/storage/sell-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ valuableId: 'mp3', count: 1 }),
    });
    expect(sellRes.status).toBe(200);

    const redeemRes = await app.request('/api/storage/redeem-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cardId: 'cc_1' }),
    });
    expect(redeemRes.status).toBe(200);

    const redeemByNumberRes = await app.request('/api/storage/redeem-card-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ number: startJson.init.cards[0] }),
    });
    expect(redeemByNumberRes.status).toBe(200);

    const cssRes = await app.request('/style.css');
    expect(cssRes.status).toBe(200);
    const svgRes = await app.request('/shapes_svg/1.svg');
    expect(svgRes.status).toBe(200);

    // 6. Daily Challenge ranked run + leaderboard check
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
        score: 8450,
      }),
    });
    expect(chalEnd.status).toBe(200);
    const chalEndJson = await chalEnd.json();
    expect(chalEndJson.isRanked).toBe(true);

    const chalBoard = await (await app.request('/api/challenges/today', { headers: { Cookie: cookie } })).json();
    expect(chalBoard.hasPlayedRanked).toBe(true);
    expect(chalBoard.leaderboard.length).toBe(1);
    expect(chalBoard.leaderboard[0].bestScore).toBe(8450);
  });
});
