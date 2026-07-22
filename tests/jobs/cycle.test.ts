import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";

void describe("pollCycle re-entrancy guard", () => {
  let cleanup: () => void;

  void before(() => {
    mock.module("../../src/db/articles", {
      exports: {
        getUncheckedArticles: () => [],
        getArticlesUncheckedForTopic: () => [],
      },
    });
    mock.module("../../src/notifications/dispatcher", {
      exports: {
        dispatchNotifications: () => Promise.resolve(),
      },
    });
  });

  void after(() => {
    mock.reset();
  });

  void beforeEach(() => {
    cleanup = setupTestDb();
  });
  void afterEach(() => cleanup());

  void it("prevents concurrent execution", async () => {
    let pollOnceResolve: () => void;
    const pollOncePromise: Promise<void> = new Promise<void>((resolve) => {
      pollOnceResolve = resolve;
    });

    mock.module("../../src/rss/poller", {
      exports: {
        pollOnce: () => pollOncePromise,
      },
    });

    const { pollCycle, isCycleRunning } = await import("../../src/jobs/cycle");

    const first: Promise<void> = pollCycle();

    assert.equal(isCycleRunning(), true);

    const secondPromise: Promise<void> = pollCycle();

    pollOnceResolve!();
    await first;
    await secondPromise;

    assert.equal(isCycleRunning(), false);
  });
});
