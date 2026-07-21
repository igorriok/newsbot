import { getUnnotifiedMatches, markNotified } from "../db/article_topic_matches";
import { getDb } from "../db/connection";
import { bot } from "../bot";
import { log } from "../utils/log";

export async function dispatchNotifications(): Promise<void> {
  const matches = getUnnotifiedMatches();
  if (matches.length === 0) return;

  const m = matches[0];
  log("info", `Dispatching 1 notification (${matches.length - 1} remaining for next cycle)`);

  const db = getDb();
  const chat = db.prepare("SELECT telegram_chat_id FROM chats WHERE id = ?").get(m.chat_id) as { telegram_chat_id: number } | undefined;
  if (!chat) {
    markNotified(m.article_id, m.topic_id);
    log("warn", `Chat ${m.chat_id} not found, skipping notification for article ${m.article_id}, topic ${m.topic_id}`);
    return;
  }

  try {
    const title = m.title ?? "Untitled";
    const url = m.url ?? "";
    const score = m.score != null ? ` (relevance: ${(m.score * 100).toFixed(0)}%)` : "";
    const reason = m.reasoning ? `\nWhy: ${m.reasoning}` : "";
    const msg = `${title}${score}\n${url}${reason}`;

    log("debug", `Sending notification to chat ${m.chat_id} (telegram_chat_id=${chat.telegram_chat_id}) for article ${m.article_id}, topic ${m.topic_id}`);

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
    log("info", `Sent notification to chat ${m.chat_id} for article ${m.article_id}, topic ${m.topic_id}`);
  } catch (err: any) {
    log("error", `Failed to send notification to chat ${m.chat_id}: ${err.message}`);
  }
}
