import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import {
  type Article,
  insertArticle,
  getUncheckedArticles,
  getArticlesUncheckedForTopic,
  getArticlesMissingImage,
} from "../../src/db/articles";
import { insertFeed } from "../../src/db/feeds";
import { upsertChat } from "../../src/db/chats";

type SqlRow = Record<string, boolean | number | string | null>;

void describe("articles", () => {
  let cleanup: () => void;
  let feed1Id: number;
  let feed2Id: number;

  void beforeEach(() => {
    cleanup = setupTestDb();
    feed1Id = insertFeed("https://example.com/feed1").id;
    feed2Id = insertFeed("https://example.com/feed2").id;
  });

  void afterEach(() => cleanup());

  void it("insertArticle inserts a new row and returns it", () => {
    const article: Article | null = insertArticle(feed1Id, "guid-1", {
      url: "https://example.com/a",
      title: "Article A",
    });

    assert.notEqual(article, null);
    assert.equal(article!.feed_id, feed1Id);
    assert.equal(article!.guid, "guid-1");
    assert.equal(article!.url, "https://example.com/a");
    assert.equal(article!.title, "Article A");
    assert.equal(article!.image_url, null);
    assert.equal(article!.image_checked, 0);
  });

  void it("inserting same (feed_id, guid) returns null", () => {
    const original: Article | null = insertArticle(feed1Id, "guid-dup", {
      url: "https://example.com/dup",
      title: "Original",
    });

    assert.notEqual(original, null);

    const duplicate: Article | null = insertArticle(feed1Id, "guid-dup", {
      url: "https://example.com/dup2",
      title: "Duplicate",
    });

    assert.equal(duplicate, null);
  });

  void it("inserting same (feed_id, guid) backfills image_url", () => {
    const original: Article | null = insertArticle(feed1Id, "guid-img", {
      url: "https://example.com/img",
    });

    assert.notEqual(original, null);
    assert.equal(original!.image_url, null);

    const duplicate: Article | null = insertArticle(feed1Id, "guid-img", {
      image_url: "https://example.com/img.jpg",
    });

    assert.equal(duplicate, null);

    const row: SqlRow = getDb()
      .prepare<[], SqlRow>("SELECT * FROM articles WHERE feed_id = ? AND guid = ?")
      .get(feed1Id, "guid-img")!;

    assert.equal(row.image_url, "https://example.com/img.jpg");
  });

  void it("inserting different (feed_id, guid) but same url returns null and does not create a second row", () => {
    const url: string = "https://example.com/same-story";
    const firstArticle: Article | null = insertArticle(feed1Id, "guid-a1", {
      url,
      title: "First feed",
    });

    assert.notEqual(firstArticle, null);

    const secondArticle: Article | null = insertArticle(feed2Id, "guid-b1", {
      url,
      title: "Second feed",
    });

    assert.equal(secondArticle, null);

    const rows: SqlRow[] = getDb()
      .prepare<[], SqlRow>("SELECT * FROM articles WHERE url = ?")
      .all(url);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstArticle!.id);
    assert.equal(rows[0].feed_id, feed1Id);
  });

  void it("inserting same url backfills image onto original", () => {
    const url: string = "https://example.com/story-with-image";
    const firstArticle: Article | null = insertArticle(feed1Id, "guid-c", {
      url,
      title: "No image yet",
    });

    assert.notEqual(firstArticle, null);
    assert.equal(firstArticle!.image_url, null);

    const secondArticle: Article | null = insertArticle(feed2Id, "guid-d", {
      url,
      title: "Has image",
      image_url: "https://example.com/img.jpg",
    });

    assert.equal(secondArticle, null);

    const row: SqlRow = getDb()
      .prepare<[], SqlRow>("SELECT * FROM articles WHERE url = ?")
      .get(url)!;

    assert.equal(row.image_url, "https://example.com/img.jpg");
  });

  void it("getUncheckedArticles returns articles without matches", () => {
    insertArticle(feed1Id, "guid-uc", {
      url: "https://example.com/uc",
      title: "Unchecked",
    });

    const unchecked: Article[] = getUncheckedArticles();

    assert.ok(unchecked.length > 0);
    assert.ok(unchecked.some((article) => article.guid === "guid-uc"));
  });

  void it("getArticlesUncheckedForTopic filters by topic", () => {
    const chatId: number = upsertChat(10001).id;
    const db: ReturnType<typeof getDb> = getDb();
    const article: Article | null = insertArticle(feed1Id, "guid-fk", {
      url: "https://example.com/fk",
      title: "FK test",
    });

    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (?, 'test')").run(chatId);
    db.prepare("INSERT INTO article_topic_matches (article_id, topic_id, matched) VALUES (?, 1, 1)").run(article!.id);

    const unchecked: Article[] = getArticlesUncheckedForTopic(1);

    assert.equal(unchecked.find((match) => match.id === article!.id), undefined);
  });

  void it("getArticlesMissingImage returns articles with null image_url and unchecked", () => {
    insertArticle(feed1Id, "guid-missing", {
      url: "https://example.com/missing",
      title: "Missing Image",
    });

    const missing: Article[] = getArticlesMissingImage(10);

    assert.ok(missing.length > 0);
    assert.ok(missing.every((article) => article.image_url === null && article.image_checked === 0 && article.url !== null));
  });
});
