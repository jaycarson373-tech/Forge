import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
test('SQLite rolls back failed mutations and persists committed state after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-test-'));
  const path = join(dir, 'test.sqlite');
  try {
    const s = new Store(path);
    const original = s.read().balance;
    assert.throws(() =>
      s.update((state) => {
        state.balance = '0';
        throw new Error('abort');
      }),
    );
    assert.equal(s.read().balance, original);
    s.update((state) => {
      state.balance = '123';
    });
    s.close();
    const reopened = new Store(path);
    assert.equal(reopened.read().balance, '123');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
