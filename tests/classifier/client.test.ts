import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResponse } from "../../src/classifier/client";

describe("parseResponse", () => {
  it("parses valid JSON", () => {
    const result = parseResponse('{"matches":[{"topic_id":1,"relevant":true,"score":0.9,"reason":"good"}]}');

    assert.notEqual(result, null);
    assert.equal(result!.length, 1);
    assert.equal(result![0].topic_id, 1);
    assert.equal(result![0].relevant, true);
    assert.equal(result![0].score, 0.9);
    assert.equal(result![0].reason, "good");
  });

  it("parses JSON inside markdown code fences (```json)", () => {
    const result = parseResponse('```json\n{"matches":[{"topic_id":2,"relevant":false,"score":0.1}]}\n```');

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 2);
    assert.equal(result![0].relevant, false);
  });

  it("parses JSON inside plain code fences (```)", () => {
    const result = parseResponse('```\n{"matches":[{"topic_id":3,"relevant":true}]}\n```');

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 3);
  });

  it("returns null for malformed JSON", () => {
    const result = parseResponse("{invalid json}");

    assert.equal(result, null);
  });

  it("forces relevant=false when score is below MIN_RELEVANCE_SCORE (0.5)", () => {
    const result = parseResponse('{"matches":[{"topic_id":1,"relevant":true,"score":0.3,"reason":"low"}]}');

    assert.notEqual(result, null);
    assert.equal(result![0].relevant, false);
    assert.equal(result![0].score, 0.3);
  });

  it("defaults score to 0.8 when relevant=true and score is omitted", () => {
    const result = parseResponse('{"matches":[{"topic_id":1,"relevant":true}]}');

    assert.notEqual(result, null);
    assert.equal(result![0].score, 0.8);
    assert.equal(result![0].relevant, true);
  });

  it("defaults score to 0.0 when relevant=false and score is omitted", () => {
    const result = parseResponse('{"matches":[{"topic_id":1,"relevant":false}]}');

    assert.notEqual(result, null);
    assert.equal(result![0].score, 0.0);
    assert.equal(result![0].relevant, false);
  });

  it("handles empty matches array", () => {
    const result = parseResponse('{"matches":[]}');

    assert.notEqual(result, null);
    assert.equal(result!.length, 0);
  });
});
