import { describe, it, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { insertFeed, getFeedById, getAllDistinctFeedUrls } from "../../src/db/feeds";
import { getDb } from "../../src/db/connection";

function rssXml(items: { guid: string; link: string; title: string }[]): string {
  const itemXml = items
    .map(
      (i) => `
    <item>
      <guid>${i.guid}</guid>
      <link>${i.link}</link>
      <title>${i.title}</title>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>${itemXml}</channel></rss>`;
}

describe("pollOnce", () => {
  let cleanup: () => void;
  let fetchMock: any;

  beforeEach(() => {
    cleanup = setupTestDb();
  });
  afterEach(() => cleanup());
  after(() => {
    mock.reset();
  });

  it("a 304 response leaves etag/last_modified untouched and inserts nothing", async () => {
    const feed = insertFeed("https://example.com/feed-304");

    getDb().prepare("UPDATE feeds SET etag = 'old-etag', last_modified = 'old-lm' WHERE id = ?").run(feed.id);

    const fetchCalled = false;

    fetchMock = mock.fn(() =>
      Promise.resolve({
        status: 304,
        headers: { get: () => null },
        text: () => {
          throw new Error("should not be called");
        },
      }),
    );
    mock.method(global, "fetch", fetchMock);

    const { pollOnce } = await import("../../src/rss/poller");

    await pollOnce();

    const updated = getFeedById(feed.id);

    assert.equal(updated!.etag, "old-etag");
    assert.equal(updated!.last_modified, "old-lm");

    const articles = getDb().prepare("SELECT * FROM articles WHERE feed_id = ?").all(feed.id) as any[];

    assert.equal(articles.length, 0);
  });

  it("a 200 response inserts new articles and marks feed healthy", async () => {
    const feed = insertFeed("https://example.com/feed-200");

    getDb().prepare("UPDATE feeds SET healthy = 0 WHERE id = ?").run(feed.id);

    const xml = rssXml([
      { guid: "g1", link: "https://ex.com/a", title: "Article A" },
      { guid: "g2", link: "https://ex.com/b", title: "Article B" },
    ]);

    fetchMock = mock.fn(() =>
      Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => '"new-etag"' },
        text: () => Promise.resolve(xml),
      }),
    );
    mock.method(global, "fetch", fetchMock);

    const { pollOnce } = await import("../../src/rss/poller");

    await pollOnce();

    const updated = getFeedById(feed.id);

    assert.equal(updated!.healthy, 1);
    assert.equal(updated!.etag, '"new-etag"');

    const articles = getDb()
      .prepare("SELECT guid, title FROM articles WHERE feed_id = ? ORDER BY id")
      .all(feed.id) as any[];

    assert.equal(articles.length, 2);
    assert.equal(articles[0].guid, "g1");
    assert.equal(articles[1].guid, "g2");
  });

  it("a fetch failure marks the feed unhealthy and does not throw", async () => {
    const feed = insertFeed("https://example.com/feed-fail");

    fetchMock = mock.fn(() => Promise.reject(new Error("network error")));
    mock.method(global, "fetch", fetchMock);

    const { pollOnce } = await import("../../src/rss/poller");

    await pollOnce();

    const updated = getFeedById(feed.id);

    assert.equal(updated!.healthy, 0);

    const articles = getDb().prepare("SELECT * FROM articles WHERE feed_id = ?").all(feed.id) as any[];

    assert.equal(articles.length, 0);
  });
});
