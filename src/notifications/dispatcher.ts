import { InputFile } from "grammy";
import { getUnnotifiedMatches, markNotified } from "../db/article_topic_matches";
import { getDb } from "../db/connection";
import { bot } from "../bot";
import { log } from "../utils/log";

type Match = ReturnType<typeof getUnnotifiedMatches>[number];

async function sendOne(m: Match): Promise<void> {
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
      const caption = msg.slice(0, 1024);
      try {
        await bot.api.sendPhoto(chat.telegram_chat_id, m.image_url, { caption });
      } catch (photoErr: any) {
        log("warn", `Failed to send photo by URL for article ${m.article_id}, retrying via upload: ${photoErr.message}`);
        try {
          await bot.api.sendPhoto(chat.telegram_chat_id, new InputFile(new URL(m.image_url)), { caption });
        } catch (uploadErr: any) {
          log("warn", `Failed to send photo by upload for article ${m.article_id}, falling back to text: ${uploadErr.message}`);
          await bot.api.sendMessage(chat.telegram_chat_id, msg, {
            link_preview_options: { is_disabled: true },
          });
        }
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

export async function dispatchNotifications(): Promise<void> {
  const matches = getUnnotifiedMatches();
  if (matches.length === 0) return;

  // Throttle per chat: send at most one notification per chat per cycle (oldest first),
  // instead of one globally, so a busy chat can't starve out a quiet one.
  const oldestPerChat = new Map<number, Match>();
  for (const m of matches) {
    if (!oldestPerChat.has(m.chat_id)) oldestPerChat.set(m.chat_id, m);
  }

  const toSend = [...oldestPerChat.values()];
  const remaining = matches.length - toSend.length;
  log("info", `Dispatching ${toSend.length} notification(s) across ${toSend.length} chat(s) (${remaining} remaining for next cycle)`);

  for (const m of toSend) {
    await sendOne(m);
  }
}
