import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

/**
 * Tiny key-value store on IndexedDB with an in-memory fallback (private windows, sandboxed iframes,
 * or headless test runs without storage). Each named store lives in its own database.
 */
export interface KeyValueStore<T> {
  getAll(): Promise<Array<[string, T]>>;
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  readonly persistent: boolean;
}

class MemoryStore<T> implements KeyValueStore<T> {
  readonly persistent = false;
  private readonly map = new Map<string, T>();
  async getAll(): Promise<Array<[string, T]>> {
    return [...this.map.entries()];
  }
  async get(key: string): Promise<T | undefined> {
    return this.map.get(key);
  }
  async set(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class IdbStore<T> implements KeyValueStore<T> {
  readonly persistent = true;
  private readonly store: UseStore;
  constructor(name: string) {
    this.store = createStore(`buildergame-${name}`, 'kv');
  }
  async getAll(): Promise<Array<[string, T]>> {
    return (await entries<string, T>(this.store)).map(([k, v]) => [String(k), v]);
  }
  get(key: string): Promise<T | undefined> {
    return get<T>(key, this.store);
  }
  set(key: string, value: T): Promise<void> {
    return set(key, value, this.store);
  }
  delete(key: string): Promise<void> {
    return del(key, this.store);
  }
}

export async function openStore<T>(name: string): Promise<KeyValueStore<T>> {
  if (typeof indexedDB === 'undefined') return new MemoryStore<T>();
  const store = new IdbStore<T>(name);
  try {
    await store.getAll(); // probe: throws when IndexedDB is blocked
    return store;
  } catch (e) {
    console.warn(`IndexedDB unavailable for ${name}; using memory store`, e);
    return new MemoryStore<T>();
  }
}
