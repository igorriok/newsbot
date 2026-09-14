import { describe, it, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { type ClassifyResult } from "../../src/classifier/client";

type MockResponseJson = string | number | boolean | null | MockResponseJson[] | MockResponseJsonObject;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface indirection is required to break the Record<> circular type alias reference below
interface MockResponseJsonObject extends Record<string, MockResponseJson> {}

interface LlmConfigSnapshot {
  LLM_API_KEY: string;
  LLM_MODEL_ID: string;
  LLM_BASE_URL: string;
}

type ChatRequestBodySchemaType = z.ZodObject<{
  model: z.ZodString;
  messages: z.ZodArray<z.ZodObject<{ role: z.ZodString; content: z.ZodString }>>;
  stream: z.ZodBoolean;
  response_format: z.ZodObject<{ type: z.ZodString }>;
}>;

const ChatRequestBodySchema: ChatRequestBodySchemaType = z
  .object({
    model: z.string(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })),
    stream: z.boolean(),
    response_format: z.object({ type: z.string() }),
  })
  .passthrough();

type ChatRequestBody = z.infer<typeof ChatRequestBodySchema>;

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

interface LogCall {
  level: string;
  message: string;
}

let BASE: string = "";
let cfg: LlmConfigSnapshot;
const logCalls: LogCall[] = [];

function makeFetchMock(
  handler: (
    url: string,
    init: RequestInit | undefined,
    callIndex: number,
  ) => Promise<{
    status?: number;
    ok?: boolean;
    json?: MockResponseJson;
    text?: string;
  }>,
): ReturnType<typeof mock.fn> {
  let callIndex: number = 0;

  return mock.fn((url: string, init?: RequestInit) => {
    const idx: number = callIndex++;

    return handler(url, init, idx).then((response) => ({
      status: response.status ?? 200,
      ok: response.ok ?? (response.status ? response.status >= 200 && response.status < 300 : true),
      headers: { get: () => null },
      json: () => Promise.resolve(response.json),
      text: () => Promise.resolve(response.text ?? ""),
    }));
  });
}

function getHeaderValue(headers: RequestInit["headers"], name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (entry[0] === name) return entry[1];
    }

    return null;
  }

  if (headers) return headers[name] ?? null;
  return null;
}

function parseRequestBody(init: RequestInit | undefined): ChatRequestBody {
  if (init === undefined || typeof init.body !== "string") {
    throw new Error("expected string request body");
  }

  return ChatRequestBodySchema.parse(JSON.parse(init.body));
}

void describe("classifyArticle", () => {
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

    const { config } = await import("../../src/config");

    BASE = config.LLM_BASE_URL;
    cfg = {
      LLM_API_KEY: config.LLM_API_KEY,
      LLM_MODEL_ID: config.LLM_MODEL_ID,
      LLM_BASE_URL: config.LLM_BASE_URL,
    };
  });

  void after(() => {
    mock.reset();
  });

  void beforeEach(() => {
    logCalls.length = 0;
  });

  void it("returns matches on a successful classification with one POST to /chat/completions", async () => {
    const requests: CapturedRequest[] = [];
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string, init: RequestInit | undefined) => {
      requests.push({ url, init });

      return Promise.resolve({
        json: {
          choices: [
            { message: { content: '{"matches":[{"topic_id":1,"relevant":true,"score":0.9,"reason":"good"}]}' } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      });
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test Article", "Summary", [
      { id: 1, phrase: "AI" },
    ]);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BASE}/chat/completions`);
    assert.equal(requests[0].init?.method, "POST");
    assert.equal(getHeaderValue(requests[0].init?.headers, "Authorization"), `Bearer ${cfg.LLM_API_KEY}`);

    const parsedBody: ChatRequestBody = parseRequestBody(requests[0].init);

    assert.equal(parsedBody.model, cfg.LLM_MODEL_ID);
    assert.equal(parsedBody.stream, false);
    assert.deepEqual(parsedBody.response_format, { type: "json_object" });
    assert.equal(parsedBody.messages.length, 2);
    assert.equal(parsedBody.messages[0].role, "system");
    assert.ok(parsedBody.messages[0].content.includes("relevance classifier"));
    assert.equal(parsedBody.messages[1].role, "user");
    assert.ok(parsedBody.messages[1].content.includes("Article title: Test Article"));
    assert.ok(parsedBody.messages[1].content.includes("AI"));

    assert.notEqual(result, null);
    assert.equal(result!.length, 1);
    assert.equal(result![0].topic_id, 1);
    assert.equal(result![0].relevant, true);
    assert.equal(result![0].score, 0.9);
    assert.equal(result![0].reason, "good");
  });

  void it("logs token usage at info level", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({
        json: {
          choices: [{ message: { content: '{"matches":[]}' } }],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        },
      }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    const infoMessages: string[] = logCalls.filter((call) => call.level === "info").map((call) => call.message);

    assert.ok(
      infoMessages.some(
        (message) =>
          message.includes("prompt_tokens=42") &&
          message.includes("completion_tokens=7") &&
          message.includes("total_tokens=49"),
      ),
    );
    assert.notEqual(result, null);
  });

  void it("returns null on a non-2xx response and logs the status and error message", async () => {
    const requests: CapturedRequest[] = [];
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string, init: RequestInit | undefined) => {
      requests.push({ url, init });

      return Promise.resolve({ status: 401, ok: false, text: '{"error":{"message":"Invalid API key"}}' });
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);
    assert.equal(requests.length, 1);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(errorMessages.some((message) => message.includes("401") && message.includes("Invalid API key")));
  });

  void it("returns null when fetch rejects, logging the error without throwing", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() => Promise.reject(new Error("network down")));

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const errorMessages: string[] = logCalls.filter((call) => call.level === "error").map((call) => call.message);

    assert.ok(errorMessages.some((message) => message.includes("network down")));
  });

  void it("returns null when choices is empty and logs a warning", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() => Promise.resolve({ json: { choices: [] } }));

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const warnMessages: string[] = logCalls.filter((call) => call.level === "warn").map((call) => call.message);

    assert.ok(warnMessages.some((message) => message.includes("no content")));
  });

  void it("returns null when content is null and logs a warning", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: { content: null } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const warnMessages: string[] = logCalls.filter((call) => call.level === "warn").map((call) => call.message);

    assert.ok(warnMessages.some((message) => message.includes("no content")));
  });

  void it("returns null when content is missing and logs a warning", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: {} }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(result, null);

    const warnMessages: string[] = logCalls.filter((call) => call.level === "warn").map((call) => call.message);

    assert.ok(warnMessages.some((message) => message.includes("no content")));
  });

  void it("retries once on parse failure and returns matches from the second response", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(
      (_url: string, _init: RequestInit | undefined, callIndex: number) => {
        if (callIndex === 0) {
          return Promise.resolve({ json: { choices: [{ message: { content: "not json" } }] } });
        }

        return Promise.resolve({
          json: { choices: [{ message: { content: '{"matches":[{"topic_id":1,"relevant":true}]}' } }] },
        });
      },
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(fetchMock.mock.callCount(), 2);
    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 1);
  });

  void it("returns null after two consecutive parse failures with exactly two requests", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.resolve({ json: { choices: [{ message: { content: "not json" } }] } }),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, [{ id: 1, phrase: "AI" }]);

    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(result, null);
  });

  void it("returns an empty array when no topics are provided and never calls fetch", async () => {
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(() =>
      Promise.reject(new Error("fetch should not be called")),
    );

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");
    const result: ClassifyResult[] | null = await classifyArticle(1, "Test", null, []);

    assert.deepEqual(result, []);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
