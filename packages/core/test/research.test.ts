import { describe, expect, it } from "vitest";

import { deduplicateByContentHash, wasSourceKnownBy, type SourceDocument } from "../src";

const source: SourceDocument = {
  id: "source-1",
  url: "https://www.weather.gov/example",
  publisher: "National Weather Service",
  excerpt: "A forecast update.",
  sourcePublishedAt: "2026-08-07T10:00:00Z",
  observedAt: "2026-08-07T10:05:00Z",
  storedAt: "2026-08-07T10:06:00Z",
  contentHash: "same-content",
  approved: true,
};

describe("point-in-time research helpers", () => {
  it("uses observed time instead of publication or storage time", () => {
    expect(wasSourceKnownBy(source, "2026-08-07T10:04:59Z")).toBe(false);
    expect(wasSourceKnownBy(source, "2026-08-07T10:05:00Z")).toBe(true);
  });

  it("keeps only the first copy of identical content", () => {
    const duplicate = { ...source, id: "source-2" };

    expect(deduplicateByContentHash([source, duplicate])).toEqual([source]);
  });
});
