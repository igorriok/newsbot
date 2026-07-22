import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { type Chat, upsertChat, getChatByTelegramId } from "../../src/db/chats";

void describe("chats", () => {
  let cleanup: () => void;

  void beforeEach(() => {
    cleanup = setupTestDb();
  });
  void afterEach(() => cleanup());

  void it("upsertChat inserts a new chat and returns it", () => {
    const chat: Chat = upsertChat(12345);

    assert.equal(chat.telegram_chat_id, 12345);
    assert.ok(chat.id > 0);
  });

  void it("upsertChat is idempotent", () => {
    const first: Chat = upsertChat(99999);
    const second: Chat = upsertChat(99999);

    assert.equal(first.id, second.id);
    assert.equal(first.telegram_chat_id, second.telegram_chat_id);
  });

  void it("upsertChat returns the same row on second call", () => {
    const first: Chat = upsertChat(55555);
    const second: Chat = upsertChat(55555);

    assert.equal(first.id, second.id);
    assert.equal(first.telegram_chat_id, second.telegram_chat_id);
  });

  void it("getChatByTelegramId returns undefined for missing chat", () => {
    const chat: Chat | undefined = getChatByTelegramId(999999);

    assert.equal(chat, undefined);
  });

  void it("getChatByTelegramId returns the chat when it exists", () => {
    upsertChat(77777);

    const chat: Chat | undefined = getChatByTelegramId(77777);

    assert.notEqual(chat, undefined);
    assert.equal(chat!.telegram_chat_id, 77777);
  });
});
