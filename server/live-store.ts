import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export class LiveStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS auth_nonce(id TEXT PRIMARY KEY,wallet TEXT,message TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS live_sessions(id TEXT PRIMARY KEY,wallet TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_assets(hash TEXT PRIMARY KEY,type TEXT,bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS live_coins(mint TEXT PRIMARY KEY,name TEXT,ticker TEXT,description TEXT,image TEXT,uri TEXT,creator TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS prepared_tx(id TEXT PRIMARY KEY,wallet TEXT,message_hash TEXT,raw TEXT,height INTEGER,expires INTEGER,intent TEXT,signature TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER,event TEXT,wallet TEXT,detail TEXT);
  `);
  }
  setting(key: string) {
    return (
      (
        this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
          { value: string } | undefined
      )?.value || ''
    );
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  challenge(wallet: string, origin: string) {
    new PublicKey(wallet);
    this.cleanup();
    const id = randomBytes(24).toString('hex'),
      expires = Date.now() + 300000;
    const message = `${new URL(origin).host} wants you to sign in to Forge with your Solana account:\n${wallet}\n\nAuthenticate your wallet. This does not authorize a transaction.\n\nURI: ${origin}\nNonce: ${id}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
    this.db.prepare('INSERT INTO auth_nonce VALUES(?,?,?,?)').run(id, wallet, message, expires);
    return { id, message, expires };
  }
  authenticate(id: string, signature: string) {
    if (!/^[a-f0-9]{48}$/.test(id) || signature.length > 200)
      throw new Error('Invalid sign-in request.');
    const row = this.db.prepare('SELECT * FROM auth_nonce WHERE id=?').get(id) as
      { wallet: string; message: string; expires: number } | undefined;
    if (!row || row.expires < Date.now()) throw new Error('Sign-in challenge expired.');
    const sig = Buffer.from(signature, 'base64');
    if (
      sig.length !== 64 ||
      !nacl.sign.detached.verify(Buffer.from(row.message), sig, new PublicKey(row.wallet).toBytes())
    )
      throw new Error('Invalid wallet signature.');
    this.db.prepare('DELETE FROM auth_nonce WHERE id=?').run(id);
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO live_sessions VALUES(?,?,?)')
      .run(hash(token), row.wallet, Date.now() + 3600000);
    return { token, wallet: row.wallet, expires: Date.now() + 3600000 };
  }
  session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const r = this.db
      .prepare('SELECT wallet,expires FROM live_sessions WHERE id=?')
      .get(hash(token)) as { wallet: string; expires: number } | undefined;
    return r && r.expires > Date.now() ? r.wallet : null;
  }
  logout(token: string) {
    this.db.prepare('DELETE FROM live_sessions WHERE id=?').run(hash(token));
  }
  asset(type: string, bytes: Buffer) {
    const id = hash(bytes);
    this.db.prepare('INSERT OR IGNORE INTO live_assets VALUES(?,?,?)').run(id, type, bytes);
    return id;
  }
  audit(event: string, wallet: string, detail: unknown) {
    this.db
      .prepare('INSERT INTO audit(at,event,wallet,detail) VALUES(?,?,?,?)')
      .run(Date.now(), event, wallet, JSON.stringify(detail));
  }
  cleanup() {
    const now = Date.now();
    this.db.prepare('DELETE FROM auth_nonce WHERE expires<?').run(now);
    this.db.prepare('DELETE FROM live_sessions WHERE expires<?').run(now);
    this.db
      .prepare('DELETE FROM prepared_tx WHERE expires<? AND signature IS NULL')
      .run(now - 86400000);
  }
  close() {
    this.db.close();
  }
}
