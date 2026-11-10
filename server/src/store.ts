import { DatabaseSync } from "node:sqlite";

export interface Message {
  id: number;
  token_id: string;
  account: string;
  text: string;
  reply_to: number | null;
  ts: number;
  is_dev: number;
  holder_pct: number;
}

export interface Call {
  id: number;
  token_id: string;
  account: string;
  thesis: string;
  ts: number;
  mcap_usd: number;
  peak_mcap_usd: number;
  last_mcap_usd: number;
  updated: number;
}

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL, account TEXT NOT NULL, text TEXT NOT NULL,
      reply_to INTEGER, ts INTEGER NOT NULL,
      is_dev INTEGER NOT NULL DEFAULT 0, holder_pct REAL NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_token ON messages (token_id, id);
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL, account TEXT NOT NULL, thesis TEXT NOT NULL, ts INTEGER NOT NULL,
      mcap_usd REAL NOT NULL, peak_mcap_usd REAL NOT NULL, last_mcap_usd REAL NOT NULL, updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS calls_token ON calls (token_id, id);
    CREATE INDEX IF NOT EXISTS calls_account ON calls (account);
  `);

  const now = () => Math.floor(Date.now() / 1000);

  return {
    // ---- auth ----
    addChallenge: (nonce: string) => db.prepare("INSERT INTO challenges (nonce, created) VALUES (?, ?)").run(nonce, now()),
    takeChallenge(nonce: string): boolean {
      db.prepare("DELETE FROM challenges WHERE created < ?").run(now() - 600);
      return db.prepare("DELETE FROM challenges WHERE nonce = ?").run(nonce).changes === 1;
    },
    addSession: (token: string, account: string, days = 14) =>
      db.prepare("INSERT INTO sessions (token, account, expires) VALUES (?, ?, ?)").run(token, account, now() + days * 86400),
    sessionAccount(token: string): string | null {
      const r = db.prepare("SELECT account FROM sessions WHERE token = ? AND expires > ?").get(token, now()) as { account: string } | undefined;
      return r?.account ?? null;
    },

    // ---- chat ----
    addMessage(m: Omit<Message, "id">): Message {
      const r = db
        .prepare("INSERT INTO messages (token_id, account, text, reply_to, ts, is_dev, holder_pct) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(m.token_id, m.account, m.text, m.reply_to, m.ts, m.is_dev, m.holder_pct);
      return { ...m, id: Number(r.lastInsertRowid) };
    },
    messages(tokenId: string, before: number | null, limit: number): Message[] {
      const rows = db
        .prepare(
          `SELECT id, token_id, account, text, reply_to, ts, is_dev, holder_pct FROM messages
           WHERE token_id = ? AND hidden = 0 AND id < ? ORDER BY id DESC LIMIT ?`,
        )
        .all(tokenId, before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as Message[];
      return rows.reverse();
    },
    lastMessageTs(tokenId: string, account: string): number {
      const r = db.prepare("SELECT MAX(ts) AS ts FROM messages WHERE token_id = ? AND account = ?").get(tokenId, account) as { ts: number | null };
      return r.ts ?? 0;
    },
    message: (id: number) => db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as (Message & { hidden: number }) | undefined,
    hideMessage: (id: number) => db.prepare("UPDATE messages SET hidden = 1 WHERE id = ?").run(id),
    messageCounts(since: number): { token_id: string; n: number }[] {
      return db
        .prepare("SELECT token_id, COUNT(*) AS n FROM messages WHERE ts > ? AND hidden = 0 GROUP BY token_id")
        .all(since) as unknown as { token_id: string; n: number }[];
    },

    // ---- callouts ----
    addCall(c: Omit<Call, "id">): Call {
      const r = db
        .prepare("INSERT INTO calls (token_id, account, thesis, ts, mcap_usd, peak_mcap_usd, last_mcap_usd, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(c.token_id, c.account, c.thesis, c.ts, c.mcap_usd, c.peak_mcap_usd, c.last_mcap_usd, c.updated);
      return { ...c, id: Number(r.lastInsertRowid) };
    },
    lastCallTs(tokenId: string, account: string): number {
      const r = db.prepare("SELECT MAX(ts) AS ts FROM calls WHERE token_id = ? AND account = ?").get(tokenId, account) as { ts: number | null };
      return r.ts ?? 0;
    },
    callsForToken: (tokenId: string, limit: number) =>
      db.prepare("SELECT * FROM calls WHERE token_id = ? ORDER BY id DESC LIMIT ?").all(tokenId, limit) as unknown as Call[],
    recentCalls: (limit: number) => db.prepare("SELECT * FROM calls ORDER BY id DESC LIMIT ?").all(limit) as unknown as Call[],
    trackedTokens(since: number): string[] {
      return (db.prepare("SELECT DISTINCT token_id FROM calls WHERE ts > ?").all(since) as { token_id: string }[]).map((r) => r.token_id);
    },
    updateCallMcaps(tokenId: string, mcapUsd: number, since: number) {
      db.prepare(
        `UPDATE calls SET last_mcap_usd = ?, peak_mcap_usd = MAX(peak_mcap_usd, ?), updated = ? WHERE token_id = ? AND ts > ?`,
      ).run(mcapUsd, mcapUsd, now(), tokenId, since);
    },
    leaderboard(since: number, limit: number) {
      return db
        .prepare(
          `SELECT account,
                  COUNT(*) AS calls,
                  AVG(peak_mcap_usd / mcap_usd) AS avg_peak_x,
                  MAX(peak_mcap_usd / mcap_usd) AS best_x,
                  SUM(CASE WHEN peak_mcap_usd >= 2 * mcap_usd THEN 1 ELSE 0 END) AS hits_2x
           FROM calls WHERE ts > ? AND mcap_usd > 0
           GROUP BY account HAVING calls >= 1
           ORDER BY avg_peak_x DESC LIMIT ?`,
        )
        .all(since, limit) as unknown as { account: string; calls: number; avg_peak_x: number; best_x: number; hits_2x: number }[];
    },
  };
}

export type Store = ReturnType<typeof openStore>;
