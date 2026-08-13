/** Accounts and persistent player profiles.
 *
 * Everyone gets an anonymous account on first contact so they can play online
 * without signing up. Signing in with Google or an email address *links* that
 * same anonymous account rather than replacing it, which means the rating you
 * earned before signing up follows you in — the uid never changes, so neither
 * does your history.
 */

import type { User } from 'firebase/auth';

import { STARTING_RATING, type Outcome, type RatingChange, rate } from '../engine/elo';
import { connect } from './firebase';

export interface Profile {
  uid: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** True while the player has only an anonymous account. */
  guest: boolean;
}

export interface AuthState {
  user: User | null;
  profile: Profile | null;
}

export type AuthListener = (state: AuthState) => void;

const DEFAULT_NAME = 'PLAYER';

export const cleanName = (raw: string): string =>
  (raw || DEFAULT_NAME).trim().slice(0, 12).toUpperCase() || DEFAULT_NAME;

export class Accounts {
  private listeners: AuthListener[] = [];
  private state: AuthState = { user: null, profile: null };
  private started = false;

  get current(): AuthState {
    return this.state;
  }

  onChange(listener: AuthListener): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  /** Begin watching auth state, signing in anonymously if nobody is signed in. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { auth } = await connect();
    const { onAuthStateChanged, signInAnonymously } = await import('firebase/auth');

    onAuthStateChanged(auth, (user) => {
      this.state = { user, profile: this.state.profile };
      if (user) {
        void this.loadProfile(user);
      } else {
        this.state = { user: null, profile: null };
        this.emit();
        void signInAnonymously(auth);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Profile storage
  // -------------------------------------------------------------------------

  private async loadProfile(user: User): Promise<void> {
    const { db } = await connect();
    const { ref, get } = await import('firebase/database');
    const snap = await get(ref(db, `users/${user.uid}`));
    const stored = snap.val() as Partial<Profile> | null;

    const profile: Profile = {
      uid: user.uid,
      name: cleanName(stored?.name ?? user.displayName ?? DEFAULT_NAME),
      rating: typeof stored?.rating === 'number' ? stored.rating : STARTING_RATING,
      games: stored?.games ?? 0,
      wins: stored?.wins ?? 0,
      losses: stored?.losses ?? 0,
      draws: stored?.draws ?? 0,
      guest: user.isAnonymous,
    };

    // Seed a profile row the first time we see this account, so the rating a
    // player is matched against always exists.
    if (!stored) await this.persist(profile);

    this.state = { user, profile };
    this.emit();
  }

  private async persist(profile: Profile): Promise<void> {
    const { db } = await connect();
    const { ref, update } = await import('firebase/database');
    await update(ref(db, `users/${profile.uid}`), {
      name: profile.name,
      rating: profile.rating,
      games: profile.games,
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
    });
  }

  async setName(raw: string): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    const next = { ...profile, name: cleanName(raw) };
    this.state = { ...this.state, profile: next };
    await this.persist(next);
    this.emit();
  }

  /** Read another player's public rating, for the pairing display and Elo. */
  async ratingOf(uid: string): Promise<{ rating: number; games: number }> {
    const { db } = await connect();
    const { ref, get } = await import('firebase/database');
    const snap = await get(ref(db, `users/${uid}`));
    const stored = snap.val() as Partial<Profile> | null;
    return {
      rating: typeof stored?.rating === 'number' ? stored.rating : STARTING_RATING,
      games: stored?.games ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------------

  /** Sign in with Google, upgrading the current anonymous account in place so
   *  its rating and record survive. */
  async withGoogle(): Promise<void> {
    const { auth } = await connect();
    const mod = await import('firebase/auth');
    const provider = new mod.GoogleAuthProvider();
    const user = auth.currentUser;

    if (user?.isAnonymous) {
      try {
        await mod.linkWithPopup(user, provider);
        await this.adoptName(user);
        return;
      } catch (error) {
        // The Google account already has its own history. Falling back to a
        // plain sign-in keeps that existing account (and its rating) rather
        // than silently discarding it.
        if (!isAlreadyLinked(error)) throw error;
        await mod.signInWithPopup(auth, provider);
        return;
      }
    }
    await mod.signInWithPopup(auth, provider);
  }

  async withEmail(email: string, password: string, isNew: boolean): Promise<void> {
    const { auth } = await connect();
    const mod = await import('firebase/auth');
    const user = auth.currentUser;

    if (isNew && user?.isAnonymous) {
      const credential = mod.EmailAuthProvider.credential(email, password);
      try {
        await mod.linkWithCredential(user, credential);
        await this.adoptName(auth.currentUser!);
        return;
      } catch (error) {
        if (!isAlreadyLinked(error)) throw error;
        await mod.signInWithEmailAndPassword(auth, email, password);
        return;
      }
    }

    if (isNew) {
      await mod.createUserWithEmailAndPassword(auth, email, password);
      return;
    }
    await mod.signInWithEmailAndPassword(auth, email, password);
  }

  /** Adopt the provider's display name, but never overwrite a name the player
   *  chose for themselves. */
  private async adoptName(user: User): Promise<void> {
    const profile = this.state.profile;
    const suggested = user.displayName ?? user.email?.split('@')[0];
    if (suggested && (!profile || profile.name === DEFAULT_NAME)) {
      await this.setName(suggested);
    }
    await this.loadProfile(user);
  }

  async signOut(): Promise<void> {
    const { auth } = await connect();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  }

  // -------------------------------------------------------------------------
  // Ratings
  // -------------------------------------------------------------------------

  /** Apply the result of a rated game to the local player's own record.
   *
   * Each client writes only its own row. `roomCode`/`generation` identify the
   * game so the same result can never be counted twice, even if both clients
   * see the game end more than once.
   */
  async applyResult(
    opponent: { rating: number; games: number },
    outcome: Outcome,
    roomCode: string,
    generation: number,
  ): Promise<RatingChange | null> {
    const profile = this.state.profile;
    if (!profile) return null;

    const { db } = await connect();
    const { ref, get, update } = await import('firebase/database');

    const marker = `users/${profile.uid}/rated/${roomCode}/${generation}`;
    const already = await get(ref(db, marker));
    if (already.exists()) return null;

    const change = rate({ rating: profile.rating, games: profile.games }, opponent, outcome);
    const next: Profile = {
      ...profile,
      rating: change.after,
      games: profile.games + 1,
      wins: profile.wins + (outcome === 'win' ? 1 : 0),
      losses: profile.losses + (outcome === 'loss' ? 1 : 0),
      draws: profile.draws + (outcome === 'draw' ? 1 : 0),
    };

    // Written as one update so the rating and the "already counted" marker
    // land together; a partial write would let the game be scored twice.
    await update(ref(db, `users/${profile.uid}`), {
      name: next.name,
      rating: next.rating,
      games: next.games,
      wins: next.wins,
      losses: next.losses,
      draws: next.draws,
      [`rated/${roomCode}/${generation}`]: true,
    });

    this.state = { ...this.state, profile: next };
    this.emit();
    return change;
  }

  /** Top players by rating, for the leaderboard. */
  async leaderboard(limit = 10): Promise<Profile[]> {
    const { db } = await connect();
    const { ref, query, orderByChild, limitToLast, get } = await import('firebase/database');
    const snap = await get(
      query(ref(db, 'users'), orderByChild('rating'), limitToLast(limit)),
    );
    const rows: Profile[] = [];
    snap.forEach((child) => {
      const v = child.val() as Partial<Profile>;
      // Unplayed accounts would otherwise fill the board with default ratings.
      if ((v.games ?? 0) > 0) {
        rows.push({
          uid: child.key!,
          name: cleanName(v.name ?? DEFAULT_NAME),
          rating: v.rating ?? STARTING_RATING,
          games: v.games ?? 0,
          wins: v.wins ?? 0,
          losses: v.losses ?? 0,
          draws: v.draws ?? 0,
          guest: false,
        });
      }
    });
    return rows.sort((a, b) => b.rating - a.rating);
  }
}

function isAlreadyLinked(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    code === 'auth/provider-already-linked'
  );
}

export const accounts = new Accounts();
