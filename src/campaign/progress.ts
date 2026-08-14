/** Campaign progress, kept in localStorage.
 *
 * Deliberately local rather than in Firebase: the campaign is single-player,
 * plays fine signed out, and a lost save is a lost save — not worth a round
 * trip or a security rule. Every read is defensive because localStorage can
 * be disabled, full, or hold something another version of the game wrote.
 */

const KEY = 'cheskers:campaign:v1';

export interface CampaignSave {
  cleared: string[];
  /** Highest horror level the player has actually reached, so the menu can
   *  stay stained once they have seen it. */
  deepest: number;
}

const EMPTY: CampaignSave = { cleared: [], deepest: 0 };

export function loadProgress(): CampaignSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    const save = parsed as Partial<CampaignSave>;
    return {
      cleared: Array.isArray(save.cleared)
        ? save.cleared.filter((id): id is string => typeof id === 'string')
        : [],
      deepest: typeof save.deepest === 'number' ? save.deepest : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProgress(save: CampaignSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Private browsing, quota, or storage disabled. The campaign still plays;
    // it just will not be there tomorrow.
  }
}

export function markCleared(id: string, horror: number): CampaignSave {
  const save = loadProgress();
  if (!save.cleared.includes(id)) save.cleared.push(id);
  save.deepest = Math.max(save.deepest, horror);
  saveProgress(save);
  return save;
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the in-memory state is reset by the caller regardless.
  }
}
