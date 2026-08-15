# Cheskers

**Play: [cheskers.vercel.app](https://cheskers.vercel.app)**

Chess and checkers on one board. Your back rank is a normal chess set; in front
of it stands a rank of checkers instead of pawns. There is no check and no
checkmate — **capture the enemy King and you win**, so you have to guard yours
yourself.

Pixel art, hand-tuned animation, hotseat play, an AI opponent, a story
campaign, a roguelike augment mode, and online play. Built as a static site:
Vite + TypeScript, no framework, no backend of its own.

Three screens, in order: a cinematic title with a looping video backdrop, a
mode menu, then the board. A white-flash transition hands off from the title;
the board screen carries only what you need mid-game, with a MENU button that
tears down whatever mode was running. Music crossfades between a menu track
and two gameplay tracks that alternate for the duration of a match — the
handoff starts a couple of seconds before each track ends so there's never a
gap.

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

## Playing against the AI

**PLAY VS AI** opens a colour and difficulty picker, then plays exactly like
an online match — the AI is wired up through the same `MatchBinding` seam as
a network opponent, and its moves land through the same `applyRemoteMove`
path, so it can't see or play anything the rules engine wouldn't also accept
from a human.

It's a negamax search with alpha-beta pruning (`src/engine/ai.ts`) over the
same `legalMoves`/`applyMove` the UI uses, run in a Web Worker
(`src/engine/ai.worker.ts`) so a multi-second `hard` search never freezes the
board's animation. Iterative deepening means it always has an answer ready:
it keeps searching one ply deeper until its time budget runs out, then plays
the best move from the last depth it fully finished. Easy difficulty adds a
chance of playing a plain random legal move instead, which reads as
"beatable" far better than just searching shallower does.

---

## The Long Game (campaign)

Eight opponents, played in order, each unlocked by beating the one before.
They are the same search engine throughout — what changes is what each one is
allowed to do, and what they say while doing it.

The horror is deliberately gradual. One number per chapter (`horror`, 0–7)
drives everything at once: the board palette is interpolated toward bone and
old meat, the CSS variables follow so the frame rots at the same rate as the
board, a vignette tightens, the room starts breathing at level 5, the title
stops being reliable at 6 — and the music is *detuned* rather than swapped,
because the same track going slightly wrong is worse than a different track.
See `src/ui/horror.ts`; the palette is mutable and read fresh every frame, so
re-tinting the canvas needs no other plumbing.

Progress lives in `localStorage` (`src/campaign/progress.ts`) — single-player,
plays fine signed out, and not worth a round trip or a security rule. Chapter
names stay hidden until they are reachable.

## Cheskers Mania

A run. Before every round you draft one augment from three — always at least
two commons and one wildcard, so a draft is never a coin flip on getting any
playable card at all. The opponent then draws one of its own, which the draft
screen shows you before the round begins. Win to draft again, lose once and
the run is over. The wildcard slot is weighted by round, so cursed cards
start crowding out commons the deeper you go.

Both loadouts are also printed on the player cards for the whole game, in
every mode that has augments, name spelled out next to the glyph — and every
chip is hoverable for its one-line rule. You should never have to work out
what your opponent is running from a move you did not think was legal.

## Augments

Thirty-five rule modifiers, each implemented inside the engine rather than
bolted onto the UI — which is what lets the AI play with and against them
with no special handling at all. They are granted per side, so "your checkers
may retreat" never accidentally applies to your opponent.

| | |
|---|---|
| **BACKPEDAL** | Checkers move and hop backwards, crowned or not. |
| **FLANK** | Checkers also step and hop sideways. |
| **EARLY CROWN** | Checkers crown one rank sooner. |
| **SIEGE ENGINE** | Rooks also step one square diagonally. |
| **OUTRIDERS** | Knights also step one square in any direction. |
| **MISSIONARIES** | Bishops also step one square orthogonally. |
| **WARLORD** | The king also moves as a knight. |
| **SWARM** | Checkers on their home rank may open two squares at once. |
| **RELENTLESS** | Crowning no longer ends a jump chain. |
| **ZEALOTS** | Bishops hop adjacent enemies like checkers — and chain. |
| **RAIDERS** | Knights hop adjacent enemies any direction — and chain. |
| **BLINK** | The king leaps exactly two squares, over anything. |
| **UNDYING** | The first checker you lose climbs back out on your home rank. |
| **AEGIS** | Both rooks turn aside the first attempt on them; the attacker dies. |
| **PHALANX** | Checkers standing beside another of yours cannot be hopped. |
| **REAPING** | Every third piece you take raises a fresh man on your home rank. |
| **STONEWALL** | Checkers cannot be captured by a chess piece — only by a hop. |
| **BOUNTY** | Taking any chess piece raises a fresh checker on your home rank. |
| **LAST STAND** | Down to 3 pieces or fewer, your checkers can move and hop any way. |
| **GRENADIER** | Both rooks arm on a 3-turn fuse; the blast hits friend and foe. |
| **GAMBLER** | Drafting this deals one hand of blackjack for a prize, or a price. |
| **FLYING KINGS** | Crowned checkers slide any distance and take from range. |
| **AMAZON** | The queen also moves as a knight. |
| **ROYAL GUARD** | The king turns aside the first attempt on it; the attacker dies. |
| **BLOODCROWN** | Any checker that captures is crowned on the spot. |
| **HEARTSTONE** | Every checker has a spare life; attacks bounce off. |
| **VETERANCY** | Pieces bank kills: 2 earns a spare life, 3 earns a step any direction. |
| **GORGE** | Every kill stacks another spare life onto the piece that made it. |
| **IRONCLAD** | Every chess piece but the king has a spare life. |
| **ASCENSION** | Each kill promotes the killer: checker → knight → bishop → rook → queen. |
| **POWDER KEG** | One checker is armed. It levels every neighbour when taken, or in six turns. |
| **MARTYRS** | Every checker levels its neighbours when it is taken. |
| **VOLATILE** | Every checker has a 1-in-4 chance to blow its neighbourhood when killed. |
| **LOADED DICE** | Roll a d10 each of your turns: a 10 blesses a checker, a 1 costs one a life. |
| **QUESTLINE** | Survive two more rounds holding this and it pays out a strong augment, free. |

Eleven of them hang state on **individual pieces** rather than the side —
`lives`, `marks`, `shield` and `bomb` live on `Piece`, so a particular checker
is the one carrying the keg and a particular rook is the one that has earned
its second life. The board draws them as pips above the piece (cyan lives,
gold kills, orange fuse, blinking in the last two turns), because a mechanic
you cannot see is a mechanic you cannot plan around.

None of this state ever crosses the wire. Online, the move format stays
`{from, to, by}` and both clients re-derive every fuse, life and mark by
replaying the log — which is why the keg starts on a fixed file rather than a
random square. `VOLATILE` and `LOADED DICE` are chance-based but still fit
this rule: rather than call `Math.random()`, they hash a hidden die roll out
of data both clients already agree on (piece id, move count), so the "random"
outcome replays identically on both ends without either one sending a coin
flip over the wire.

`ROYAL GUARD` is the one worth explaining: a shielded king cannot simply be
declared uncapturable without teaching the move generator a special case, so
instead the capture *resolves* — and the attacker is destroyed rather than
taking the square, with the shield breaking on the way. Deterministic, pure,
and the ward ring under the king makes it legible without a tooltip. `AEGIS`
is the same mechanic pointed at the rooks, and needed no new code beyond
dropping the "king only" condition. That destroyed attacker can itself be a
King — attack a shielded rook with your own King and lose it for nothing —
and that has to end the game exactly like any other King capture; an early
build of this feature missed that case and let the loser play on with no
King at all.

`GAMBLER` and `QUESTLINE` are the two that live outside the engine entirely:
they resolve inside the Mania draft screen rather than inside `rules.ts`,
since a one-shot card draw or a two-round countdown is meta-progression for
the run, not a rule the board itself needs to know about.

### Mania online

Ticking **Mania** when creating a room rolls three random augments per side
and stores them in the room's ruleset. There is no synchronised draft
protocol: the loadout is rolled once at creation, both clients read the same
list, and their engines proceed identically from there.

This works because *per-piece state is never sent over the wire*. The wire
format is still only `{from, to, by}`. Whose checker is carrying the keg, how
far the fuse has burned, which rook has banked two kills — all of it is
re-derived by replaying the move log through the same deterministic engine on
both sides. That is also why the keg starts on a fixed file rather than a
random square: two clients independently building the opening position have
to agree, and `Math.random()` would put them on different boards before the
first move.

Verified with two real clients on separate origins: identical loadouts,
identical armed positions, and after a move each the fuse read 5 on both
sides without a single byte of piece state crossing the network.

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
| `npm test` | Unit tests — rules, augments, Elo, and the AI search (126) |
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
assets/                   Original sprite sheets, title video, music, SFX (source of truth)
tools/extract_sprites.py  Background removal + slicing -> public/sprites
tools/test-rules.mjs      Security-rule tests over the REST API
public/sprites/           16 transparent PNGs, one shared pixel grid
public/video/             Title screen loop, re-encoded with audio stripped
public/music/             Title, menu, and two alternating gameplay tracks
public/sfx/               Recorded hit sounds for move/jump/capture/crown/click
src/engine/               Pure rules + augments + Elo + AI search. No DOM. 126 tests.
src/render/               Canvas renderer, tweens, particles, palette
src/net/                  Firebase bootstrap, accounts, room sync
src/campaign/             Chapter/NPC data and localStorage progress
src/ui/                   App controller, lobby, AI match, campaign, mania, horror, sound
database.rules.json       Realtime Database security rules
```

Sound is a mix of five recorded clips (move, jump, capture, crown, and a
generic UI click) and procedural chiptune tones for everything else
(select/deselect, illegal, win, lose) — see `src/ui/sound.ts`. Music lives
separately in `src/ui/music.ts`, which crossfades between two `<audio>`
elements rather than using Web Audio, since the tracks are several minutes
long and don't need sample-accurate mixing, just a clean handoff.

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
