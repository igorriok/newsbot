import { describe, it, after, mock } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config";
import { type ClassifyResult } from "../../src/classifier/client";

const BASE: string = config.OPENCODE_SERVER_URL;

type MockResponseJson =
  | string
  | number
  | boolean
  | null
  | MockResponseJson[]
  | Record<string, MockResponseJson>;

function makeFetchMock(
  handler: (
    url: string,
    callIndex: number,
  ) => Promise<{
    status?: number;
    ok?: boolean;
    json?: MockResponseJson;
    text?: string;
  }>,
): ReturnType<typeof mock.fn> {
  let callIndex: number = 0;

  return mock.fn((url: string) => {
    const idx: number = callIndex++;

    return handler(url, idx).then((response) => ({
      status: response.status ?? 200,
      ok: response.ok ?? (response.status ? response.status >= 200 && response.status < 300 : true),
      headers: { get: () => null },
      json: () => Promise.resolve(response.json),
      text: () => Promise.resolve(response.text ?? ""),
    }));
  });
}

void describe("classifyArticle", () => {
  void after(() => {
    mock.reset();
  });

  void it("returns matches on successful session create → message → parse", async () => {
    let deleteCalled: boolean = false;
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string) => {
      if (url === `${BASE}/session`) return Promise.resolve({ json: { id: "sess-1" } });
      if (url === `${BASE}/session/sess-1/message`)
        return Promise.resolve({
          json: {
            parts: [
              { type: "text", text: '{"matches":[{"topic_id":1,"relevant":true,"score":0.9,"reason":"good"}]}' },
            ],
          },
        });

      if (url.startsWith(`${BASE}/session/`)) {
        deleteCalled = true;
        return Promise.resolve({ json: {} });
      }

      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test Article", "Summary", [
      { id: 1, phrase: "AI" },
    ]);

    assert.notEqual(result, null);
    assert.equal(result!.length, 1);
    assert.equal(result![0].topic_id, 1);
    assert.equal(deleteCalled, true);
  });

  void it("returns null when session create fails (non-OK)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string) => {
      if (url === `${BASE}/session`) return Promise.resolve({ status: 500, ok: false, text: "Internal Server Error" });
      if (url.startsWith(`${BASE}/session/`)) return Promise.resolve({ json: {} });
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
  });

  void it("returns null when message send fails (non-OK)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string) => {
      if (url === `${BASE}/session`) return Promise.resolve({ json: { id: "sess-1" } });
      if (url === `${BASE}/session/sess-1/message`)
        return Promise.resolve({ status: 400, ok: false, text: "Bad Request" });
      if (url.startsWith(`${BASE}/session/`)) return Promise.resolve({ json: {} });
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
  });

  void it("retries once on parse failure", async () => {
    let messageCalls: number = 0;
    let sessionCalls: number = 0;
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string) => {
      if (url === `${BASE}/session`) {
        sessionCalls++;

        const id: string = `sess-${sessionCalls}`;
        return Promise.resolve({ json: { id } });
      }

      if (url.startsWith(`${BASE}/session/`) && url.endsWith("/message")) {
        messageCalls++;

        const text: string =
          messageCalls === 1 ? "not json" : '{"matches":[{"topic_id":1,"relevant":true}]}';
        return Promise.resolve({ json: { parts: [{ type: "text", text }] } });
      }

      if (url.startsWith(`${BASE}/session/`)) return Promise.resolve({ json: {} });
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 1);
    assert.equal(messageCalls, 2);
    assert.equal(sessionCalls, 2);
  });

  void it("session DELETE cleanup always fires on error paths", async () => {
    const deletes: string[] = [];
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string) => {
      if (url === `${BASE}/session`) return Promise.resolve({ json: { id: "sess-1" } });
      if (url === `${BASE}/session/sess-1/message`) return Promise.resolve({ status: 500, ok: false, text: "error" });

      if (url.startsWith(`${BASE}/session/`)) {
        deletes.push(url);
        return Promise.resolve({ json: {} });
      }

      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(deletes.length, 1);
  });

  void it("returns empty array when no topics provided", async () => {
    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, []);

    assert.deepEqual(result, []);
  });
});
