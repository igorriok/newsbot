import type Database from "better-sqlite3";
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

export interface FeedUrlRef {
  id: number;
  url: string;
}

export function insertFeed(url: string): Feed {
  const db: Database.Database = getDb();
  const info: Database.RunResult = db.prepare("INSERT INTO feeds (url) VALUES (?)").run(url);

  return {
    id: Number(info.lastInsertRowid),
    url,
    title: null,
    last_fetched_at: null,
    etag: null,
    last_modified: null,
    healthy: 1,
  };
}

export function getFeedByUrl(url: string): Feed | undefined {
  const db: Database.Database = getDb();
  return db.prepare<[string], Feed>("SELECT * FROM feeds WHERE url = ?").get(url);
}

export function getFeedById(id: number): Feed | undefined {
  const db: Database.Database = getDb();
  return db.prepare<[number], Feed>("SELECT * FROM feeds WHERE id = ?").get(id);
}

export function getAllFeeds(): Feed[] {
  const db: Database.Database = getDb();
  return db.prepare<[], Feed>("SELECT * FROM feeds").all();
}

export function getAllDistinctFeedUrls(): FeedUrlRef[] {
  const db: Database.Database = getDb();
  return db.prepare<[], FeedUrlRef>("SELECT id, url FROM feeds").all();
}

export function deleteFeed(id: number): boolean {
  const db: Database.Database = getDb();
  const info: Database.RunResult = db.prepare("DELETE FROM feeds WHERE id = ?").run(id);

  return info.changes > 0;
}

export function updateFeedMeta(
  id: number,
  meta: {
    title?: string;
    etag?: string | null;
    last_modified?: string | null;
    last_fetched_at?: string;
    healthy?: number;
  },
): void {
  const db: Database.Database = getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (meta.title !== undefined) {
    sets.push("title = ?");
    vals.push(meta.title);
  }

  if (meta.etag !== undefined) {
    sets.push("etag = ?");
    vals.push(meta.etag);
  }

  if (meta.last_modified !== undefined) {
    sets.push("last_modified = ?");
    vals.push(meta.last_modified);
  }

  if (meta.last_fetched_at !== undefined) {
    sets.push("last_fetched_at = ?");
    vals.push(meta.last_fetched_at);
  }

  if (meta.healthy !== undefined) {
    sets.push("healthy = ?");
    vals.push(meta.healthy);
  }

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE feeds SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}
