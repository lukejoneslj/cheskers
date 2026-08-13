/** Profile panel: name, rating, record, sign-in and the leaderboard. */

import { rankOf } from '../engine/elo';
import { type Profile, accounts } from '../net/auth';
import { isConfigured } from '../net/firebase';
import { sound } from './sound';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

export class AccountPanel {
  private profile: Profile | null = null;

  private readonly dom = {
    modal: el('account-modal'),
    chip: el<HTMLButtonElement>('btn-profile'),
    chipName: el('profile-name'),
    chipRating: el('profile-rating'),

    name: el<HTMLInputElement>('account-name'),
    rank: el('account-rank'),
    rating: el('stat-rating'),
    games: el('stat-games'),
    wins: el('stat-wins'),
    losses: el('stat-losses'),

    guest: el('account-guest'),
    member: el('account-member'),
    emailLabel: el('account-email-label'),
    email: el<HTMLInputElement>('account-email'),
    password: el<HTMLInputElement>('account-password'),
    google: el<HTMLButtonElement>('account-google'),
    signup: el<HTMLButtonElement>('account-signup'),
    signin: el<HTMLButtonElement>('account-signin'),
    signout: el<HTMLButtonElement>('account-signout'),
    close: el<HTMLButtonElement>('account-close'),
    error: el('account-error'),
    leaderboard: el<HTMLOListElement>('leaderboard'),
  };

  constructor() {
    this.bind();
    if (!isConfigured()) {
      // Without a backend there are no accounts to show at all.
      this.dom.chip.hidden = true;
      return;
    }
    accounts.onChange(({ user, profile }) => {
      this.profile = profile;
      this.render(user?.email ?? null);
    });
    void accounts.start();
  }

  private bind(): void {
    this.dom.chip.addEventListener('click', () => this.open());
    this.dom.close.addEventListener('click', () => {
      this.dom.modal.hidden = true;
    });

    this.dom.name.addEventListener('change', () => {
      void accounts.setName(this.dom.name.value).catch((e) => this.fail(e));
    });

    this.dom.google.addEventListener('click', () => {
      void this.guard(this.dom.google, () => accounts.withGoogle());
    });
    this.dom.signup.addEventListener('click', () => {
      void this.guard(this.dom.signup, () => this.email(true));
    });
    this.dom.signin.addEventListener('click', () => {
      void this.guard(this.dom.signin, () => this.email(false));
    });
    this.dom.signout.addEventListener('click', () => {
      void this.guard(this.dom.signout, () => accounts.signOut());
    });
  }

  private async email(isNew: boolean): Promise<void> {
    const address = this.dom.email.value.trim();
    const password = this.dom.password.value;
    if (!address || password.length < 6) {
      throw new Error('Enter an email and a password of at least 6 characters');
    }
    await accounts.withEmail(address, password, isNew);
  }

  private open(): void {
    this.dom.modal.hidden = false;
    this.dom.error.textContent = '';
    void this.loadLeaderboard();
    sound.tick();
  }

  private async guard(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '...';
    this.dom.error.textContent = '';
    try {
      await action();
      void this.loadLeaderboard();
    } catch (error) {
      this.fail(error);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  private fail(error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    // Firebase messages read as "Firebase: Error (auth/popup-closed-by-user)."
    const code = /\(auth\/([a-z-]+)\)/.exec(raw)?.[1];
    const friendly: Record<string, string> = {
      'popup-closed-by-user': 'Sign-in window was closed.',
      'popup-blocked': 'Your browser blocked the sign-in popup.',
      'invalid-email': 'That email address is not valid.',
      'weak-password': 'Password needs to be at least 6 characters.',
      'email-already-in-use': 'That email already has an account — try Sign In.',
      'invalid-credential': 'Email or password is incorrect.',
      'wrong-password': 'Email or password is incorrect.',
      'user-not-found': 'No account with that email — try Create.',
      'network-request-failed': 'Network problem. Check your connection.',
    };
    this.dom.error.textContent = (code && friendly[code]) || raw;
  }

  // -------------------------------------------------------------------------

  private render(email: string | null): void {
    const profile = this.profile;
    if (!profile) {
      this.dom.chipName.textContent = '···';
      this.dom.chipRating.textContent = '';
      return;
    }

    const rank = rankOf(profile.rating);
    this.dom.chipName.textContent = profile.name;
    this.dom.chipRating.textContent = String(profile.rating);

    // Do not clobber the field while the player is editing their name.
    if (document.activeElement !== this.dom.name) this.dom.name.value = profile.name;
    this.dom.rank.textContent = rank.title;
    this.dom.rank.dataset.tier = rank.tier;
    this.dom.rating.textContent = String(profile.rating);
    this.dom.games.textContent = String(profile.games);
    this.dom.wins.textContent = String(profile.wins);
    this.dom.losses.textContent = String(profile.losses);

    this.dom.guest.hidden = !profile.guest;
    this.dom.member.hidden = profile.guest;
    this.dom.emailLabel.textContent = email ? `Signed in as ${email}` : 'Signed in.';
  }

  private async loadLeaderboard(): Promise<void> {
    if (!isConfigured()) return;
    try {
      const rows = await accounts.leaderboard(10);
      const list = this.dom.leaderboard;
      if (rows.length === 0) {
        list.innerHTML = '<li class="empty">No rated games yet</li>';
        return;
      }
      list.replaceChildren();
      rows.forEach((row, i) => {
        const li = document.createElement('li');
        if (row.uid === this.profile?.uid) li.className = 'me';
        li.innerHTML =
          `<span class="lb-rank">${i + 1}</span>` +
          `<span class="lb-name"></span>` +
          `<span class="lb-record">${row.wins}W ${row.losses}L</span>` +
          `<span class="lb-rating">${row.rating}</span>`;
        // Names are player-supplied, so they go in as text, never as markup.
        li.querySelector('.lb-name')!.textContent = row.name;
        list.appendChild(li);
      });
    } catch {
      this.dom.leaderboard.innerHTML = '<li class="empty">Leaderboard unavailable</li>';
    }
  }
}
