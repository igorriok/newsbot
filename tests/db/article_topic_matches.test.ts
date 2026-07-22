import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import { upsertMatch, getUnnotifiedMatches, markNotified } from "../../src/db/article_topic_matches";

interface MatchRow {
  article_id: number;
  topic_id: number;
  matched: number;
  score: number;
  notified: number;
  reasoning: string | null;
}

void describe("article_topic_matches", () => {
  let cleanup: () => void;

  void beforeEach(() => {
    cleanup = setupTestDb();
  });
  void afterEach(() => cleanup());

  void it("upsertMatch inserts a new match", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (1001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-1', 'https://example.com/a', 'Title', 'Summary')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic')").run();

    upsertMatch(1, 1, true, 0.9, "good match");

    const row: MatchRow | undefined = db
      .prepare<[], MatchRow>("SELECT * FROM article_topic_matches WHERE article_id = 1 AND topic_id = 1")
      .get();

    assert.notEqual(row, undefined);

    if (row) {
      assert.equal(row.matched, 1);
      assert.equal(row.score, 0.9);
      assert.equal(row.notified, 0);
    }
  });

  void it("upsertMatch updates on conflict", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (2001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed2')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-2', 'https://example.com/b', 'Title2', 'Summary2')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic2')").run();

    upsertMatch(1, 1, true, 0.9, "good match");
    upsertMatch(1, 1, false, 0.1, "actually no");

    const row: MatchRow | undefined = db
      .prepare<[], MatchRow>("SELECT * FROM article_topic_matches WHERE article_id = 1 AND topic_id = 1")
      .get();

    assert.notEqual(row, undefined);

    if (row) {
      assert.equal(row.matched, 0);
      assert.equal(row.score, 0.1);
      assert.equal(row.reasoning, "actually no");
    }
  });

  void it("getUnnotifiedMatches only returns matched=1 AND notified=0", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (3001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed3')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-3', 'https://example.com/c', 'Title3', 'Summary3')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic3')").run();

    upsertMatch(1, 1, true, 0.9, "good");

    const matches: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(matches.length, 1);
    assert.equal(matches[0].article_id, 1);
    assert.equal(matches[0].topic_id, 1);
  });

  void it("getUnnotifiedMatches excludes notified and unmatched", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (4001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed4')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-4', 'https://example.com/d', 'Title4', 'Summary4')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic4')").run();

    upsertMatch(1, 1, true, 0.9, "good");
    markNotified(1, 1);

    const matches: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(matches.length, 0);
  });

  void it("getUnnotifiedMatches returns oldest first", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (5001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed5')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-5', 'https://example.com/e', 'Title5', 'Summary5')",
    ).run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-6', 'https://example.com/f', 'Title6', 'Summary6')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic5')").run();

    upsertMatch(1, 1, true, 0.9, "first");
    upsertMatch(2, 1, true, 0.8, "second");

    const matches: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(matches.length, 2);
    assert.equal(matches[0].article_id, 1);
    assert.equal(matches[1].article_id, 2);
  });

  void it("markNotified only flips the specified pair", () => {
    const db: ReturnType<typeof getDb> = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (6001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed6')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-7', 'https://example.com/g', 'Title7', 'Summary7')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic6a')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic6b')").run();

    upsertMatch(1, 1, true, 0.9, "");
    upsertMatch(1, 2, true, 0.8, "");

    markNotified(1, 1);

    const remaining: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].topic_id, 2);
  });
});
