import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeImageUrl, extractImageUrl } from "../../src/rss/poller";

void describe("sanitizeImageUrl", () => {
  void it("collapses domain-duplicated path", () => {
    const result: string = sanitizeImageUrl("https://example.com/example.com/wp-content/uploads/img.jpg");

    assert.equal(result, "https://example.com/wp-content/uploads/img.jpg");
  });

  void it("leaves normal URLs unchanged", () => {
    const result: string = sanitizeImageUrl("https://example.com/wp-content/uploads/img.jpg");

    assert.equal(result, "https://example.com/wp-content/uploads/img.jpg");
  });

  void it("handles URLs without duplicate domain", () => {
    const url: string = "https://cdn.example.com/images/photo.png";

    assert.equal(sanitizeImageUrl(url), url);
  });
});

void describe("extractImageUrl", () => {
  void it("extracts from media:content", () => {
    assert.equal(
      extractImageUrl({ mediaContent: { $: { url: "https://example.com/media.jpg" } } }),
      "https://example.com/media.jpg",
    );
  });

  void it("extracts from media:thumbnail", () => {
    assert.equal(
      extractImageUrl({ mediaThumbnail: { $: { url: "https://example.com/thumb.jpg" } } }),
      "https://example.com/thumb.jpg",
    );
  });

  void it("extracts from enclosure with image type", () => {
    assert.equal(
      extractImageUrl({ enclosure: { url: "https://example.com/enclosure.jpg", type: "image/jpeg" } }),
      "https://example.com/enclosure.jpg",
    );
  });

  void it("ignores enclosure without image type", () => {
    assert.equal(
      extractImageUrl({ enclosure: { url: "https://example.com/video.mp4", type: "video/mp4" } }),
      undefined,
    );
  });

  void it("extracts from inline <img> in content", () => {
    assert.equal(
      extractImageUrl({ content: '<p>Text</p><img src="https://example.com/inline.jpg" alt=""/>' }),
      "https://example.com/inline.jpg",
    );
  });

  void it("extracts from inline <img> in content:encoded", () => {
    assert.equal(
      extractImageUrl({ "content:encoded": '<img src="https://example.com/encoded.jpg"/>' }),
      "https://example.com/encoded.jpg",
    );
  });

  void it("returns undefined when no image found", () => {
    assert.equal(extractImageUrl({ title: "No image here" }), undefined);
  });

  void it("media:content takes precedence over media:thumbnail", () => {
    assert.equal(
      extractImageUrl({
        mediaContent: { $: { url: "https://example.com/content.jpg" } },
        mediaThumbnail: { $: { url: "https://example.com/thumb.jpg" } },
      }),
      "https://example.com/content.jpg",
    );
  });
});
