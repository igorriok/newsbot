import type Database from "better-sqlite3";
import { getDb } from "./connection";
import { log } from "../utils/log";

export interface Article {
  id: number;
  feed_id: number;
  guid: string;
  url: string | null;
  title: string | null;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  image_url: string | null;
  image_checked: number;
}

export interface NewArticleData {
  url?: string;
  title?: string;
  summary?: string;
  published_at?: string;
  image_url?: string;
}

export function insertArticle(feedId: number, guid: string, data: NewArticleData): Article | null {
  const db: ReturnType<typeof getDb> = getDb();

  if (data.url) {
    const existing: Article | undefined = db
      .prepare<[string], Article>("SELECT * FROM articles WHERE url = ?")
      .get(data.url);

    if (existing) {
      if (data.image_url && !existing.image_url) {
        db.prepare("UPDATE articles SET image_url = ? WHERE id = ? AND image_url IS NULL").run(
          data.image_url,
          existing.id,
        );
        log(
          "debug",
          `Backfilled image_url for existing article ${existing.id} via url match (feed ${feedId}, guid ${guid})`,
        );
      }

      log("debug", `Skipping duplicate article (url already seen as article ${existing.id}): ${data.url}`);
      return null;
    }
  }

  try {
    const info: Database.RunResult = db
      .prepare(
        "INSERT INTO articles (feed_id, guid, url, title, summary, published_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        feedId,
        guid,
        data.url ?? null,
        data.title ?? null,
        data.summary ?? null,
        data.published_at ?? null,
        data.image_url ?? null,
      );
    return {
      id: Number(info.lastInsertRowid),
      feed_id: feedId,
      guid,
      url: data.url ?? null,
      title: data.title ?? null,
      summary: data.summary ?? null,
      published_at: data.published_at ?? null,
      fetched_at: new Date().toISOString(),
      image_url: data.image_url ?? null,
      image_checked: 0,
    };
  } catch {
    if (data.image_url) {
      const result: Database.RunResult = db
        .prepare("UPDATE articles SET image_url = ? WHERE feed_id = ? AND guid = ? AND image_url IS NULL")
        .run(data.image_url, feedId, guid);

      if (result.changes > 0) {
        log("debug", `Backfilled image_url for existing article (feed ${feedId}, guid ${guid})`);
      }
    }

    return null;
  }
}

export function updateArticleImage(id: number, imageUrl: string): void {
  const db: ReturnType<typeof getDb> = getDb();

  db.prepare("UPDATE articles SET image_url = ? WHERE id = ? AND image_url IS NULL").run(imageUrl, id);
}

export function markImageChecked(id: number): void {
  const db: ReturnType<typeof getDb> = getDb();

  db.prepare("UPDATE articles SET image_checked = 1 WHERE id = ?").run(id);
}

export function getArticlesMissingImage(limit: number): Article[] {
  const db: ReturnType<typeof getDb> = getDb();
  return db
    .prepare<[number], Article>(
      `
    SELECT * FROM articles
    WHERE image_url IS NULL AND image_checked = 0 AND url IS NOT NULL
    ORDER BY id ASC
    LIMIT ?
  `,
    )
    .all(limit);
}

export function getArticleByGuid(feedId: number, guid: string): Article | undefined {
  const db: ReturnType<typeof getDb> = getDb();
  return db
    .prepare<[number, string], Article>("SELECT * FROM articles WHERE feed_id = ? AND guid = ?")
    .get(feedId, guid);
}

export function getUncheckedArticles(): Article[] {
  const db: ReturnType<typeof getDb> = getDb();
  return db
    .prepare<[], Article>(
      `
    SELECT a.* FROM articles a
    WHERE a.id NOT IN (SELECT DISTINCT article_id FROM article_topic_matches)
  `,
    )
    .all();
}

export function getArticlesUncheckedForTopic(topicId: number): Article[] {
  const db: ReturnType<typeof getDb> = getDb();
  return db
    .prepare<[number], Article>(
      `
    SELECT a.* FROM articles a
    WHERE NOT EXISTS (
      SELECT 1 FROM article_topic_matches m WHERE m.article_id = a.id AND m.topic_id = ?
    )
  `,
    )
    .all(topicId);
}
