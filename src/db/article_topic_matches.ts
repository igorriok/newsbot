import Database from "better-sqlite3";
import { getDb } from "./connection";

export interface ArticleTopicMatch {
  article_id: number;
  topic_id: number;
  matched: number;
  score: number | null;
  reasoning: string | null;
  checked_at: string;
  notified: number;
}

export function upsertMatch(
  articleId: number,
  topicId: number,
  matched: boolean,
  score: number | null,
  reasoning: string | null,
): void {
  const db: Database.Database = getDb();

  db.prepare(
    `
    INSERT INTO article_topic_matches (article_id, topic_id, matched, score, reasoning, checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id, topic_id) DO UPDATE SET
      matched = excluded.matched,
      score = excluded.score,
      reasoning = excluded.reasoning,
      checked_at = excluded.checked_at
  `,
  ).run(articleId, topicId, matched ? 1 : 0, score, reasoning);
}

export interface UnnotifiedMatch {
  article_id: number;
  topic_id: number;
  chat_id: number;
  title: string;
  url: string;
  summary: string;
  image_url: string | null;
  score: number | null;
  reasoning: string | null;
}

export function getUnnotifiedMatches(): UnnotifiedMatch[] {
  const db: Database.Database = getDb();
  return db
    .prepare<[], UnnotifiedMatch>(
      `
    SELECT m.article_id, m.topic_id, t.chat_id, a.title, a.url, a.summary, a.image_url, m.score, m.reasoning
    FROM article_topic_matches m
    JOIN articles a ON a.id = m.article_id
    JOIN topics t ON t.id = m.topic_id
    WHERE m.matched = 1 AND m.notified = 0
      AND NOT EXISTS (
        SELECT 1 FROM article_topic_matches m2
        WHERE m2.topic_id = m.topic_id
          AND m2.notified = 1
          AND date(m2.notified_at) = date('now')
      )
    ORDER BY m.checked_at ASC, m.article_id ASC, m.topic_id ASC
  `,
    )
    .all();
}

export function markNotified(articleId: number, topicId: number): void {
  const db: Database.Database = getDb();

  db.prepare(
    "UPDATE article_topic_matches SET notified = 1, notified_at = datetime('now') WHERE article_id = ? AND topic_id = ?",
  ).run(articleId, topicId);
}

// Marks every matching topic this chat has for the article as notified, not just the
// one that triggered the send — otherwise a sibling topic match for the same chat
// resurfaces as a duplicate notification on a later poll cycle.
export function markNotifiedForChat(articleId: number, chatId: number): void {
  const db: Database.Database = getDb();

  db.prepare(
    `
    UPDATE article_topic_matches
    SET notified = 1, notified_at = datetime('now')
    WHERE article_id = ?
      AND notified = 0
      AND topic_id IN (SELECT id FROM topics WHERE chat_id = ?)
  `,
  ).run(articleId, chatId);
}

// A match that is matched but held back by the one-notification-per-topic-per-day
// rule is retired, not queued: the news it carries is stale by tomorrow, so leaving
// it unnotified would mean a topic's first message of every day is yesterday's
// article. Marking it notified (without sending) drops it for good.
export function suppressDailyLimitedMatches(): number {
  const db: Database.Database = getDb();

  const result: Database.RunResult = db
    .prepare(
      `
    UPDATE article_topic_matches
    SET notified = 1, notified_at = datetime('now')
    WHERE matched = 1
      AND notified = 0
      AND EXISTS (
        SELECT 1 FROM article_topic_matches m2
        WHERE m2.topic_id = article_topic_matches.topic_id
          AND m2.notified = 1
          AND date(m2.notified_at) = date('now')
      )
  `,
    )
    .run();

  return result.changes;
}
