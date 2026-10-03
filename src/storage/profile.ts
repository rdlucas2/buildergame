import { parseProfile } from '../core/format/profile-file';
import { newProfile, type PlayerProfile } from '../core/profile';
import { openStore, type KeyValueStore } from './kv';

const KEY = 'profile';

/**
 * The player's Warren Defense progress, kept in its own IndexedDB store (one profile per browser).
 * A profile that fails its checks is set aside (kept under another key) rather than lost.
 */
export class ProfileStore {
  private store: KeyValueStore<unknown> | null = null;
  profile: PlayerProfile = newProfile();
  private readonly listeners = new Set<(p: PlayerProfile) => void>();

  async open(): Promise<void> {
    this.store = await openStore<unknown>('profile');
    const raw = await this.store.get(KEY);
    if (raw === undefined) return;
    try {
      this.profile = parseProfile(raw);
    } catch (e) {
      console.warn('Player profile unreadable; starting a new one', e);
      await this.store.set(`${KEY}-unreadable-${Date.now()}`, raw);
    }
  }

  subscribe(fn: (p: PlayerProfile) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replaces the profile and saves it. */
  async save(profile: PlayerProfile): Promise<void> {
    this.profile = profile;
    for (const fn of this.listeners) fn(profile);
    await this.store?.set(KEY, structuredClone(profile));
  }
}
