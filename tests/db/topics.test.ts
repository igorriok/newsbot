import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../helpers/db";
import {
  type Topic,
  insertTopic,
  deleteTopic,
  getTopicsForChat,
  getTopicByChatAndPhrase,
  getTopicsByChatIds,
  getAllTopics,
} from "../../src/db/topics";
import { upsertChat } from "../../src/db/chats";

void describe("topics", () => {
  let cleanup: () => void;
  let chatId: number;

  void beforeEach(() => {
    cleanup = setupTestDb();
    chatId = upsertChat(11111).id;
  });

  void afterEach(() => cleanup());

  void it("insertTopic creates a topic and returns it", () => {
    const topic: Topic = insertTopic(chatId, "artificial intelligence");

    assert.equal(topic.chat_id, chatId);
    assert.equal(topic.phrase, "artificial intelligence");
    assert.ok(topic.id > 0);
  });

  void it("getTopicByChatAndPhrase is case-insensitive (COLLATE NOCASE)", () => {
    insertTopic(chatId, "Machine Learning");

    const topic: Topic | undefined = getTopicByChatAndPhrase(chatId, "machine learning");

    assert.notEqual(topic, undefined);
    assert.equal(topic!.phrase, "Machine Learning");

    const topicUpper: Topic | undefined = getTopicByChatAndPhrase(chatId, "MACHINE LEARNING");

    assert.notEqual(topicUpper, undefined);
  });

  void it("deleteTopic removes a topic", () => {
    const topic: Topic = insertTopic(chatId, "delete me");
    const deleted: boolean = deleteTopic(topic.id, chatId);

    assert.equal(deleted, true);

    const topics: Topic[] = getTopicsForChat(chatId);

    assert.equal(topics.find((topicMatch) => topicMatch.id === topic.id), undefined);
  });

  void it("getTopicsByChatIds returns empty array for empty input", () => {
    const topics: Topic[] = getTopicsByChatIds([]);

    assert.deepEqual(topics, []);
  });

  void it("getTopicsByChatIds returns topics for given chat ids", () => {
    const chat2Id: number = upsertChat(22222).id;

    insertTopic(chatId, "topic for chat 1");
    insertTopic(chat2Id, "topic for chat 2");

    const topics: Topic[] = getTopicsByChatIds([chatId]);

    assert.ok(topics.every((topicItem) => topicItem.chat_id === chatId));
  });

  void it("getAllTopics returns all topics across chats", () => {
    insertTopic(chatId, "topic-a");

    const all: Topic[] = getAllTopics();

    assert.equal(all.length, 1);
  });

  void it("getTopicsForChat returns only that chat's topics", () => {
    insertTopic(chatId, "chat1-only");

    const topics: Topic[] = getTopicsForChat(chatId);

    assert.ok(topics.every((topicItem) => topicItem.chat_id === chatId));
  });
});
