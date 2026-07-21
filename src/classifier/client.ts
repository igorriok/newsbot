import { config } from "../config";
import { log } from "../utils/log";
import { z } from "zod";

const MatchSchema = z.object({
  topic_id: z.number(),
  relevant: z.boolean(),
  score: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

const ResponseSchema = z.object({
  matches: z.array(MatchSchema),
});

interface TopicInfo {
  id: number;
  phrase: string;
}

interface ClassifyResult {
  topic_id: number;
  relevant: boolean;
  score: number;
  reason: string;
}

const SYSTEM_PROMPT = `You are a relevance classifier. Given an article and a list of topics, determine which topics the article is relevant to.
Respond with strict JSON only — no markdown, no code fences, no extra text.
Format: {"matches": [{"topic_id": <int>, "relevant": <bool>, "score": <0.0-1.0>, "reason": "<brief explanation>"}]}`;

function buildPrompt(articleTitle: string, articleSummary: string | null, topics: TopicInfo[]): string {
  const topicLines = topics.map((t) => `  - id: ${t.id}, phrase: "${t.phrase}"`).join("\n");
  return `Article title: ${articleTitle}
Article summary: ${articleSummary ?? "(no summary)"}

Topics:
${topicLines}

Respond with strict JSON only.`;
}

async function callOpenCode(prompt: string, articleId: number): Promise<string | null> {
  let sessionId: string | null = null;
  try {
    log("debug", `[article ${articleId}] Creating opencode session`);
    const sessionRes = await fetch(`${config.OPENCODE_SERVER_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "newsbot-classifier" }),
    });
    if (!sessionRes.ok) {
      log("error", `OpenCode session create returned ${sessionRes.status}: ${await sessionRes.text()}`);
      return null;
    }
    const session = await sessionRes.json() as any;
    sessionId = session.id;

    log("info", `[article ${articleId}] Sending classification request to opencode (session ${sessionId}, model ${config.OPENCODE_PROVIDER_ID}/${config.OPENCODE_MODEL_ID})`);
    const messageRes = await fetch(`${config.OPENCODE_SERVER_URL}/session/${sessionId}/message`, {
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

    const data = await messageRes.json() as any;
    const tokens = data.info?.tokens;
    log("info", `[article ${articleId}] Received opencode response (session ${sessionId})${tokens ? `, tokens: input=${tokens.input} output=${tokens.output} reasoning=${tokens.reasoning}` : ""}`);

    const textParts = (data.parts ?? []).filter((p: any) => p.type === "text");
    if (textParts.length === 0) {
      log("warn", `[article ${articleId}] opencode response had no text parts`);
      return null;
    }
    return textParts[textParts.length - 1].text ?? null;
  } catch (err: any) {
    log("error", `[article ${articleId}] OpenCode API call failed: ${err.message}`);
    return null;
  } finally {
    if (sessionId) {
      fetch(`${config.OPENCODE_SERVER_URL}/session/${sessionId}`, { method: "DELETE" }).catch((err: any) => {
        log("warn", `Failed to clean up OpenCode session ${sessionId}: ${err.message}`);
      });
    }
  }
}

function parseResponse(text: string): ClassifyResult[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const validated = ResponseSchema.parse(parsed);
    return validated.matches.map((m) => ({
      topic_id: m.topic_id,
      relevant: m.relevant,
      score: m.score ?? (m.relevant ? 0.8 : 0.0),
      reason: m.reason ?? "",
    }));
  } catch (err: any) {
    log("error", `Failed to parse classifier response: ${err.message}, raw: ${text}`);
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

  const prompt = buildPrompt(articleTitle, articleSummary, topics);
  const raw = await callOpenCode(prompt, articleId);
  if (!raw) return null;

  const result = parseResponse(raw);
  if (result) return result;

  log("warn", `[article ${articleId}] Failed to parse classifier response, retrying`);
  const retryRaw = await callOpenCode(prompt, articleId);
  if (!retryRaw) return null;
  return parseResponse(retryRaw);
}
