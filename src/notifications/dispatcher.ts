import { InputFile } from "grammy";
import { getUnnotifiedMatches, markNotified, UnnotifiedMatch } from "../db/article_topic_matches";
import { getDb } from "../db/connection";
import { bot } from "../bot";
import { log } from "../utils/log";
import Database from "better-sqlite3";

interface ChatRow {
  telegram_chat_id: number;
}

async function sendOne(match: UnnotifiedMatch): Promise<void> {
  const db: Database.Database = getDb();
  const chat: ChatRow | undefined = db
    .prepare<[number], ChatRow>("SELECT telegram_chat_id FROM chats WHERE id = ?")
    .get(match.chat_id);

  if (!chat) {
    markNotified(match.article_id, match.topic_id);
    log(
      "warn",
      `Chat ${match.chat_id} not found, skipping notification for article ${match.article_id}, topic ${match.topic_id}`,
    );
    return;
  }

  try {
    const title: string = match.title ?? "Untitled";
    const url: string = match.url ?? "";
    const score: string = match.score != null ? ` (relevance: ${(match.score * 100).toFixed(0)}%)` : "";
    const reason: string = match.reasoning ? `\nWhy: ${match.reasoning}` : "";
    const msg: string = `${title}${score}\n${url}${reason}`;

    log(
      "debug",
      `Sending notification to chat ${match.chat_id} (telegram_chat_id=${chat.telegram_chat_id}) for article ${match.article_id}, topic ${match.topic_id}`,
    );

    if (match.image_url) {
      const caption: string = msg.slice(0, 1024);

      try {
        await bot.api.sendPhoto(chat.telegram_chat_id, match.image_url, { caption });
      } catch (photoErr: unknown) {
        log(
          "warn",
          `Failed to send photo by URL for article ${match.article_id}, retrying via upload: ${photoErr instanceof Error ? photoErr.message : String(photoErr)}`,
        );

        try {
          await bot.api.sendPhoto(chat.telegram_chat_id, new InputFile(new URL(match.image_url)), {
            caption,
          });
        } catch (uploadErr: unknown) {
          log(
            "warn",
            `Failed to send photo by upload for article ${match.article_id}, falling back to text: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`,
          );
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

    markNotified(match.article_id, match.topic_id);
    log("info", `Sent notification to chat ${match.chat_id} for article ${match.article_id}, topic ${match.topic_id}`);
  } catch (err: unknown) {
    log(
      "error",
      `Failed to send notification to chat ${match.chat_id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function dispatchNotifications(): Promise<void> {
  const matches: UnnotifiedMatch[] = getUnnotifiedMatches();
  if (matches.length === 0) return;

  // Throttle per chat: send at most one notification per chat per cycle (oldest first),
  // instead of one globally, so a busy chat can't starve out a quiet one.
  const oldestPerChat: Map<number, UnnotifiedMatch> = new Map<number, UnnotifiedMatch>();

  for (const match of matches) {
    if (!oldestPerChat.has(match.chat_id)) oldestPerChat.set(match.chat_id, match);
  }

  const toSend: UnnotifiedMatch[] = [...oldestPerChat.values()];
  const remaining: number = matches.length - toSend.length;

  log(
    "info",
    `Dispatching ${toSend.length} notification(s) across ${toSend.length} chat(s) (${remaining} remaining for next cycle)`,
  );

  for (const match of toSend) {
    await sendOne(match);
  }
}
