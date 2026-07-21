import { getDb } from "./connection";

export function subscribe(userId: number, feedId: number): void {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO subscriptions (user_id, feed_id) VALUES (?, ?)").run(userId, feedId);
}

export function unsubscribe(userId: number, feedId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
}

export function getSubscriptionsForUser(userId: number): { feed_id: number; url: string; title: string | null }[] {
  const db = getDb();
  return db.prepare(`
    SELECT s.feed_id, f.url, f.title
    FROM subscriptions s
    JOIN feeds f ON f.id = s.feed_id
    WHERE s.user_id = ?
  `).all(userId) as any[];
}

export function getSubscribersForFeed(feedId: number): number[] {
  const db = getDb();
  return (db.prepare("SELECT user_id FROM subscriptions WHERE feed_id = ?").all(feedId) as any[]).map(r => r.user_id);
}

export function getAllSubscribersForFeeds(feedIds: number[]): Map<number, number[]> {
  const db = getDb();
  if (feedIds.length === 0) return new Map();
  const placeholders = feedIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT user_id, feed_id FROM subscriptions WHERE feed_id IN (${placeholders})`).all(...feedIds) as { user_id: number; feed_id: number }[];
  const map = new Map<number, number[]>();
  for (const row of rows) {
    if (!map.has(row.feed_id)) map.set(row.feed_id, []);
    map.get(row.feed_id)!.push(row.user_id);
  }
  return map;
}
