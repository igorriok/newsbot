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

export function upsertMatch(articleId: number, topicId: number, matched: boolean, score: number | null, reasoning: string | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO article_topic_matches (article_id, topic_id, matched, score, reasoning, checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id, topic_id) DO UPDATE SET
      matched = excluded.matched,
      score = excluded.score,
      reasoning = excluded.reasoning,
      checked_at = excluded.checked_at
  `).run(articleId, topicId, matched ? 1 : 0, score, reasoning);
}

export function getUnnotifiedMatches(): { article_id: number; topic_id: number; chat_id: number; title: string; url: string; summary: string; image_url: string | null; score: number | null; reasoning: string | null }[] {
  const db = getDb();
  return db.prepare(`
    SELECT m.article_id, m.topic_id, t.chat_id, a.title, a.url, a.summary, a.image_url, m.score, m.reasoning
    FROM article_topic_matches m
    JOIN articles a ON a.id = m.article_id
    JOIN topics t ON t.id = m.topic_id
    WHERE m.matched = 1 AND m.notified = 0
    ORDER BY m.checked_at ASC, m.article_id ASC, m.topic_id ASC
  `).all() as any[];
}

export function markNotified(articleId: number, topicId: number): void {
  const db = getDb();
  db.prepare("UPDATE article_topic_matches SET notified = 1 WHERE article_id = ? AND topic_id = ?").run(articleId, topicId);
}
