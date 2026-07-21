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
    if (!grouped.has(m.chat_id)) grouped.set(m.chat_id, []);
    grouped.get(m.chat_id)!.push(m);
  }

  for (const [chatId, chatMatches] of grouped) {
    const db = getDb();
    const chat = db.prepare("SELECT telegram_chat_id FROM chats WHERE id = ?").get(chatId) as { telegram_chat_id: number } | undefined;
    if (!chat) continue;

    for (const m of chatMatches) {
      try {
        const title = m.title ?? "Untitled";
        const url = m.url ?? "";
        const score = m.score != null ? ` (relevance: ${(m.score * 100).toFixed(0)}%)` : "";
        const reason = m.reasoning ? `\nWhy: ${m.reasoning}` : "";
        const msg = `${title}${score}\n${url}${reason}`;

        log("debug", `Sending notification to chat ${chatId} (telegram_chat_id=${chat.telegram_chat_id}) for article ${m.article_id}, topic ${m.topic_id}`);

        if (m.image_url) {
          try {
            await bot.api.sendPhoto(chat.telegram_chat_id, m.image_url, {
              caption: msg.slice(0, 1024),
            });
          } catch (photoErr: any) {
            log("warn", `Failed to send photo for article ${m.article_id}, falling back to text: ${photoErr.message}`);
            await bot.api.sendMessage(chat.telegram_chat_id, msg, {
              link_preview_options: { is_disabled: true },
            });
          }
        } else {
          await bot.api.sendMessage(chat.telegram_chat_id, msg, {
            link_preview_options: { is_disabled: true },
          });
        }

        markNotified(m.article_id, m.topic_id);
        log("info", `Sent notification to chat ${chatId} for article ${m.article_id}, topic ${m.topic_id}`);

        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      } catch (err: any) {
        log("error", `Failed to send notification to chat ${chatId}: ${err.message}`);
      }
    }
  }
}
