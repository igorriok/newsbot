import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";

describe("dispatchNotifications", () => {
  let cleanup: () => void;
  const sendMessage = mock.fn(() => Promise.resolve());
  const sendPhoto = mock.fn(() => Promise.resolve());

  before(() => {
    mock.module("../../src/bot", {
      exports: {
        bot: { api: { sendMessage, sendPhoto } },
      },
    });
  });

  after(() => {
    mock.reset();
  });

  beforeEach(() => {
    cleanup = setupTestDb();

    const db = getDb();

    db.prepare("INSERT INTO chats (id, telegram_chat_id) VALUES (1, 10001)").run();
    db.prepare("INSERT INTO chats (id, telegram_chat_id) VALUES (2, 10002)").run();
    db.prepare("INSERT INTO feeds (id, url) VALUES (1, 'https://example.com/feed')").run();
    db.prepare(
      "INSERT INTO articles (id, feed_id, guid, url, title, summary) VALUES (1, 1, 'g1', 'https://ex.com/a', 'Title A', 'Sum A')",
    ).run();
    db.prepare(
      "INSERT INTO articles (id, feed_id, guid, url, title, summary) VALUES (2, 1, 'g2', 'https://ex.com/b', 'Title B', 'Sum B')",
    ).run();
    db.prepare(
      "INSERT INTO articles (id, feed_id, guid, url, title, summary) VALUES (3, 1, 'g3', 'https://ex.com/c', 'Title C', 'Sum C')",
    ).run();
    db.prepare(
      "INSERT INTO articles (id, feed_id, guid, url, title, summary, image_url) VALUES (4, 1, 'g4', 'https://ex.com/d', 'Title D', 'Sum D', 'https://ex.com/img.jpg')",
    ).run();
    db.prepare("INSERT INTO topics (id, chat_id, phrase) VALUES (1, 1, 'ai')").run();
    db.prepare("INSERT INTO topics (id, chat_id, phrase) VALUES (2, 2, 'ml')").run();
    db.prepare("INSERT INTO topics (id, chat_id, phrase) VALUES (3, 1, 'robots')").run();
    db.prepare("INSERT INTO topics (id, chat_id, phrase) VALUES (4, 2, 'test')").run();

    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO topics (id, chat_id, phrase) VALUES (5, 999, 'orphan')").run();
    db.pragma("foreign_keys = ON");

    sendMessage.mock.resetCalls();
    sendPhoto.mock.resetCalls();
    sendMessage.mock.mockImplementation(() => Promise.resolve());
    sendPhoto.mock.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => cleanup());

  it("sends at most one notification per chat per cycle", async () => {
    const { dispatchNotifications } = await import("../../src/notifications/dispatcher");

    const db = getDb();

    db.prepare(
      "INSERT INTO article_topic_matches (article_id, topic_id, matched, score, checked_at, notified) VALUES (1, 1, 1, 0.8, datetime('now'), 0)",
    ).run();
    db.prepare(
      "INSERT INTO article_topic_matches (article_id, topic_id, matched, score, checked_at, notified) VALUES (1, 3, 1, 0.7, datetime('now'), 0)",
    ).run();

    await dispatchNotifications();

    assert.equal(sendMessage.mock.callCount(), 1);

    const notified1 = db
      .prepare("SELECT notified FROM article_topic_matches WHERE article_id = 1 AND topic_id = 1")
      .get() as any;

    assert.equal(notified1.notified, 1);

    const notified3 = db
      .prepare("SELECT notified FROM article_topic_matches WHERE article_id = 1 AND topic_id = 3")
      .get() as any;

    assert.equal(notified3.notified, 0);
  });

  it("skips and marks notified when chat_id no longer resolves", async () => {
    const { dispatchNotifications } = await import("../../src/notifications/dispatcher");

    const db = getDb();

    db.prepare(
      "INSERT INTO article_topic_matches (article_id, topic_id, matched, score, checked_at, notified) VALUES (1, 5, 1, 0.8, datetime('now'), 0)",
    ).run();

    await dispatchNotifications();

    const row = db
      .prepare("SELECT notified FROM article_topic_matches WHERE article_id = 1 AND topic_id = 5")
      .get() as any;

    assert.equal(row.notified, 1);
  });

  it("sendPhoto failure falls back to sendMessage after retrying via upload", async () => {
    sendPhoto.mock.mockImplementation(() => Promise.reject(new Error("photo failed")));

    const { dispatchNotifications } = await import("../../src/notifications/dispatcher");

    const db = getDb();

    db.prepare(
      "INSERT INTO article_topic_matches (article_id, topic_id, matched, score, checked_at, notified) VALUES (4, 4, 1, 0.9, datetime('now'), 0)",
    ).run();

    await dispatchNotifications();

    assert.equal(sendPhoto.mock.callCount(), 2);
    assert.equal(sendMessage.mock.callCount(), 1);
  });

  it("retries sendPhoto via upload when the URL-based attempt fails, without falling back to text", async () => {
    let calls = 0;
    sendPhoto.mock.mockImplementation(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("wrong type of the web page content")) : Promise.resolve();
    });

    const { dispatchNotifications } = await import("../../src/notifications/dispatcher");

    const db = getDb();

    db.prepare(
      "INSERT INTO article_topic_matches (article_id, topic_id, matched, score, checked_at, notified) VALUES (4, 2, 1, 0.9, datetime('now'), 0)",
    ).run();

    await dispatchNotifications();

    assert.equal(sendPhoto.mock.callCount(), 2);
    assert.equal(sendMessage.mock.callCount(), 0);
  });
});
