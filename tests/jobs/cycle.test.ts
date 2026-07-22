import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";

describe("pollCycle re-entrancy guard", () => {
  let cleanup: () => void;

  before(() => {
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

  after(() => { mock.reset(); });

  beforeEach(() => { cleanup = setupTestDb(); });
  afterEach(() => cleanup());

  it("prevents concurrent execution", async () => {
    let pollOnceResolve: () => void;
    const pollOncePromise = new Promise<void>((resolve) => { pollOnceResolve = resolve; });
    mock.module("../../src/rss/poller", {
      exports: {
        pollOnce: () => pollOncePromise,
      },
    });

    const { pollCycle, isCycleRunning } = await import("../../src/jobs/cycle");

    const first = pollCycle();
    assert.equal(isCycleRunning(), true);

    const secondPromise = pollCycle();

    pollOnceResolve!();
    await first;
    await secondPromise;

    assert.equal(isCycleRunning(), false);
  });
});
