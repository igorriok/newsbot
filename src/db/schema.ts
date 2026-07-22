import type Database from "better-sqlite3";
import { getDb } from "./connection";

interface TableColumn {
  name: string;
}

interface DuplicateUrlRow {
  url: string;
}

interface DuplicateArticleRow {
  id: number;
  image_url: string | null;
}

export function runMigrations(): void {
  const db: Database.Database = getDb();

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

  const columns: TableColumn[] = db.prepare<[], TableColumn>("PRAGMA table_info(articles)").all();

  if (!columns.some((column) => column.name === "image_url")) {
    db.exec("ALTER TABLE articles ADD COLUMN image_url TEXT");
  }

  if (!columns.some((column) => column.name === "image_checked")) {
    db.exec("ALTER TABLE articles ADD COLUMN image_checked INTEGER NOT NULL DEFAULT 0");
  }

  dedupeArticlesByUrl(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url) WHERE url IS NOT NULL");
}

// The same story is sometimes syndicated across multiple RSS feeds from the same
// site (e.g. a site's default feed and its /ru/ locale feed), producing separate
// article rows with identical urls that each get classified and notified
// independently. Merge those down to one row per url, keeping the earliest
// article and folding in any image_url the duplicates had found, before a unique
// index on url makes that collision impossible going forward.
function dedupeArticlesByUrl(db: Database.Database): void {
  const dupUrls: DuplicateUrlRow[] = db
    .prepare<[], DuplicateUrlRow>("SELECT url FROM articles WHERE url IS NOT NULL GROUP BY url HAVING COUNT(*) > 1")
    .all();

  if (dupUrls.length === 0) return;

  const getRows: Database.Statement<[string], DuplicateArticleRow> = db.prepare<[string], DuplicateArticleRow>(
    "SELECT id, image_url FROM articles WHERE url = ? ORDER BY id ASC",
  );
  const updateImage: Database.Statement<[string, number]> = db.prepare(
    "UPDATE articles SET image_url = ? WHERE id = ?",
  );
  const deleteRow: Database.Statement<[number]> = db.prepare("DELETE FROM articles WHERE id = ?");

  const mergeDuplicates: (urls: string[]) => void = db.transaction((urls: string[]) => {
    for (const url of urls) {
      const rows: DuplicateArticleRow[] = getRows.all(url);
      const [keep, ...rest] = rows;
      const image: string | null | undefined = keep.image_url ?? rest.find((row) => row.image_url)?.image_url;

      if (image && !keep.image_url) updateImage.run(image, keep.id);

      for (const row of rest) deleteRow.run(row.id);
    }
  });

  mergeDuplicates(dupUrls.map((dup) => dup.url));
}
