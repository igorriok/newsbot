import { config } from "../config";
import { log } from "../utils/log";
import { z } from "zod";

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

const SYSTEM_PROMPT: string = `You are a relevance classifier. Given an article and a list of topics, determine which topics the article is relevant to.
Mark a topic as relevant ONLY if the article is substantively ABOUT that topic — it's a central subject of the article.
Do NOT mark a topic as relevant just because it is mentioned in passing, tangentially, or as incidental background detail (e.g. a location, affiliation, or minor detail unrelated to the article's main subject).
If in doubt, mark relevant as false and give a low score.
Respond with strict JSON only — no markdown, no code fences, no extra text.
Format: {"matches": [{"topic_id": <int>, "relevant": <bool>, "score": <0.0-1.0>, "reason": "<brief explanation>"}]}`;

function buildPrompt(articleTitle: string, articleSummary: string | null, topics: TopicInfo[]): string {
  const topicLines: string = topics
    .map((topic) => `  - id: ${topic.id}, phrase: "${topic.phrase}"`)
    .join("\n");
  return `Article title: ${articleTitle}
Article summary: ${articleSummary ?? "(no summary)"}

Topics:
${topicLines}

Respond with strict JSON only.`;
}

interface OpenCodeSessionResponse {
  id: string;
}

interface OpenCodeTokenInfo {
  input: number;
  output: number;
  reasoning: number;
}

type SessionResponseSchemaType = z.ZodObject<{ id: z.ZodString }>;

const SessionResponseSchema: SessionResponseSchemaType = z.object({ id: z.string() });

type TokenInfoSchemaType = z.ZodObject<{
  input: z.ZodNumber;
  output: z.ZodNumber;
  reasoning: z.ZodNumber;
}>;

const TokenInfoSchema: TokenInfoSchemaType = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
});

interface OpenCodeMessageInfo {
  tokens?: OpenCodeTokenInfo;
}

interface MessagePart {
  type?: string;
  text?: string;
}

interface OpenCodeMessageResponse {
  info?: OpenCodeMessageInfo;
  parts?: MessagePart[];
}

type MessagePartSchemaType = z.ZodObject<{
  type: z.ZodOptional<z.ZodString>;
  text: z.ZodOptional<z.ZodString>;
}>;

const MessagePartSchema: MessagePartSchemaType = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
});

type InfoSchemaType = z.ZodObject<{
  tokens: z.ZodOptional<typeof TokenInfoSchema>;
}>;

type MessageResponseSchemaType = z.ZodObject<{
  info: z.ZodOptional<InfoSchemaType>;
  parts: z.ZodOptional<z.ZodArray<typeof MessagePartSchema>>;
}>;

const MessageResponseSchema: MessageResponseSchemaType = z.object({
  info: z.object({ tokens: TokenInfoSchema.optional() }).optional(),
  parts: z.array(MessagePartSchema).optional(),
});

async function callOpenCode(prompt: string, articleId: number): Promise<string | null> {
  let sessionId: string | null = null;

  try {
    log("debug", `[article ${articleId}] Creating opencode session`);

    const sessionRes: Response = await fetch(`${config.OPENCODE_SERVER_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "newsbot-classifier" }),
    });

    if (!sessionRes.ok) {
      log("error", `OpenCode session create returned ${sessionRes.status}: ${await sessionRes.text()}`);
      return null;
    }

    const session: OpenCodeSessionResponse = SessionResponseSchema.parse(await sessionRes.json());

    sessionId = session.id;

    log(
      "info",
      `[article ${articleId}] Sending classification request to opencode (session ${sessionId}, model ${config.OPENCODE_PROVIDER_ID}/${config.OPENCODE_MODEL_ID})`,
    );

    const messageRes: Response = await fetch(`${config.OPENCODE_SERVER_URL}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: { providerID: config.OPENCODE_PROVIDER_ID, modelID: config.OPENCODE_MODEL_ID },
        tools: { "*": false },
        system: SYSTEM_PROMPT,
        parts: [{ type: "text", text: prompt }],
      }),
    });

    if (!messageRes.ok) {
      log("error", `OpenCode message returned ${messageRes.status}: ${await messageRes.text()}`);
      return null;
    }

    const data: OpenCodeMessageResponse = MessageResponseSchema.parse(await messageRes.json());
    const tokens: OpenCodeTokenInfo | undefined = data.info?.tokens;

    log(
      "info",
      `[article ${articleId}] Received opencode response (session ${sessionId})${tokens ? `, tokens: input=${tokens.input} output=${tokens.output} reasoning=${tokens.reasoning}` : ""}`,
    );

    const textParts: OpenCodeMessageResponse["parts"] = (data.parts ?? []).filter(
      (part) => part.type === "text",
    );

    if (textParts.length === 0) {
      log("warn", `[article ${articleId}] opencode response had no text parts`);
      return null;
    }

    return textParts[textParts.length - 1].text ?? null;
  } catch (err: unknown) {
    log("error", `[article ${articleId}] OpenCode API call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    if (sessionId) {
      fetch(`${config.OPENCODE_SERVER_URL}/session/${sessionId}`, { method: "DELETE" }).catch(
        (err: unknown) => {
          log("warn", `Failed to clean up OpenCode session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
    }
  }
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
    log("error", `Failed to parse classifier response: ${err instanceof Error ? err.message : String(err)}, raw: ${text}`);
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
  const raw: string | null = await callOpenCode(prompt, articleId);
  if (!raw) return null;

  const result: ClassifyResult[] | null = parseResponse(raw);
  if (result) return result;

  log("warn", `[article ${articleId}] Failed to parse classifier response, retrying`);

  const retryRaw: string | null = await callOpenCode(prompt, articleId);
  if (!retryRaw) return null;
  return parseResponse(retryRaw);
}
