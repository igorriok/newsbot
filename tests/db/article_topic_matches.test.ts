import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import {
  upsertMatch,
  getUnnotifiedMatches,
  markNotified,
  suppressDailyLimitedMatches,
} from "../../src/db/article_topic_matches";

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
    const db: Database.Database = getDb();

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
    const db: Database.Database = getDb();

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
    const db: Database.Database = getDb();

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
    const db: Database.Database = getDb();

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
    const db: Database.Database = getDb();

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
    const db: Database.Database = getDb();

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

  void it("getUnnotifiedMatches withholds a second article for a topic already notified today", () => {
    const db: Database.Database = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (7001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed7')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-8', 'https://example.com/h', 'Title8', 'Summary8')",
    ).run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-9', 'https://example.com/i', 'Title9', 'Summary9')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic7')").run();

    upsertMatch(1, 1, true, 0.9, "");
    upsertMatch(2, 1, true, 0.8, "");

    markNotified(1, 1);

    const remaining: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(remaining.length, 0);
  });

  void it("suppressDailyLimitedMatches retires matches withheld by the daily limit", () => {
    const db: Database.Database = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (8001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed8')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-10', 'https://example.com/j', 'Title10', 'Summary10')",
    ).run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-11', 'https://example.com/k', 'Title11', 'Summary11')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic8')").run();

    upsertMatch(1, 1, true, 0.9, "");
    upsertMatch(2, 1, true, 0.8, "");

    markNotified(1, 1);

    assert.equal(suppressDailyLimitedMatches(), 1);

    const row: MatchRow | undefined = db
      .prepare<[], MatchRow>("SELECT * FROM article_topic_matches WHERE article_id = 2 AND topic_id = 1")
      .get();

    assert.notEqual(row, undefined);

    if (row) {
      assert.equal(row.notified, 1);
    }

    // The retired match must stay retired once the day rolls over, rather than
    // resurfacing as tomorrow's first notification for the topic.
    db.prepare("UPDATE article_topic_matches SET notified_at = datetime('now', '-1 day')").run();

    assert.equal(getUnnotifiedMatches().length, 0);
  });

  void it("suppressDailyLimitedMatches leaves topics that have not notified today alone", () => {
    const db: Database.Database = getDb();

    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (9001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed9')").run();
    db.prepare(
      "INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-12', 'https://example.com/l', 'Title12', 'Summary12')",
    ).run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic9a')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic9b')").run();

    upsertMatch(1, 1, true, 0.9, "");
    upsertMatch(1, 2, true, 0.8, "");

    markNotified(1, 1);
    db.prepare("UPDATE article_topic_matches SET notified_at = datetime('now', '-1 day') WHERE topic_id = 1").run();

    assert.equal(suppressDailyLimitedMatches(), 0);

    const remaining: ReturnType<typeof getUnnotifiedMatches> = getUnnotifiedMatches();

    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].topic_id, 2);
  });
});
