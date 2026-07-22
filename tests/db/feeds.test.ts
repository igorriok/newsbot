import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import {
  insertFeed,
  getFeedByUrl,
  getFeedById,
  updateFeedMeta,
  getAllDistinctFeedUrls,
  getAllFeeds,
  deleteFeed,
} from "../../src/db/feeds";

describe("feeds", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });
  afterEach(() => cleanup());

  it("insertFeed creates a feed and returns it", () => {
    const feed = insertFeed("https://example.com/rss");

    assert.equal(feed.url, "https://example.com/rss");
    assert.equal(feed.healthy, 1);
    assert.equal(feed.title, null);
  });

  it("getFeedByUrl finds by url", () => {
    insertFeed("https://example.com/rss");

    const feed = getFeedByUrl("https://example.com/rss");

    assert.notEqual(feed, undefined);
    assert.equal(feed!.url, "https://example.com/rss");
  });

  it("getFeedById finds by id", () => {
    const inserted = insertFeed("https://example.com/rss");
    const byId = getFeedById(inserted.id);

    assert.notEqual(byId, undefined);
    assert.equal(byId!.id, inserted.id);
  });

  it("updateFeedMeta partial updates (only touches provided fields)", () => {
    const feed = insertFeed("https://example.com/meta-test");

    updateFeedMeta(feed.id, { title: "My Feed", healthy: 0 });

    const updated = getFeedById(feed.id);

    assert.equal(updated!.title, "My Feed");
    assert.equal(updated!.healthy, 0);
    assert.equal(updated!.etag, null);
  });

  it("updateFeedMeta with etag and last_modified", () => {
    const feed = insertFeed("https://example.com/etag-test");

    updateFeedMeta(feed.id, { etag: '"abc123"', last_modified: "Mon, 01 Jan 2024 00:00:00 GMT" });

    const updated = getFeedById(feed.id);

    assert.equal(updated!.etag, '"abc123"');
    assert.equal(updated!.last_modified, "Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("getAllDistinctFeedUrls returns id and url", () => {
    insertFeed("https://example.com/feed-a");
    insertFeed("https://example.com/feed-b");

    const urls = getAllDistinctFeedUrls();

    assert.equal(urls.length, 2);
    assert.ok(urls.every((u) => typeof u.id === "number" && typeof u.url === "string"));
  });

  it("deleteFeed removes a feed", () => {
    const feed = insertFeed("https://example.com/to-delete");
    const ok = deleteFeed(feed.id);

    assert.equal(ok, true);
    assert.equal(getFeedById(feed.id), undefined);
  });

  it("getAllFeeds returns all feeds", () => {
    insertFeed("https://example.com/feed-x");
    insertFeed("https://example.com/feed-y");

    const feeds = getAllFeeds();

    assert.equal(feeds.length, 2);
  });
});
