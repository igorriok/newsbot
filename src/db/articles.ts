import { getDb } from "./connection";

export interface Article {
  id: number;
  feed_id: number;
  guid: string;
  url: string | null;
  title: string | null;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
}

export function insertArticle(feedId: number, guid: string, data: { url?: string; title?: string; summary?: string; published_at?: string }): Article | null {
  const db = getDb();
  try {
    const info = db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary, published_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(feedId, guid, data.url ?? null, data.title ?? null, data.summary ?? null, data.published_at ?? null);
    return {
      id: info.lastInsertRowid as number,
      feed_id: feedId,
      guid,
      url: data.url ?? null,
      title: data.title ?? null,
      summary: data.summary ?? null,
      published_at: data.published_at ?? null,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function getArticleByGuid(feedId: number, guid: string): Article | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM articles WHERE feed_id = ? AND guid = ?").get(feedId, guid) as Article | undefined;
}

export function getUncheckedArticles(): Article[] {
  const db = getDb();
  return db.prepare(`
    SELECT a.* FROM articles a
    WHERE a.id NOT IN (SELECT DISTINCT article_id FROM article_topic_matches)
  `).all() as Article[];
}
