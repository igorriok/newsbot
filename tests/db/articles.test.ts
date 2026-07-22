import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import {
  insertArticle,
  getUncheckedArticles,
  getArticlesUncheckedForTopic,
  getArticlesMissingImage,
} from "../../src/db/articles";
import { insertFeed } from "../../src/db/feeds";
import { upsertChat } from "../../src/db/chats";

describe("articles", () => {
  let cleanup: () => void;
  let feed1Id: number;
  let feed2Id: number;

  beforeEach(() => {
    cleanup = setupTestDb();
    feed1Id = insertFeed("https://example.com/feed1").id;
    feed2Id = insertFeed("https://example.com/feed2").id;
  });

  afterEach(() => cleanup());

  it("insertArticle inserts a new row and returns it", () => {
    const a = insertArticle(feed1Id, "guid-1", { url: "https://example.com/a", title: "Article A" });
    assert.notEqual(a, null);
    assert.equal(a!.feed_id, feed1Id);
    assert.equal(a!.guid, "guid-1");
    assert.equal(a!.url, "https://example.com/a");
    assert.equal(a!.title, "Article A");
    assert.equal(a!.image_url, null);
    assert.equal(a!.image_checked, 0);
  });

  it("inserting same (feed_id, guid) returns null", () => {
    const a = insertArticle(feed1Id, "guid-dup", { url: "https://example.com/dup", title: "Original" });
    assert.notEqual(a, null);

    const b = insertArticle(feed1Id, "guid-dup", { url: "https://example.com/dup2", title: "Duplicate" });
    assert.equal(b, null);
  });

  it("inserting same (feed_id, guid) backfills image_url", () => {
    const a = insertArticle(feed1Id, "guid-img", { url: "https://example.com/img" });
    assert.notEqual(a, null);
    assert.equal(a!.image_url, null);

    const b = insertArticle(feed1Id, "guid-img", { image_url: "https://example.com/img.jpg" });
    assert.equal(b, null);

    const row = getDb().prepare("SELECT * FROM articles WHERE feed_id = ? AND guid = ?").get(feed1Id, "guid-img") as any;
    assert.equal(row.image_url, "https://example.com/img.jpg");
  });

  it("inserting different (feed_id, guid) but same url returns null and does not create a second row", () => {
    const url = "https://example.com/same-story";
    const a = insertArticle(feed1Id, "guid-a1", { url, title: "First feed" });
    assert.notEqual(a, null);

    const b = insertArticle(feed2Id, "guid-b1", { url, title: "Second feed" });
    assert.equal(b, null);

    const rows = getDb().prepare("SELECT * FROM articles WHERE url = ?").all(url) as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, a!.id);
    assert.equal(rows[0].feed_id, feed1Id);
  });

  it("inserting same url backfills image onto original", () => {
    const url = "https://example.com/story-with-image";
    const a = insertArticle(feed1Id, "guid-c", { url, title: "No image yet" });
    assert.notEqual(a, null);
    assert.equal(a!.image_url, null);

    const b = insertArticle(feed2Id, "guid-d", { url, title: "Has image", image_url: "https://example.com/img.jpg" });
    assert.equal(b, null);

    const row = getDb().prepare("SELECT * FROM articles WHERE url = ?").get(url) as any;
    assert.equal(row.image_url, "https://example.com/img.jpg");
  });

  it("getUncheckedArticles returns articles without matches", () => {
    insertArticle(feed1Id, "guid-uc", { url: "https://example.com/uc", title: "Unchecked" });
    const unchecked = getUncheckedArticles();
    assert.ok(unchecked.length > 0);
    assert.ok(unchecked.some((a) => a.guid === "guid-uc"));
  });

  it("getArticlesUncheckedForTopic filters by topic", () => {
    const chatId = upsertChat(10001).id;
    const db = getDb();
    const a = insertArticle(feed1Id, "guid-fk", { url: "https://example.com/fk", title: "FK test" });
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (?, 'test')").run(chatId);
    db.prepare("INSERT INTO article_topic_matches (article_id, topic_id, matched) VALUES (?, 1, 1)").run(a!.id);

    const unchecked = getArticlesUncheckedForTopic(1);
    assert.equal(unchecked.find((x) => x.id === a!.id), undefined);
  });

  it("getArticlesMissingImage returns articles with null image_url and unchecked", () => {
    insertArticle(feed1Id, "guid-missing", { url: "https://example.com/missing", title: "Missing Image" });
    const missing = getArticlesMissingImage(10);
    assert.ok(missing.length > 0);
    assert.ok(missing.every((a) => a.image_url === null && a.image_checked === 0 && a.url !== null));
  });
});
