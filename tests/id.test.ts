import { describe, it, expect } from "bun:test";
import { generateId } from "../src/lib/id";

describe("generateId", () => {
  it("returns 8 hex chars", () => {
    const id = generateId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("returns unique values across 100 calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
