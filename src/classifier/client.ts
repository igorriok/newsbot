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

function buildPrompt(articleTitle: string, articleSummary: string | null, topics: TopicInfo[]): string {
  const topicLines = topics.map((t) => `  - id: ${t.id}, phrase: "${t.phrase}"`).join("\n");
  return `You are a relevance classifier. Given an article and a list of topics, determine which topics the article is relevant to.

Article title: ${articleTitle}
Article summary: ${articleSummary ?? "(no summary)"}

Topics:
${topicLines}

Respond with strict JSON only (no markdown, no code fences):
{"matches": [{"topic_id": <int>, "relevant": <bool>, "score": <0.0-1.0>, "reason": "<brief explanation>"}]}`;
}

async function callOpenCode(prompt: string): Promise<string | null> {
  try {
    const response = await fetch(`${config.OPENCODE_SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "classifier",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      log("error", `OpenCode API returned ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err: any) {
    log("error", `OpenCode API call failed: ${err.message}`);
    return null;
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
  const raw = await callOpenCode(prompt);
  if (!raw) return null;

  const result = parseResponse(raw);
  if (result) return result;

  const retryRaw = await callOpenCode(prompt);
  if (!retryRaw) return null;
  return parseResponse(retryRaw);
}
