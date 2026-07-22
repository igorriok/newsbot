import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { runMigrations } from "../../src/db/schema";
import { getDb } from "../../src/db/connection";

type SqlRow = Record<string, boolean | number | string | null>;

void describe("schema", () => {
  let cleanup: () => void;

  void beforeEach(() => {
    cleanup = setupTestDb();
  });
  void afterEach(() => cleanup());

  void it("runMigrations is idempotent (safe to call twice)", () => {
    runMigrations();

    const db: ReturnType<typeof getDb> = getDb();
    const tables: SqlRow[] = db
      .prepare<[], SqlRow>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    const tableNames: string[] = tables.map((table) => String(table.name)).sort();

    assert.ok(tableNames.includes("articles"));
    assert.ok(tableNames.includes("article_topic_matches"));
    assert.ok(tableNames.includes("chats"));
    assert.ok(tableNames.includes("feeds"));
    assert.ok(tableNames.includes("topics"));
  });

  void it("url-dedup migration merges duplicate-URL rows", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("DROP INDEX IF EXISTS idx_articles_url").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed-a')").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed-b')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url) VALUES (1, 'guid-a', 'https://example.com/story')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url) VALUES (2, 'guid-b', 'https://example.com/story')").run();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (1)").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 't')").run();
    db.prepare("INSERT INTO article_topic_matches (article_id, topic_id) VALUES (2, 1)").run();

    runMigrations();

    const rows: SqlRow[] = db
      .prepare<[], SqlRow>("SELECT id, url, image_url FROM articles ORDER BY id")
      .all();

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 1);

    const dupMatch: SqlRow | undefined = db
      .prepare<[], SqlRow>("SELECT * FROM article_topic_matches WHERE article_id = 2")
      .get();

    assert.equal(dupMatch, undefined);
  });

  void it("url-dedup folds in image_url from duplicate", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("DROP INDEX IF EXISTS idx_articles_url").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed-c')").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed-d')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url) VALUES (1, 'guid-c', 'https://example.com/story2')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, image_url) VALUES (2, 'guid-d', 'https://example.com/story2', 'https://example.com/img.jpg')",
    ).run();

    runMigrations();

    const row: SqlRow = db
      .prepare<[], SqlRow>("SELECT * FROM articles WHERE id = 1")
      .get()!;

    assert.equal(row.image_url, "https://example.com/img.jpg");
  });

  void it("unique index rejects duplicate url after dedup", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("DROP INDEX IF EXISTS idx_articles_url").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed-e')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url) VALUES (1, 'guid-e', 'https://example.com/story3')").run();
    runMigrations();

    assert.throws(() => {
      db.prepare("INSERT INTO articles (feed_id, guid, url) VALUES (1, 'guid-f', 'https://example.com/story3')").run();
    }, /UNIQUE constraint/);
  });
});
