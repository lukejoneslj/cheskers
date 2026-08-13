#!/usr/bin/env node
/**
 * Security-rule test for the Realtime Database.
 *
 * Talks to the database over its REST interface with real end-user ID tokens,
 * so every request is evaluated by the deployed rules exactly as a browser's
 * would be. Deliberately avoids the client SDK: the SDK applies writes to a
 * local cache before the server answers, which makes a rejected write briefly
 * look like it succeeded.
 *
 * Usage:  node tools/test-rules.mjs
 * Reads Firebase config from .env.local.
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const KEY = env.VITE_FIREBASE_API_KEY;
const DB = env.VITE_FIREBASE_DATABASE_URL.replace(/\/$/, '');
const ROOM = `T${randomBytes(2).toString('hex').toUpperCase()}`;

/** Mint a throwaway anonymous user and return its token + uid. */
async function anonUser() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`anon sign-in failed: ${await res.text()}`);
  const body = await res.json();
  return { token: body.idToken, uid: body.localId };
}

async function write(user, path, value, method = 'PUT') {
  const res = await fetch(`${DB}/${path}.json?auth=${user.token}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function read(user, path) {
  const res = await fetch(`${DB}/${path}.json?auth=${user.token}`);
  return res.ok ? JSON.parse(await res.text()) : null;
}

const results = [];

/** `expect` is 'allow' or 'deny'. */
async function check(label, expect, run) {
  const r = await run();
  const denied = !r.ok && /permission|denied/i.test(r.body);
  const actual = r.ok ? 'allow' : denied ? 'deny' : `error(${r.status})`;
  const pass = actual === expect;
  results.push({ label, expect, actual, pass, detail: pass ? '' : r.body.slice(0, 120) });
}

const main = async () => {
  const alice = await anonUser();
  const bob = await anonUser();
  const mallory = await anonUser(); // a third party in neither seat

  // --- Setup: Alice opens a room, Bob takes the empty seat -----------------
  await check('alice creates room', 'allow', () =>
    write(alice, `rooms/${ROOM}`, {
      createdAt: Date.now(),
      generation: 0,
      rules: { forcedJumps: true, lossOnNoMoves: true },
      status: 'waiting',
      players: { w: { uid: alice.uid, name: 'ALICE' } },
    }));

  await check('bob claims the empty seat', 'allow', () =>
    write(bob, `rooms/${ROOM}/players`, {
      w: { uid: alice.uid, name: 'ALICE' },
      b: { uid: bob.uid, name: 'BOB' },
    }));

  await check('bob marks himself online', 'allow', () =>
    write(bob, `rooms/${ROOM}/presence/b`, true));

  await check('alice plays her own move', 'allow', () =>
    write(alice, `rooms/${ROOM}/moves`, { from: 50, to: 43, by: 'w' }, 'POST'));

  await check('bob plays his own move', 'allow', () =>
    write(bob, `rooms/${ROOM}/moves`, { from: 9, to: 18, by: 'b' }, 'POST'));

  // --- Attacks from the opponent -------------------------------------------
  await check('bob forges a move as White', 'deny', () =>
    write(bob, `rooms/${ROOM}/moves`, { from: 51, to: 44, by: 'w' }, 'POST'));

  await check('bob overwrites Alice’s seat', 'deny', () =>
    write(bob, `rooms/${ROOM}/players/w`, { uid: bob.uid, name: 'HACKER' }));

  await check('bob renames Alice', 'deny', () =>
    write(bob, `rooms/${ROOM}/players`, {
      w: { uid: alice.uid, name: 'LOSER' },
      b: { uid: bob.uid, name: 'BOB' },
    }));

  await check('bob deletes Alice’s seat', 'deny', () =>
    write(bob, `rooms/${ROOM}/players/w`, null, 'DELETE'));

  await check('bob fakes Alice offline', 'deny', () =>
    write(bob, `rooms/${ROOM}/presence/w`, false));

  await check('bob changes the ruleset mid-game', 'deny', () =>
    write(bob, `rooms/${ROOM}/rules`, { forcedJumps: false, lossOnNoMoves: false }));

  await check('bob injects an unknown field', 'deny', () =>
    write(bob, `rooms/${ROOM}/backdoor`, 1));

  await check('bob writes an out-of-range square', 'deny', () =>
    write(bob, `rooms/${ROOM}/moves`, { from: 999, to: -5, by: 'b' }, 'POST'));

  await check('bob writes a malformed move', 'deny', () =>
    write(bob, `rooms/${ROOM}/moves`, { from: 1 }, 'POST'));

  const moves = await read(alice, `rooms/${ROOM}/moves`);
  const firstKey = Object.keys(moves ?? {})[0];
  await check('bob rewrites a played move', 'deny', () =>
    write(bob, `rooms/${ROOM}/moves/${firstKey}`, { from: 0, to: 1, by: 'b' }));

  await check('bob deletes a played move', 'deny', () =>
    write(bob, `rooms/${ROOM}/moves/${firstKey}`, null, 'DELETE'));

  await check('bob rewinds the generation', 'deny', () =>
    write(bob, `rooms/${ROOM}/generation`, -1));

  // --- Attacks from an uninvolved third party ------------------------------
  await check('stranger takes an occupied seat', 'deny', () =>
    write(mallory, `rooms/${ROOM}/players/b`, { uid: mallory.uid, name: 'MAL' }));

  await check('stranger plays a move', 'deny', () =>
    write(mallory, `rooms/${ROOM}/moves`, { from: 51, to: 44, by: 'w' }, 'POST'));

  await check('stranger wipes the move log', 'deny', () =>
    write(mallory, `rooms/${ROOM}/moves`, null, 'DELETE'));

  // --- Concessions ----------------------------------------------------------
  await check('bob concedes for Alice', 'deny', () =>
    write(bob, `rooms/${ROOM}/resigned`, 'w'));

  await check('bob concedes for himself', 'allow', () =>
    write(bob, `rooms/${ROOM}/resigned`, 'b'));

  // --- Profiles and ratings -------------------------------------------------
  await check('bob seeds his own profile', 'allow', () =>
    write(bob, `users/${bob.uid}`, { name: 'BOB', rating: 1200, games: 0, wins: 0, losses: 0, draws: 0 }));

  await check('bob writes Alice’s profile', 'deny', () =>
    write(bob, `users/${alice.uid}`, { name: 'ALICE', rating: 4000 }));

  await check('bob invents a 4000 rating', 'deny', () =>
    write(bob, `users/${bob.uid}/rating`, 4000));

  await check('bob nudges rating beyond one game', 'deny', () =>
    write(bob, `users/${bob.uid}/rating`, 1241));

  await check('bob claims a legitimate rating change', 'allow', () =>
    write(bob, `users/${bob.uid}/rating`, 1220));

  await check('bob adds five games at once', 'deny', () =>
    write(bob, `users/${bob.uid}/games`, 5));

  await check('bob rewinds his loss count', 'deny', () =>
    write(bob, `users/${bob.uid}/losses`, -1));

  await check('bob marks a game he played as rated', 'allow', () =>
    write(bob, `users/${bob.uid}/rated/${ROOM}/0`, true));

  await check('bob scores the same game twice', 'deny', () =>
    write(bob, `users/${bob.uid}/rated/${ROOM}/0`, true));

  await check('bob scores a game he never played', 'deny', () =>
    write(bob, `users/${bob.uid}/rated/ZZZZ/0`, true));

  await check('bob injects a field into his profile', 'deny', () =>
    write(bob, `users/${bob.uid}/admin`, true));

  // --- Legitimate rematch ---------------------------------------------------
  await check('player clears the log for a rematch', 'allow', () =>
    write(bob, `rooms/${ROOM}/moves`, null, 'DELETE'));

  await check('player bumps the generation by one', 'allow', () =>
    write(bob, `rooms/${ROOM}/generation`, 1));

  // --- Report ---------------------------------------------------------------
  const width = Math.max(...results.map((r) => r.label.length));
  let failures = 0;
  for (const r of results) {
    if (!r.pass) failures++;
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `${mark}  ${r.label.padEnd(width)}  expected ${r.expect.padEnd(5)} got ${r.actual}` +
        (r.detail ? `\n        ${r.detail}` : ''),
    );
  }
  console.log(`\n${results.length - failures}/${results.length} checks passed  (room ${ROOM})`);
  process.exitCode = failures ? 1 : 0;
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
