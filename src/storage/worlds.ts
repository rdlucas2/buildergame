import type { World } from '../core/world';
import { openStore, type KeyValueStore } from './kv';

export interface WorldSummary {
  id: string;
  name: string;
  updatedAt: string;
  placements: number;
  wild: boolean;
  /** A Warren Defense world (always wild too). */
  defense: boolean;
}

interface Meta {
  activeWorldId?: string;
  author?: string;
  settings?: Record<string, unknown>;
}

/** Every world on this machine plus small app-wide settings. Worlds are stored as plain objects. */
export class WorldStore {
  private readonly worlds = new Map<string, World>();
  private store: KeyValueStore<World> | null = null;
  private metaStore: KeyValueStore<Meta> | null = null;
  private meta: Meta = {};
  private readonly listeners = new Set<() => void>();

  async open(): Promise<void> {
    this.store = await openStore<World>('worlds');
    this.metaStore = await openStore<Meta>('meta');
    this.worlds.clear();
    for (const [id, w] of await this.store.getAll()) this.worlds.set(id, w);
    this.meta = (await this.metaStore.get('meta')) ?? {};
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): WorldSummary[] {
    return [...this.worlds.values()]
      .map((w) => ({ id: w.id, name: w.name, updatedAt: w.updatedAt, placements: w.placements.length, wild: !!w.ecosystem, defense: !!w.ecosystem?.defense }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  get(id: string): World | undefined {
    return this.worlds.get(id);
  }

  has(id: string): boolean {
    return this.worlds.has(id);
  }

  async save(w: World): Promise<void> {
    this.worlds.set(w.id, w);
    await this.store?.set(w.id, w);
    this.emit();
  }

  async remove(id: string): Promise<void> {
    this.worlds.delete(id);
    await this.store?.delete(id);
    if (this.meta.activeWorldId === id) await this.setActiveWorldId(undefined);
    this.emit();
  }

  get activeWorldId(): string | undefined {
    return this.meta.activeWorldId;
  }

  async setActiveWorldId(id: string | undefined): Promise<void> {
    this.meta = { ...this.meta, activeWorldId: id };
    await this.metaStore?.set('meta', this.meta);
  }

  get author(): string {
    return this.meta.author ?? '';
  }

  async setAuthor(name: string): Promise<void> {
    this.meta = { ...this.meta, author: name };
    await this.metaStore?.set('meta', this.meta);
  }

  getSetting<T>(key: string, fallback: T): T {
    const v = this.meta.settings?.[key];
    return v === undefined ? fallback : (v as T);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.meta = { ...this.meta, settings: { ...(this.meta.settings ?? {}), [key]: value } };
    await this.metaStore?.set('meta', this.meta);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
