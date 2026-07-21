import { getDb } from "./connection";

export function runMigrations(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_chat_id BIGINT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      last_fetched_at TEXT,
      etag TEXT,
      last_modified TEXT,
      healthy INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      phrase TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      url TEXT,
      title TEXT,
      summary TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_feed_guid ON articles(feed_id, guid);

    CREATE TABLE IF NOT EXISTS article_topic_matches (
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      matched INTEGER NOT NULL DEFAULT 0,
      score REAL,
      reasoning TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      notified INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (article_id, topic_id)
    );
  `);

  const columns = db.prepare("PRAGMA table_info(articles)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "image_url")) {
    db.exec("ALTER TABLE articles ADD COLUMN image_url TEXT");
  }
  if (!columns.some((c) => c.name === "image_checked")) {
    db.exec("ALTER TABLE articles ADD COLUMN image_checked INTEGER NOT NULL DEFAULT 0");
  }
}
