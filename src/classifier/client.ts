import { config } from "../config";
import { log } from "../utils/log";
import { z } from "zod";

type ChatCompletionMessageSchemaType = z.ZodObject<{
  content: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}>;

const ChatCompletionMessageSchema: ChatCompletionMessageSchemaType = z
  .object({
    content: z.string().nullable().optional(),
  })
  .passthrough();

type ChatCompletionChoiceSchemaType = z.ZodObject<{
  message: ChatCompletionMessageSchemaType;
}>;

const ChatCompletionChoiceSchema: ChatCompletionChoiceSchemaType = z
  .object({
    message: ChatCompletionMessageSchema,
  })
  .passthrough();

type ChatCompletionUsageSchemaType = z.ZodObject<{
  prompt_tokens: z.ZodNumber;
  completion_tokens: z.ZodNumber;
  total_tokens: z.ZodNumber;
}>;

const ChatCompletionUsageSchema: ChatCompletionUsageSchemaType = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;

type ChatCompletionResponseSchemaType = z.ZodObject<{
  choices: z.ZodArray<ChatCompletionChoiceSchemaType>;
  usage: z.ZodOptional<z.ZodUnknown>;
}>;

const ChatCompletionResponseSchema: ChatCompletionResponseSchemaType = z.object({
  choices: z.array(ChatCompletionChoiceSchema),
  usage: z.unknown().optional(),
});

type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

type LlmErrorSchemaType = z.ZodObject<{
  message: z.ZodString;
}>;

type LlmErrorResponseSchemaType = z.ZodObject<{
  error: z.ZodOptional<z.ZodNullable<LlmErrorSchemaType>>;
}>;

