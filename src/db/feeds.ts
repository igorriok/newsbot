import { getDb } from "./connection";

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  last_fetched_at: string | null;
  etag: string | null;
  last_modified: string | null;
  healthy: number;
}

export function insertFeed(url: string): Feed {
  const db = getDb();
  const info = db.prepare("INSERT INTO feeds (url) VALUES (?)").run(url);
  return { id: info.lastInsertRowid as number, url, title: null, last_fetched_at: null, etag: null, last_modified: null, healthy: 1 };
}

export function getFeedByUrl(url: string): Feed | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM feeds WHERE url = ?").get(url) as Feed | undefined;
}

export function getFeedById(id: number): Feed | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Feed | undefined;
}

export function getAllFeeds(): Feed[] {
  const db = getDb();
  return db.prepare("SELECT * FROM feeds WHERE healthy = 1").all() as Feed[];
}

export function getAllDistinctFeedUrls(): { id: number; url: string }[] {
  const db = getDb();
  return db.prepare("SELECT DISTINCT f.id, f.url FROM feeds f INNER JOIN subscriptions s ON s.feed_id = f.id WHERE f.healthy = 1").all() as { id: number; url: string }[];
}

export function updateFeedMeta(id: number, meta: { title?: string; etag?: string | null; last_modified?: string | null; last_fetched_at?: string; healthy?: number }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (meta.title !== undefined) { sets.push("title = ?"); vals.push(meta.title); }
  if (meta.etag !== undefined) { sets.push("etag = ?"); vals.push(meta.etag); }
  if (meta.last_modified !== undefined) { sets.push("last_modified = ?"); vals.push(meta.last_modified); }
  if (meta.last_fetched_at !== undefined) { sets.push("last_fetched_at = ?"); vals.push(meta.last_fetched_at); }
  if (meta.healthy !== undefined) { sets.push("healthy = ?"); vals.push(meta.healthy); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE feeds SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}
