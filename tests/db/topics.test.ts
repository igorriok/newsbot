import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import {
  insertTopic,
  deleteTopic,
  getTopicsForChat,
  getTopicByChatAndPhrase,
  getTopicsByChatIds,
  getAllTopics,
} from "../../src/db/topics";
import { upsertChat } from "../../src/db/chats";

describe("topics", () => {
  let cleanup: () => void;
  let chatId: number;

  beforeEach(() => {
    cleanup = setupTestDb();
    chatId = upsertChat(11111).id;
  });

  afterEach(() => cleanup());

  it("insertTopic creates a topic and returns it", () => {
    const topic = insertTopic(chatId, "artificial intelligence");
    assert.equal(topic.chat_id, chatId);
    assert.equal(topic.phrase, "artificial intelligence");
    assert.ok(topic.id > 0);
  });

  it("getTopicByChatAndPhrase is case-insensitive (COLLATE NOCASE)", () => {
    insertTopic(chatId, "Machine Learning");
    const topic = getTopicByChatAndPhrase(chatId, "machine learning");
    assert.notEqual(topic, undefined);
    assert.equal(topic!.phrase, "Machine Learning");

    const topicUpper = getTopicByChatAndPhrase(chatId, "MACHINE LEARNING");
    assert.notEqual(topicUpper, undefined);
  });

  it("deleteTopic removes a topic", () => {
    const topic = insertTopic(chatId, "delete me");
    const ok = deleteTopic(topic.id, chatId);
    assert.equal(ok, true);

    const topics = getTopicsForChat(chatId);
    assert.equal(topics.find((t) => t.id === topic.id), undefined);
  });

  it("getTopicsByChatIds returns empty array for empty input", () => {
    const topics = getTopicsByChatIds([]);
    assert.deepEqual(topics, []);
  });

  it("getTopicsByChatIds returns topics for given chat ids", () => {
    const chat2 = upsertChat(22222).id;
    insertTopic(chatId, "topic for chat 1");
    insertTopic(chat2, "topic for chat 2");

    const topics = getTopicsByChatIds([chatId]);
    assert.ok(topics.every((t) => t.chat_id === chatId));
  });

  it("getAllTopics returns all topics across chats", () => {
    insertTopic(chatId, "topic-a");
    const all = getAllTopics();
    assert.equal(all.length, 1);
  });

  it("getTopicsForChat returns only that chat's topics", () => {
    insertTopic(chatId, "chat1-only");
    const topics = getTopicsForChat(chatId);
    assert.ok(topics.every((t) => t.chat_id === chatId));
  });
});
