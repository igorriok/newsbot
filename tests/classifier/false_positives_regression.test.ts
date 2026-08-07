import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

type MockResponseJson = string | number | boolean | null | MockResponseJson[] | MockResponseJsonObject;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface indirection is required to break the Record<> circular type alias reference above
interface MockResponseJsonObject extends Record<string, MockResponseJson> {}

type DeepSeekRequestBodySchemaType = z.ZodObject<{
  model: z.ZodString;
  messages: z.ZodArray<z.ZodObject<{ role: z.ZodString; content: z.ZodString }>>;
  stream: z.ZodBoolean;
  temperature: z.ZodNumber;
  response_format: z.ZodObject<{ type: z.ZodString }>;
}>;

const DeepSeekRequestBodySchema: DeepSeekRequestBodySchemaType = z
  .object({
    model: z.string(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })),
    stream: z.boolean(),
    temperature: z.number(),
    response_format: z.object({ type: z.string() }),
  })
  .passthrough();

type DeepSeekRequestBody = z.infer<typeof DeepSeekRequestBodySchema>;

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const TOPIC_PHRASE: string = "sectorul ciocana";

let BASE: string = "";

function makeFetchMock(
  handler: (url: string, init: RequestInit | undefined) => Promise<{ json: MockResponseJson }>,
): ReturnType<typeof mock.fn> {
  return mock.fn((url: string, init?: RequestInit) =>
    handler(url, init).then((response) => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve(response.json),
    })),
  );
}

function parseRequestBody(init: RequestInit | undefined): DeepSeekRequestBody {
  if (init === undefined || typeof init.body !== "string") {
    throw new Error("expected string request body");
  }

  return DeepSeekRequestBodySchema.parse(JSON.parse(init.body));
}

void describe("false-positive regression fixtures (Bug 2)", () => {
  void before(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_MODEL_ID = "deepseek-v4-flash";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";

    mock.module("../../src/utils/log", {
      exports: {
        log: () => {},
      },
    });

    const { config } = await import("../../src/config");

    BASE = config.DEEPSEEK_BASE_URL;
  });

  void after(() => {
    mock.reset();
  });

  void it("sends the hardened system prompt, the labeled user prompt, and temperature 0", async () => {
    const requests: CapturedRequest[] = [];
    const fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock((url: string, init: RequestInit | undefined) => {
      requests.push({ url, init });

      return Promise.resolve({
        json: { choices: [{ message: { content: '{"matches":[]}' } }] },
      });
    });

    mock.method(global, "fetch", fetchMock);

    const { classifyArticle } = await import("../../src/classifier/client");

    await classifyArticle(1, "Test Article", "Test Summary", [{ id: 1, phrase: TOPIC_PHRASE }]);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BASE}/chat/completions`);

    const parsedBody: DeepSeekRequestBody = parseRequestBody(requests[0].init);

    assert.equal(parsedBody.temperature, 0);
    assert.ok(parsedBody.messages[0].content.includes("LITERAL phrase the user typed"));
    assert.ok(parsedBody.messages[0].content.includes("NOT a semantic category"));
    assert.ok(parsedBody.messages[0].content.includes("Never supply the connection yourself"));
    assert.ok(parsedBody.messages[1].content.includes("Topic phrases (literal user queries to match against)"));
    assert.ok(parsedBody.messages[1].content.includes(`phrase: "${TOPIC_PHRASE}"`));
  });
});
