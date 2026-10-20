// @ts-check
import { describe, expect, it } from "vitest";
import { buildCheckinUrl } from "./qr.js";

describe("buildCheckinUrl", () => {
  it("requires HTTPS and URL-encodes IDs", () => {
    expect(buildCheckinUrl("https://example.org/checkin/{id}", "A/B ?")).toBe("https://example.org/checkin/A%2FB%20%3F");
    expect(() => buildCheckinUrl("http://example.org/checkin/{id}", "A")).toThrow(/HTTPS/);
    expect(() => buildCheckinUrl("https://example.org/checkin/{id}", "")).toThrow();
    expect(() => buildCheckinUrl("https://example.org/checkin", "A")).toThrow();
  });
});
