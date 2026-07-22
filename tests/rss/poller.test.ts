import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeImageUrl, extractImageUrl } from "../../src/rss/poller";

describe("sanitizeImageUrl", () => {
  it("collapses domain-duplicated path", () => {
    const result = sanitizeImageUrl("https://example.com/example.com/wp-content/uploads/img.jpg");
    assert.equal(result, "https://example.com/wp-content/uploads/img.jpg");
  });

  it("leaves normal URLs unchanged", () => {
    const result = sanitizeImageUrl("https://example.com/wp-content/uploads/img.jpg");
    assert.equal(result, "https://example.com/wp-content/uploads/img.jpg");
  });

  it("handles URLs without duplicate domain", () => {
    const url = "https://cdn.example.com/images/photo.png";
    assert.equal(sanitizeImageUrl(url), url);
  });
});

describe("extractImageUrl", () => {
  it("extracts from media:content", () => {
    const item = { mediaContent: { $: { url: "https://example.com/media.jpg" } } };
    assert.equal(extractImageUrl(item), "https://example.com/media.jpg");
  });

  it("extracts from media:thumbnail", () => {
    const item = { mediaThumbnail: { $: { url: "https://example.com/thumb.jpg" } } };
    assert.equal(extractImageUrl(item), "https://example.com/thumb.jpg");
  });

  it("extracts from enclosure with image type", () => {
    const item = { enclosure: { url: "https://example.com/enclosure.jpg", type: "image/jpeg" } };
    assert.equal(extractImageUrl(item), "https://example.com/enclosure.jpg");
  });

  it("ignores enclosure without image type", () => {
    const item = { enclosure: { url: "https://example.com/video.mp4", type: "video/mp4" } };
    assert.equal(extractImageUrl(item), undefined);
  });

  it("extracts from inline <img> in content", () => {
    const item = { content: '<p>Text</p><img src="https://example.com/inline.jpg" alt=""/>' };
    assert.equal(extractImageUrl(item), "https://example.com/inline.jpg");
  });

  it("extracts from inline <img> in content:encoded", () => {
    const item = { "content:encoded": '<img src="https://example.com/encoded.jpg"/>' };
    assert.equal(extractImageUrl(item), "https://example.com/encoded.jpg");
  });

  it("returns undefined when no image found", () => {
    const item = { title: "No image here" };
    assert.equal(extractImageUrl(item), undefined);
  });

  it("media:content takes precedence over media:thumbnail", () => {
    const item = {
      mediaContent: { $: { url: "https://example.com/content.jpg" } },
      mediaThumbnail: { $: { url: "https://example.com/thumb.jpg" } },
    };
    assert.equal(extractImageUrl(item), "https://example.com/content.jpg");
  });
});
