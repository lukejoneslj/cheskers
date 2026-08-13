# Cheskers

**Play: [cheskers.vercel.app](https://cheskers.vercel.app)**

Chess and checkers on one board. Your back rank is a normal chess set; in front
of it stands a rank of checkers instead of pawns. There is no check and no
checkmate — **capture the enemy King and you win**, so you have to guard yours
yourself.

Pixel art, hand-tuned animation, hotseat and online play. Built as a static
site: Vite + TypeScript, no framework, no backend of its own.

---

## Rules

| | |
|---|---|
| **Chess pieces** | Move and capture exactly as in chess. |
| **Checkers** | Step diagonally forward. Capture by hopping an adjacent enemy — *any* enemy, including a queen — onto the empty square beyond. Chain further hops in the same turn. |
| **Crowning** | A checker reaching the far rank is crowned and may then move backwards. Crowning ends the turn, even mid-chain. |
| **Winning** | Capture the King. |
| **Forced jumps** | If any hop is available you must take one. Toggleable. |
| **No legal moves** | Counts as a loss by default. Toggleable to a draw. |

There is no pawn in this game — the checkers occupy the pawns' rank. The pawn
sprite is extracted from the sheet and available at
`public/sprites/chess_*_pawn.png` if you ever want a variant that uses it.

---

## Running it

```bash
npm install
npm run dev
```

The game is fully playable as hotseat with no further setup. Online play needs
Firebase (below); without it the lobby explains what is missing and everything
else still works.

| Command | |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests — rules engine and Elo (55) |
| `npm run test:rules` | Security-rule tests against the live database (35) † |
| `npm run sprites` | Re-cut sprites from `assets/` (needs Python + Pillow/NumPy) |

† `test:rules` runs against the real database and leaves behind a throwaway
room and three anonymous accounts. Clear them with
`firebase database:remove /rooms --force` and `... /users --force`, or point it
at a staging project.

---

## Online play (Firebase)

Vercel's serverless functions cannot hold a WebSocket open, so realtime sync
runs through Firebase Realtime Database directly from the browser. There is no
server of ours in the path.

> This repo is already pointed at a live project, `cheskers-50466`
> (see `.firebaserc`). The steps below are what created it, and what you would
> repeat for a second environment.

**1. Create the project**

```bash
firebase login
firebase projects:create cheskers-live
firebase use cheskers-live
```

**2. Create the Realtime Database**

```bash
firebase init database
```

Answer the prompts (keep `database.rules.json`, say yes to setting up the
instance, pick a region, and **decline** the offer to overwrite the rules file —
the rules in this repo are the ones you want). `database:instances:create`
cannot be used until a default instance exists, so `init` has to go first.

**3. Register a web app and copy the config**

```bash
firebase apps:create WEB "Cheskers Web"
firebase apps:sdkconfig WEB <appId>
```

Copy the values into `.env.local` (`cp .env.example .env.local`).

**4. Publish the security rules**

```bash
firebase deploy --only database
```

**5. Enable anonymous sign-in — console only**

Open **Authentication** in the [Firebase console](https://console.firebase.google.com),
click **Get started**, then enable the **Anonymous** provider.

This one step genuinely cannot be scripted on the free Spark plan. The CLI has
no command for it, and the admin API refuses: `identityPlatform:initializeAuth`
returns `BILLING_NOT_ENABLED`, because that endpoint provisions Google Cloud
Identity Platform, the paid product. Until Authentication is provisioned once
from the console, `admin/v2/.../config` returns `CONFIGURATION_NOT_FOUND` and
client sign-in fails with `auth/configuration-not-found`.

**6. Restart the dev server.** The lobby is now live.

### Deploying to Vercel

Already deployed and connected to this repo — pushing to `main` redeploys
production automatically. To set it up from scratch:

```bash
vercel link --yes --project cheskers
vercel env add VITE_FIREBASE_API_KEY production   # ...and the other four
vercel --prod --yes
```

The `VITE_*` values must exist **before** the build: Vite inlines them at build
time, so adding them afterwards does nothing until you redeploy. `vercel.json`
sets the build command, output directory and long-lived caching for sprites.

Then authorize the domain under **Firebase → Authentication → Settings →
Authorized domains**, or sign-in is refused in production.

**Note on preview URLs.** Vercel's Deployment Protection is on, so the
project-scoped and per-deployment URLs
(`cheskers-<hash>-<team>.vercel.app`) sit behind a Vercel login. The
production alias `cheskers.vercel.app` is public and is the one to share.
If you want preview deployments to be playable by others, turn off
Deployment Protection in **Vercel → Project → Settings → Deployment
Protection**, and add that domain to Firebase's authorized domains too.

---

## How the multiplayer works

Rooms are keyed by a four-character code. The wire format is an **append-only
list of moves**, never a board snapshot: both clients start from the same
position and replay the list through the same rules engine, so there is no
board state for them to disagree about.

Each move on the wire is only `{from, to, by}`. What it captures and whether it
crowns are re-derived locally from our own engine, so a modified client cannot
invent a capture.

Resigning is sent as its own flag rather than as a move, so the opponent's
client ends the game instead of waiting for a turn that will never come.

Reconnects work: the auth session persists, so returning to a room with the
same browser puts you back in your own seat rather than spawning a second
player. Presence uses `onDisconnect`, so the other side sees `OFFLINE` rather
than unexplained silence.

### Accounts and ratings

Everyone gets an anonymous account on first load, so you can play online
without signing up. Signing in with Google or an email address **links** that
anonymous account rather than replacing it — the uid never changes, so the
rating you earned as a guest comes with you. (If the Google account already
has its own history, we sign into that instead of discarding it.)

Ratings are standard Elo: K=40 while provisional (under 30 games), 20 once
established, 10 at 2400+. Both clients capture each other's rating when the
pairing is made, so the exchange stays symmetric even if one side scores the
game first, and each client writes only its own row.

**The trust model, honestly.** Database rules enforce a lot, and
`npm run test:rules` proves it against the live database with real end-user
tokens — 35 checks covering both what must be refused and what must still
work. You may only claim an empty seat, only write moves tagged with your own
seat, only concede on your own behalf, and a move once written can never be
edited or deleted. A rating may not move more than one game's worth per write,
counters may only go forward one at a time, and a game can only be scored once
— the marker is write-once and requires you to have actually sat in that room.

What rules *cannot* do is run the game engine, so they cannot tell a legal move
from an illegal one. That check happens on the receiving client, which rejects
anything the engine says is illegal. Nor can they verify that a rating delta is
the *correct* Elo result — only that it is within a plausible bound.

So the practical limits: a tampered client cannot force an illegal position on
you, cannot touch your profile, and cannot double-score a game. It could still
desync a game it is already in, or grind its own rating upward one bounded
write at a time. This is a leaderboard for playing with friends, not a
competitive ladder. Closing that last gap needs the engine running somewhere a
player cannot edit — a Cloud Function per move — which requires the paid Blaze
plan.

One rules subtlety worth knowing if you edit `database.rules.json`: a granting
`.write` on an ancestor **cascades** to every descendant, so a stricter
`.write` deeper in the tree is dead code. `.validate` is different — every one
along the path must pass. Constraints that must not be bypassable therefore
belong in `.validate`. The write-once rating marker originally used `.write`
and was silently bypassable until the rule test caught it.

---

## Layout

```
assets/                   Original sprite sheets (source of truth)
tools/extract_sprites.py  Background removal + slicing -> public/sprites
tools/test-rules.mjs      Security-rule tests over the REST API
public/sprites/           16 transparent PNGs, one shared pixel grid
src/engine/               Pure rules + Elo. No DOM. 55 unit tests.
src/render/               Canvas renderer, tweens, particles, palette
src/net/                  Firebase bootstrap, accounts, room sync
src/ui/                   App controller, lobby, profile, procedural sound
database.rules.json       Realtime Database security rules
```

The engine knows nothing about pixels and the renderer knows nothing about
rules; `src/ui/app.ts` is the only place they meet. That separation is what
lets the same engine validate moves arriving over the network.

### A note on the sprites

The two source sheets were drawn at different resolutions — the chess set at a
10× pixel upscale, the checkers at roughly 11×, which left the checkers at
about double the effective density. `tools/extract_sprites.py` reduces each
sheet to its **own** native grid, at 10 and 17 respectively, which puts both
armies on one shared pixel grid so they can be drawn at a single integer scale
and still read as one art set. 17 is the coarsest step that still resolves the
crown on a crowned man.

Backgrounds are keyed out with a flood fill seeded from the image border rather
than a global colour match — the white chess pieces are filled with the same
white as the backdrop, so a global match would punch holes straight through
them.
