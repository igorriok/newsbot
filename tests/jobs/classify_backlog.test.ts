import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";

void describe("classifyBacklogForNewTopic", () => {
  let cleanup: () => void;
  const dispatchNotifications: ReturnType<typeof mock.fn> = mock.fn(() => Promise.resolve());

  void before(() => {
    mock.module("../../src/notifications/dispatcher", {
      exports: { dispatchNotifications },
    });
  });

  void after(() => {
    mock.reset();
  });

  void beforeEach(() => {
    cleanup = setupTestDb();

    const db: Database.Database = getDb();

    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed')").run();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (10001)").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'test topic')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title) VALUES (1, 'guid-a', 'https://ex.com/a', 'A')").run();
    db.prepare("INSERT INTO articles (feed_id, guid, url, title) VALUES (1, 'guid-b', 'https://ex.com/b', 'B')").run();
    dispatchNotifications.mock.resetCalls();
  });

  void afterEach(() => cleanup());

  void it("only classifies articles unchecked for that specific topic", async () => {
    const db: Database.Database = getDb();

    db.prepare("INSERT INTO article_topic_matches (article_id, topic_id, matched) VALUES (1, 1, 1)").run();

    const classified: number[] = [];

    mock.module("../../src/classifier/client", {
      exports: {
        classifyArticle: (articleId: number) => {
          classified.push(articleId);
          return Promise.resolve([{ topic_id: 1, relevant: true, score: 0.9, reason: "" }]);
        },
      },
    });

    const { classifyBacklogForNewTopic } = await import("../../src/jobs/cycle");

    await classifyBacklogForNewTopic({ id: 1, chat_id: 1, phrase: "test topic", created_at: "" });

    assert.deepEqual(classified, [2]);
    assert.equal(dispatchNotifications.mock.callCount(), 1);
  });
});
