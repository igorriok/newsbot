import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import { upsertChat, getChatByTelegramId } from "../../src/db/chats";

describe("chats", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });
  afterEach(() => cleanup());

  it("upsertChat inserts a new chat and returns it", () => {
    const chat = upsertChat(12345);

    assert.equal(chat.telegram_chat_id, 12345);
    assert.ok(chat.id > 0);
  });

  it("upsertChat is idempotent", () => {
    const a = upsertChat(99999);
    const b = upsertChat(99999);

    assert.equal(a.id, b.id);
    assert.equal(a.telegram_chat_id, b.telegram_chat_id);
  });

  it("upsertChat returns the same row on second call", () => {
    const a = upsertChat(55555);
    const b = upsertChat(55555);

    assert.equal(a.id, b.id);
    assert.equal(a.telegram_chat_id, b.telegram_chat_id);
  });

  it("getChatByTelegramId returns undefined for missing chat", () => {
    const chat = getChatByTelegramId(999999);

    assert.equal(chat, undefined);
  });

  it("getChatByTelegramId returns the chat when it exists", () => {
    upsertChat(77777);

    const chat = getChatByTelegramId(77777);

    assert.notEqual(chat, undefined);
    assert.equal(chat!.telegram_chat_id, 77777);
  });
});
