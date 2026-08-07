import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { setupTestDb } from "../helpers/db";
import { getDb } from "../../src/db/connection";
import { deleteTopic, insertTopic } from "../../src/db/topics";

interface MockMatch {
  topic_id: number;
  relevant: boolean;
  score: number;
  reason: string;
}

interface TopicInfo {
  id: number;
  phrase: string;
}

interface ClassifyCall {
  articleId: number;
  topicIds: number[];
}

interface LogCall {
  level: string;
  message: string;
}

interface CountRow {
  count: number;
}

type ClassifyFn = (articleId: number, topics: TopicInfo[]) => Promise<MockMatch[]>;

void describe("topic lifecycle in the classification cycle", () => {
  let cleanup: () => void;
  let classifyFn: ClassifyFn;
  let calls: ClassifyCall[];
  let cycleModule: typeof import("../../src/jobs/cycle");
  const logCalls: LogCall[] = [];

  void before(async () => {
    mock.module("../../src/notifications/dispatcher", {
      exports: { dispatchNotifications: () => Promise.resolve() },
    });

    mock.module("../../src/classifier/client", {
      exports: {
        classifyArticle: (articleId: number, _title: string, _summary: string | null, topics: TopicInfo[]) => {
          calls.push({ articleId, topicIds: topics.map((topic) => topic.id) });
          return classifyFn(articleId, topics);
        },
      },
    });

    mock.module("../../src/utils/log", {
      exports: {
        log: (level: string, message: string) => {
          logCalls.push({ level, message });
        },
      },
    });

    cycleModule = await import("../../src/jobs/cycle");
  });

  void after(() => {
    mock.reset();
  });

  void beforeEach(() => {
    cleanup = setupTestDb();
    calls = [];
    logCalls.length = 0;
    classifyFn = (_articleId: number, topics: TopicInfo[]): Promise<MockMatch[]> =>
      Promise.resolve(topics.map((topic) => ({ topic_id: topic.id, relevant: false, score: 0.1, reason: "" })));
  });

  void afterEach(() => cleanup());

  function seed(articleCount: number): Database.Database {
    const db: Database.Database = getDb();

    db.prepare("INSERT INTO feeds (url) VALUES ('https://example.com/feed')").run();
    db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (10001)").run();

    for (let index: number = 1; index <= articleCount; index += 1) {
      db.prepare("INSERT INTO articles (feed_id, guid, url, title) VALUES (1, ?, ?, ?)").run(
        `guid-${index}`,
        `https://example.com/a${index}`,
        `Article ${index}`,
      );
    }

    return db;
  }

  function addArticle(guid: string): void {
    getDb()
      .prepare("INSERT INTO articles (feed_id, guid, url, title) VALUES (1, ?, ?, ?)")
      .run(guid, `https://example.com/${guid}`, guid);
  }

  void it("does not classify pre-existing articles against a newly added topic", async () => {
    const db: Database.Database = seed(3);
    const first: ReturnType<typeof insertTopic> = insertTopic(1, "first topic");

    await cycleModule.runClassificationCycle();

    assert.equal(calls.length, 3);
    calls.length = 0;

    // A topic added now must not trigger a sweep of the three existing articles.
    const second: ReturnType<typeof insertTopic> = insertTopic(1, "second topic");

    await cycleModule.runClassificationCycle();

    // Not deepEqual against []: node's assert types narrow `calls` to never[].
    assert.equal(calls.length, 0);

    const backfilled: CountRow | undefined = db
      .prepare<[number], CountRow>("SELECT COUNT(*) AS count FROM article_topic_matches WHERE topic_id = ?")
      .get(second.id);

    assert.equal(backfilled?.count, 0);

    // From this moment on, newly fetched articles are matched against both topics.
    addArticle("guid-4");

    await cycleModule.runClassificationCycle();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].articleId, 4);
    assert.deepEqual(calls[0].topicIds.slice().sort(), [first.id, second.id].sort());
  });

  void it("skips matches for a topic deleted mid-cycle without FK errors or exceptions", async () => {
    const db: Database.Database = seed(3);

    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic-a')").run();
    db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (1, 'topic-b')").run();

    classifyFn = (): Promise<MockMatch[]> => {
      if (calls.length === 1) {
        deleteTopic(2, 1);
      }

      return Promise.resolve([
        { topic_id: 1, relevant: true, score: 0.9, reason: "a" },
        { topic_id: 2, relevant: true, score: 0.9, reason: "b" },
      ]);
    };

    await cycleModule.runClassificationCycle();

    const topic1Matches: CountRow | undefined = db
      .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM article_topic_matches WHERE topic_id = 1")
      .get();
    const topic2Matches: CountRow | undefined = db
      .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM article_topic_matches WHERE topic_id = 2")
      .get();
    const errorLines: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.equal(calls.length, 3);
    assert.equal(topic1Matches?.count, 3);
    assert.equal(topic2Matches?.count, 0);
    assert.equal(errorLines.length, 0);
  });
});
