import { decodeStructure, encodeStructure, parseStructure, type StructureFile } from '../core/format/structure-file';
import { newId } from '../core/ids';
import { structureContentEquals, type Structure } from '../core/structure';
import { openStore, type KeyValueStore } from './kv';

export type LibraryListener = () => void;

/** All structures the player has built or imported. Persisted as structure-file JSON records. */
export class StructureLibrary {
  private readonly items = new Map<string, Structure>();
  private store: KeyValueStore<StructureFile> | null = null;
  private readonly listeners = new Set<LibraryListener>();

  async open(): Promise<void> {
    this.store = await openStore<StructureFile>('structures');
    this.items.clear();
    for (const [id, record] of await this.store.getAll()) {
      try {
        this.items.set(id, decodeStructure(record));
      } catch (e) {
        console.warn(`Skipping unreadable structure ${id}`, e);
      }
    }
    this.emit();
  }

  get persistent(): boolean {
    return this.store?.persistent ?? false;
  }

  subscribe(fn: LibraryListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get size(): number {
    return this.items.size;
  }

  get(id: string): Structure | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Newest first. */
  all(): Structure[] {
    return [...this.items.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async save(s: Structure): Promise<void> {
    this.items.set(s.id, s);
    await this.store?.set(s.id, encodeStructure(s));
    this.emit();
  }

  async saveMany(list: Structure[]): Promise<void> {
    for (const s of list) {
      this.items.set(s.id, s);
      await this.store?.set(s.id, encodeStructure(s));
    }
    this.emit();
  }

  async remove(id: string): Promise<boolean> {
    if (!this.items.delete(id)) return false;
    await this.store?.delete(id);
    this.emit();
    return true;
  }

  /**
   * Imports a structure file. Identical content under a known id is reused; an id clash with
   * different content gets a fresh id so nothing in the library is overwritten.
   */
  async importText(text: string): Promise<{ structure: Structure; outcome: 'added' | 'reused' | 'renamed' }> {
    const parsed = parseStructure(text);
    const existing = this.items.get(parsed.id);
    if (existing) {
      if (structureContentEquals(existing, parsed)) return { structure: existing, outcome: 'reused' };
      const renamed = { ...parsed, id: newId() };
      await this.save(renamed);
      return { structure: renamed, outcome: 'renamed' };
    }
    await this.save(parsed);
    return { structure: parsed, outcome: 'added' };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
