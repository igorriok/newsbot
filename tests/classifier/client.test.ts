import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResponse, type ClassifyResult } from "../../src/classifier/client";

void describe("parseResponse", () => {
  void it("parses valid JSON", () => {
    const result: ClassifyResult[] | null = parseResponse(
      '{"matches":[{"topic_id":1,"relevant":true,"score":0.9,"reason":"good"}]}',
    );

    assert.notEqual(result, null);
    assert.equal(result!.length, 1);
    assert.equal(result![0].topic_id, 1);
    assert.equal(result![0].relevant, true);
    assert.equal(result![0].score, 0.9);
    assert.equal(result![0].reason, "good");
  });

  void it("parses JSON inside markdown code fences (```json)", () => {
    const result: ClassifyResult[] | null = parseResponse(
      '```json\n{"matches":[{"topic_id":2,"relevant":false,"score":0.1}]}\n```',
    );

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 2);
    assert.equal(result![0].relevant, false);
  });

  void it("parses JSON inside plain code fences (```)", () => {
    const result: ClassifyResult[] | null = parseResponse('```\n{"matches":[{"topic_id":3,"relevant":true}]}\n```');

    assert.notEqual(result, null);
    assert.equal(result![0].topic_id, 3);
  });

  void it("returns null for malformed JSON", () => {
    const result: ClassifyResult[] | null = parseResponse("{invalid json}");

    assert.equal(result, null);
  });

  void it("forces relevant=false when score is below MIN_RELEVANCE_SCORE (0.5)", () => {
    const result: ClassifyResult[] | null = parseResponse(
      '{"matches":[{"topic_id":1,"relevant":true,"score":0.3,"reason":"low"}]}',
    );

    assert.notEqual(result, null);
    assert.equal(result![0].relevant, false);
    assert.equal(result![0].score, 0.3);
  });

  void it("defaults score to 0.8 when relevant=true and score is omitted", () => {
    const result: ClassifyResult[] | null = parseResponse('{"matches":[{"topic_id":1,"relevant":true}]}');

    assert.notEqual(result, null);
    assert.equal(result![0].score, 0.8);
    assert.equal(result![0].relevant, true);
  });

  void it("defaults score to 0.0 when relevant=false and score is omitted", () => {
    const result: ClassifyResult[] | null = parseResponse('{"matches":[{"topic_id":1,"relevant":false}]}');

    assert.notEqual(result, null);
    assert.equal(result![0].score, 0.0);
    assert.equal(result![0].relevant, false);
  });

  void it("handles empty matches array", () => {
    const result: ClassifyResult[] | null = parseResponse('{"matches":[]}');

    assert.notEqual(result, null);
    assert.equal(result!.length, 0);
  });
});
