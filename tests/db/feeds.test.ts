import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import {
  type Feed,
  type FeedUrlRef,
  insertFeed,
  getFeedByUrl,
  getFeedById,
  updateFeedMeta,
  getAllDistinctFeedUrls,
  getAllFeeds,
  deleteFeed,
} from "../../src/db/feeds";

void describe("feeds", () => {
  let cleanup: () => void;

  void beforeEach(() => {
    cleanup = setupTestDb();
  });
  void afterEach(() => cleanup());

  void it("insertFeed creates a feed and returns it", () => {
    const feed: Feed = insertFeed("https://example.com/rss");

    assert.equal(feed.url, "https://example.com/rss");
    assert.equal(feed.healthy, 1);
    assert.equal(feed.title, null);
  });

  void it("getFeedByUrl finds by url", () => {
    insertFeed("https://example.com/rss");

    const feed: Feed | undefined = getFeedByUrl("https://example.com/rss");

    assert.notEqual(feed, undefined);
    assert.equal(feed!.url, "https://example.com/rss");
  });

  void it("getFeedById finds by id", () => {
    const inserted: Feed = insertFeed("https://example.com/rss");
    const byId: Feed | undefined = getFeedById(inserted.id);

    assert.notEqual(byId, undefined);
    assert.equal(byId!.id, inserted.id);
  });

  void it("updateFeedMeta partial updates (only touches provided fields)", () => {
    const feed: Feed = insertFeed("https://example.com/meta-test");

    updateFeedMeta(feed.id, { title: "My Feed", healthy: 0 });

    const updated: Feed | undefined = getFeedById(feed.id);

    assert.equal(updated!.title, "My Feed");
    assert.equal(updated!.healthy, 0);
    assert.equal(updated!.etag, null);
  });

  void it("updateFeedMeta with etag and last_modified", () => {
    const feed: Feed = insertFeed("https://example.com/etag-test");

    updateFeedMeta(feed.id, { etag: '"abc123"', last_modified: "Mon, 01 Jan 2024 00:00:00 GMT" });

    const updated: Feed | undefined = getFeedById(feed.id);

    assert.equal(updated!.etag, '"abc123"');
    assert.equal(updated!.last_modified, "Mon, 01 Jan 2024 00:00:00 GMT");
  });

  void it("getAllDistinctFeedUrls returns id and url", () => {
    insertFeed("https://example.com/feed-a");
    insertFeed("https://example.com/feed-b");

    const urls: FeedUrlRef[] = getAllDistinctFeedUrls();

    assert.equal(urls.length, 2);
    assert.ok(urls.every((feed) => typeof feed.id === "number" && typeof feed.url === "string"));
  });

  void it("deleteFeed removes a feed", () => {
    const feed: Feed = insertFeed("https://example.com/to-delete");
    const deleted: boolean = deleteFeed(feed.id);

    assert.equal(deleted, true);
    assert.equal(getFeedById(feed.id), undefined);
  });

  void it("getAllFeeds returns all feeds", () => {
    insertFeed("https://example.com/feed-x");
    insertFeed("https://example.com/feed-y");

    const feeds: Feed[] = getAllFeeds();

    assert.equal(feeds.length, 2);
  });
});
