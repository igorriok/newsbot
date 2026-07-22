import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import {
  upsertMatch,
  getUnnotifiedMatches,
  markNotified,
} from "../../src/db/article_topic_matches";

describe("article_topic_matches", () => {
  let cleanup: () => void;

  beforeEach(() => { cleanup = setupTestDb(); });
  afterEach(() => cleanup());

  it("upsertMatch inserts a new match", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (1001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-1', 'https://example.com/a', 'Title', 'Summary')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic')").run();

    upsertMatch(1, 1, true, 0.9, "good match");

    const row = db.prepare("SELECT * FROM article_topic_matches WHERE article_id = 1 AND topic_id = 1").get() as any;
    assert.notEqual(row, undefined);
    assert.equal(row.matched, 1);
    assert.equal(row.score, 0.9);
    assert.equal(row.notified, 0);
  });

  it("upsertMatch updates on conflict", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (2001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed2')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-2', 'https://example.com/b', 'Title2', 'Summary2')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic2')").run();

    upsertMatch(1, 1, true, 0.9, "good match");
    upsertMatch(1, 1, false, 0.1, "actually no");

    const row = db.prepare("SELECT * FROM article_topic_matches WHERE article_id = 1 AND topic_id = 1").get() as any;
    assert.equal(row.matched, 0);
    assert.equal(row.score, 0.1);
    assert.equal(row.reasoning, "actually no");
  });

  it("getUnnotifiedMatches only returns matched=1 AND notified=0", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (3001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed3')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-3', 'https://example.com/c', 'Title3', 'Summary3')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic3')").run();

    upsertMatch(1, 1, true, 0.9, "good");

    const matches = getUnnotifiedMatches();
    assert.equal(matches.length, 1);
    assert.equal(matches[0].article_id, 1);
    assert.equal(matches[0].topic_id, 1);
  });

  it("getUnnotifiedMatches excludes notified and unmatched", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (4001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed4')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-4', 'https://example.com/d', 'Title4', 'Summary4')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic4')").run();

    upsertMatch(1, 1, true, 0.9, "good");
    markNotified(1, 1);

    const matches = getUnnotifiedMatches();
    assert.equal(matches.length, 0);
  });

  it("getUnnotifiedMatches returns oldest first", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (5001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed5')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-5', 'https://example.com/e', 'Title5', 'Summary5')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-6', 'https://example.com/f', 'Title6', 'Summary6')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic5')").run();

    upsertMatch(1, 1, true, 0.9, "first");
    upsertMatch(2, 1, true, 0.8, "second");

    const matches = getUnnotifiedMatches();
    assert.equal(matches.length, 2);
    assert.equal(matches[0].article_id, 1);
    assert.equal(matches[1].article_id, 2);
  });

  it("markNotified only flips the specified pair", () => {
    const db = getDb();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (6001)").run();
    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed6')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title, summary) VALUES (1, 'guid-7', 'https://example.com/g', 'Title7', 'Summary7')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic6a')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic6b')").run();

    upsertMatch(1, 1, true, 0.9, "");
    upsertMatch(1, 2, true, 0.8, "");

    markNotified(1, 1);

    const remaining = getUnnotifiedMatches();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].topic_id, 2);
  });
});
