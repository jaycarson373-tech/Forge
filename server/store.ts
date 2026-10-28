import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedState, type PaperState } from '../src/domain.js';
export class Store {
  db: DatabaseSync;
  constructor(path = 'data/forge.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS paper (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)',
    );
    this.db.prepare('INSERT OR IGNORE INTO paper VALUES (1,?)').run(JSON.stringify(seedState()));
  }
  read(): PaperState {
    return JSON.parse(
      (this.db.prepare('SELECT state FROM paper WHERE id=1').get() as { state: string }).state,
    );
  }
  update<T>(fn: (state: PaperState) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = fn(state);
      this.db.prepare('UPDATE paper SET state=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  reset() {
    this.update((s) => Object.assign(s, seedState()));
  }
  close() {
    this.db.close();
  }
}
