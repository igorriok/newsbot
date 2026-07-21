import { getUnnotifiedMatches, markNotified } from "../db/article_topic_matches";
import { getDb } from "../db/connection";
import { bot } from "../bot";
import { log } from "../utils/log";

const RATE_LIMIT_MS = 1000;

export async function dispatchNotifications(): Promise<void> {
  const matches = getUnnotifiedMatches();
  if (matches.length === 0) return;

  log("info", `Dispatching ${matches.length} notifications`);

  const grouped = new Map<number, typeof matches>();
  for (const m of matches) {
    if (!grouped.has(m.user_id)) grouped.set(m.user_id, []);
    grouped.get(m.user_id)!.push(m);
  }

  for (const [userId, userMatches] of grouped) {
    const db = getDb();
    const user = db.prepare("SELECT telegram_id FROM users WHERE id = ?").get(userId) as { telegram_id: number } | undefined;
    if (!user) continue;

    for (const m of userMatches) {
      try {
        const title = m.title ?? "Untitled";
        const url = m.url ?? "";
        const score = m.score != null ? ` (relevance: ${(m.score * 100).toFixed(0)}%)` : "";
        const reason = m.reasoning ? `\nWhy: ${m.reasoning}` : "";
        const msg = `${title}${score}\n${url}${reason}`;

        await bot.api.sendMessage(user.telegram_id, msg, {
          link_preview_options: { is_disabled: true },
        });

        markNotified(m.article_id, m.topic_id);

        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      } catch (err: any) {
        log("error", `Failed to send notification to user ${userId}: ${err.message}`);
      }
    }
  }
}
