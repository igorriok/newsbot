import { describe, it, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { type ClassifyResult } from "../../src/classifier/client";

type MockResponseJson = string | number | boolean | null | MockResponseJson[] | MockResponseJsonObject;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface indirection is required to break the Record<> circular type alias reference below
interface MockResponseJsonObject extends Record<string, MockResponseJson> {}

interface LogCall {
  level: string;
  message: string;
}

const logCalls: LogCall[] = [];

interface MockResponse {
  status?: number;
  ok?: boolean;
  json?: MockResponseJson;
  text?: string;
  jsonThrows?: boolean;
  textThrows?: boolean;
}

function makeFetchMock(handler: (callIndex: number) => Promise<MockResponse>): ReturnType<typeof mock.fn> {
  let callIndex: number = 0;

  return mock.fn(() => {
    const idx: number = callIndex++;
    return handler(idx).then((response) => ({
      status: response.status ?? 200,
      ok: response.ok ?? (response.status ? response.status >= 200 && response.status < 300 : true),
      headers: { get: () => null },
      json: () =>
        response.jsonThrows ? Promise.reject(new Error("mock: json parse failed")) : Promise.resolve(response.json),
      text: () =>
        response.textThrows
          ? Promise.reject(new Error("mock: body read failed"))
          : Promise.resolve(response.text ?? ""),
    }));
  });
}

void describe("classifyArticle edge cases", () => {
  void before(async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL_ID = "gemma-4-e4b-it-qat";
    process.env.LLM_BASE_URL = "http://llm.test/api/v1";
    process.env.LLM_RETRY_DELAY_MS = "0";

    mock.module("../../src/utils/log", {
      exports: {
        log: (level: string, message: string) => {
          logCalls.push({ level, message });
        },
      },
    });

    await import("../../src/config");
  });

  void after(() => {
    mock.reset();
  });

  void beforeEach(() => {
    logCalls.length = 0;
  });

  void it("returns null on non-2xx with a plain-text (non-JSON) body and logs status + raw text", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 429, ok: false, text: "Rate limit exceeded. Try again later." }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(fetchMock.mock.callCount(), 1);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("429") && message.includes("Rate limit exceeded")),
      `expected error log with status+text, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null on non-2xx with JSON body lacking error.message and logs raw text fallback", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 500, ok: false, text: '{"detail":"Internal error"}' }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("500") && message.includes('"detail"')),
      `expected raw-text fallback log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null on non-2xx with an empty body without crashing", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 500, ok: false, text: "" }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("500")),
      `expected error log with status, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null when response.text() itself rejects (body read failure)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 500, ok: false, textThrows: true }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("500")),
      `expected error log with status, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null when choices is not an array (schema mismatch) without throwing", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: { message: { content: "x" } } } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("LLM API call failed")),
      `expected error log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null when a choice is missing the message field without throwing", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{}] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("LLM API call failed")),
      `expected error log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null when response.json() rejects on a 200 (malformed body) without throwing", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() => Promise.resolve({ jsonThrows: true }));

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(fetchMock.mock.callCount(), 1);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("LLM API call failed")),
      `expected error log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("returns null after one request when content is an empty string", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: { content: "" } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    // Empty-string content is treated like null/missing: same "no content" warn + null, no retry.
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(result, null);

    const warnMessages: string[] = logCalls.filter((call) => call.level === "warn").map((call) => call.message);

    assert.ok(
      warnMessages.some((message) => message.includes("no content")),
      `expected "no content" warn for empty-string content, got: ${JSON.stringify(warnMessages)}`,
    );
  });

  void it("tolerates and ignores reasoning_content in the message object", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({
        json: {
          choices: [
            {
              message: {
                reasoning_content: "this is private chain-of-thought",
                content: '{"matches":[{"topic_id":1,"relevant":true}]}',
              },
            },
          ],
        },
      }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 1);

    const allMessages: string = logCalls.map((call) => call.message).join("\n");

    assert.ok(!allMessages.includes("chain-of-thought"), "reasoning_content must never be logged");
  });

  void it("logs an info line without tokens when usage is absent", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: { content: '{"matches":[]}' } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.notEqual(result, null);
    assert.deepEqual(result, [{ topic_id: 1, relevant: false, score: 0, reason: "" }]);

    const infoMessages: string[] = logCalls.filter((call) => call.level === "info").map((call) => call.message);

    assert.ok(
      infoMessages.some((message) => message.includes("LLM response") && !message.includes("tokens:")),
      `expected info log without token fields, got: ${JSON.stringify(infoMessages)}`,
    );
  });

  void it("classifies normally when usage is present but non-conforming (token logging is best-effort)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({
        json: {
          choices: [{ message: { content: '{"matches":[{"topic_id":1,"relevant":true}]}' } }],
          usage: { prompt_tokens: 5, total_tokens: 9 },
        },
      }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 1);
    assert.equal(fetchMock.mock.callCount(), 1);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      !errorMessages.some((message) => message.includes("LLM API call failed")),
      `no error log expected for non-conforming usage, got: ${JSON.stringify(errorMessages)}`,
    );

    const infoMessages: string[] = logCalls.filter((call) => call.level === "info").map((call) => call.message);

    assert.ok(
      infoMessages.some((message) => message.includes("LLM response") && !message.includes("tokens:")),
      `expected info log without token fields, got: ${JSON.stringify(infoMessages)}`,
    );
  });

  void it("does not retry when the first call fails with non-2xx (exactly one request)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 401, ok: false, text: '{"error":{"message":"Invalid API key"}}' }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  void it("retries on 503 (model loading) and returns the result once the API recovers", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((callIndex) =>
      callIndex === 0
        ? Promise.resolve({ status: 503, ok: false, text: '{"error":{"message":"chat model unavailable"}}' })
        : Promise.resolve({ json: { choices: [{ message: { content: '{"matches":[{"topic_id":1,"relevant":true}]}' } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 1);
    assert.equal(fetchMock.mock.callCount(), 2);

    const warnMessages: string[] = logCalls.filter((call) => call.level === "warn").map((call) => call.message);

    assert.ok(
      warnMessages.some((message) => message.includes("503") && message.includes("retry 1/")),
      `expected a 503 retry warning, got: ${JSON.stringify(warnMessages)}`,
    );
  });

  void it("gives up after the 503 retry budget is exhausted (four requests, null result)", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ status: 503, ok: false, text: '{"error":{"message":"chat model unavailable"}}' }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(fetchMock.mock.callCount(), 4);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("503") && message.includes("chat model unavailable")),
      `expected final 503 error log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("passes an abort signal to fetch and returns null when the request times out", async () => {
    const fetchMock: ReturnType<typeof mock.fn> = mock.fn((_url: string, init?: RequestInit) => {
      assert.ok(init?.signal instanceof AbortSignal, "expected fetch to receive an AbortSignal");

      const err: Error = new Error("The operation was aborted due to timeout");

      err.name = "TimeoutError";
      return Promise.reject(err);
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(fetchMock.mock.callCount(), 1);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(
      errorMessages.some((message) => message.includes("LLM API call failed") && message.includes("timeout")),
      `expected timeout error log, got: ${JSON.stringify(errorMessages)}`,
    );
  });

  void it("fills in topics omitted by the model as not relevant so every topic gets a row", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({
        json: { choices: [{ message: { content: '{"matches":[{"topic_id":2,"relevant":true,"score":0.9,"reason":"yes"}]}' } }] },
      }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [
      { id: 1, phrase: "AI" },
      { id: 2, phrase: "football" },
      { id: 3, phrase: "weather" },
    ]);

    assert.notEqual(result, null);
    assert.deepEqual(
      result!.map((match) => [match.topic_id, match.relevant, match.score]).sort((left, right) => left[0] - right[0]),
      [
        [1, false, 0],
        [2, true, 0.9],
        [3, false, 0],
      ],
    );
  });

  void it("returns a not-relevant entry per topic when the model answers with an empty matches list", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: { content: '{"matches":[]}' } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [
      { id: 1, phrase: "AI" },
      { id: 2, phrase: "football" },
    ]);

    assert.notEqual(result, null);
    assert.equal(result!.length, 2);
    assert.ok(result!.every((match) => !match.relevant && match.score === 0));
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