const LlmErrorResponseSchema: LlmErrorResponseSchemaType = z
  .object({
    error: z
      .object({
        message: z.string(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

type LlmErrorResponse = z.infer<typeof LlmErrorResponseSchema>;

type MatchSchemaType = z.ZodObject<{
  topic_id: z.ZodNumber;
  relevant: z.ZodBoolean;
  score: z.ZodOptional<z.ZodNumber>;
  reason: z.ZodOptional<z.ZodString>;
}>;

const MatchSchema: MatchSchemaType = z.object({
  topic_id: z.number(),
  relevant: z.boolean(),
  score: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

type ResponseSchemaType = z.ZodObject<{
  matches: z.ZodArray<typeof MatchSchema>;
}>;

const ResponseSchema: ResponseSchemaType = z.object({
  matches: z.array(MatchSchema),
});

interface TopicInfo {
  id: number;
  phrase: string;
}

export interface ClassifyResult {
  topic_id: number;
  relevant: boolean;
  score: number;
  reason: string;
}

const SYSTEM_PROMPT: string = `You are a relevance classifier. Given an article and a list of topic phrases, determine which topic phrases the article is relevant to.

Each topic phrase is a LITERAL phrase the user typed — it is NOT a semantic category, a dictionary definition, or a concept to interpret broadly. The phrase may name a specific entity: a person, a place, a district, a brand, an event, or any other proper noun. You must match against the specific thing the user named, not against the individual words that happen to appear in the phrase.

An article that shares only common dictionary words with the phrase is NOT relevant. Words like 'sector', 'street', 'market' or 'centre' carry many unrelated senses — an industry, a stretch of road, a segment of anything at all. If the article uses one of the phrase's words in ANY sense other than the specific thing the phrase names, the article is NOT relevant.

Never supply the connection yourself. If the phrase names a district and the article mentions a street, road or landmark without stating that it lies in that district, the article is NOT relevant — do not fall back on your own knowledge of where a place is located, and never assert such a link in your reason. Judge only on what the article actually says.

Mark a topic AS relevant ONLY when the article is substantively ABOUT the specific thing the user named — it's a central subject of the article. Do NOT mark a topic as relevant just because the phrase is mentioned in passing, tangentially, or as incidental background detail (e.g. a location, affiliation, or minor detail unrelated to the article's main subject). If in doubt, mark relevant as false and give a low score.
Respond with strict JSON only — no markdown, no code fences, no extra text.
Format: {"matches": [{"topic_id": <int>, "relevant": <bool>, "score": <0.0-1.0>, "reason": "<brief explanation>"}]}`;

function buildPrompt(articleTitle: string, articleSummary: string | null, topics: TopicInfo[]): string {
  const topicLines: string = topics.map((topic) => `  - id: ${topic.id}, phrase: "${topic.phrase}"`).join("\n");
  return `Article title: ${articleTitle}
Article summary: ${articleSummary ?? "(no summary)"}

Topic phrases (literal user queries to match against):
${topicLines}

Respond with strict JSON only.`;
}

// The local model is unloaded after a few idle minutes and the API answers 503
// while it reloads, so a 503 is retried a few times before giving up.
const MAX_UNAVAILABLE_RETRIES: number = 3;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function callLlm(prompt: string, articleId: number): Promise<string | null> {
  try {
    log("debug", `[article ${articleId}] Sending classification request to LLM (model ${config.LLM_MODEL_ID})`);

    const body: string = JSON.stringify({
      model: config.LLM_MODEL_ID,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      stream: false,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    let response: Response = await postChatCompletion(body);

    for (let attempt: number = 1; response.status === 503 && attempt <= MAX_UNAVAILABLE_RETRIES; attempt++) {
      log(
        "warn",
        `[article ${articleId}] LLM API returned 503 (model loading?), retry ${attempt}/${MAX_UNAVAILABLE_RETRIES} in ${config.LLM_RETRY_DELAY_MS}ms`,
      );
      await sleep(config.LLM_RETRY_DELAY_MS);
      response = await postChatCompletion(body);
    }

    if (!response.ok) {
      let errorMessage: string = `${response.status}`;

      try {
        const text: string = await response.text();

        try {
          const parsedError: LlmErrorResponse | undefined = LlmErrorResponseSchema.safeParse(
            JSON.parse(text),
          ).data;
          const apiError: string | undefined = parsedError?.error?.message;

          if (apiError !== undefined) {
            errorMessage = `${response.status}: ${apiError}`;
          } else {
            errorMessage = `${response.status}: ${text}`;
          }
        } catch {
          errorMessage = `${response.status}: ${text}`;
        }
      } catch {
        // body read failed, fall back to status-only message
      }

      log("error", `[article ${articleId}] LLM API returned ${errorMessage}`);
      return null;
    }

    const parsed: ChatCompletionResponse = ChatCompletionResponseSchema.parse(await response.json());
    const content: string | null | undefined = parsed.choices[0]?.message?.content;

    if (content == null || content === "") {
      log("warn", `[article ${articleId}] LLM response had no content`);
      return null;
    }

    const usage: ChatCompletionUsage | undefined = ChatCompletionUsageSchema.safeParse(parsed.usage).data;

    log(
      "info",
      `[article ${articleId}] LLM response${usage ? `, tokens: prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total_tokens=${usage.total_tokens}` : ""}`,
    );

    return content;
  } catch (err: unknown) {
    log(
      "error",
      `[article ${articleId}] LLM API call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function postChatCompletion(body: string): Promise<Response> {
  return fetch(`${config.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.LLM_API_KEY}`,
    },
    body,
    signal: AbortSignal.timeout(config.LLM_TIMEOUT_MS),
  });
}

export function parseResponse(text: string): ClassifyResult[] | null {
  const cleaned: string = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");

  try {
    const validated: z.infer<typeof ResponseSchema> = ResponseSchema.parse(JSON.parse(cleaned));
    return validated.matches.map((match) => {
      const score: number = match.score ?? (match.relevant ? 0.8 : 0.0);
      return {
        topic_id: match.topic_id,
        relevant: match.relevant && score >= config.MIN_RELEVANCE_SCORE,
        score,
        reason: match.reason ?? "",
      };
    });
  } catch (err: unknown) {
    log(
      "error",
      `Failed to parse classifier response: ${err instanceof Error ? err.message : String(err)}, raw: ${text}`,
    );
    return null;
  }
}

export async function classifyArticle(
  articleId: number,
  articleTitle: string,
  articleSummary: string | null,
  topics: TopicInfo[],
): Promise<ClassifyResult[] | null> {
  if (topics.length === 0) return [];

  const prompt: string = buildPrompt(articleTitle, articleSummary, topics);
  const raw: string | null = await callLlm(prompt, articleId);
  if (!raw) return null;

  const result: ClassifyResult[] | null = parseResponse(raw);
  if (result) return withMissingTopics(result, topics);

  log("warn", `[article ${articleId}] Failed to parse classifier response, retrying`);

  const retryRaw: string | null = await callLlm(prompt, articleId);
  if (!retryRaw) return null;

  const retryResult: ClassifyResult[] | null = parseResponse(retryRaw);
  return retryResult ? withMissingTopics(retryResult, topics) : null;
}

// The model may list only the topics it considers relevant (or none at all).
// Every topic still needs a row in article_topic_matches, otherwise the article
// stays "unchecked" and is re-classified on every cycle.
function withMissingTopics(result: ClassifyResult[], topics: TopicInfo[]): ClassifyResult[] {
  const seen: Set<number> = new Set(result.map((match) => match.topic_id));
  const missing: ClassifyResult[] = topics
    .filter((topic) => !seen.has(topic.id))
    .map((topic) => ({ topic_id: topic.id, relevant: false, score: 0, reason: "" }));
  return missing.length > 0 ? [...result, ...missing] : result;
}
