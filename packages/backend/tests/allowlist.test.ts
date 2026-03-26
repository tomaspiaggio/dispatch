import { describe, it, expect } from "vitest";
import { isAllowed, parseDelay } from "../src/lib/allowlist";

describe("isAllowed", () => {
  it("allows all users on non-telegram platforms", () => {
    expect(isAllowed("slack", "anyone", "C1", "123")).toBe(true);
    expect(isAllowed("web", undefined, undefined, "123")).toBe(true);
  });

  it("allows all telegram users when no allowlist is set", () => {
    expect(isAllowed("telegram", "999", "999", undefined)).toBe(true);
    expect(isAllowed("telegram", "999", "999", "")).toBe(true);
  });

  it("allows telegram user by user ID", () => {
    expect(isAllowed("telegram", "123", "456", "123,789")).toBe(true);
  });

  it("allows telegram user by channel ID", () => {
    expect(isAllowed("telegram", "other", "456", "456")).toBe(true);
  });

  it("blocks telegram user not in allowlist", () => {
    expect(isAllowed("telegram", "999", "888", "123,456")).toBe(false);
  });

  it("handles whitespace in allowlist", () => {
    expect(isAllowed("telegram", "123", "x", " 123 , 456 ")).toBe(true);
  });
});

describe("parseDelay", () => {
  it("parses seconds", () => {
    expect(parseDelay("30s")).toBe(30_000);
    expect(parseDelay("1sec")).toBe(1_000);
  });

  it("parses minutes", () => {
    expect(parseDelay("5m")).toBe(300_000);
    expect(parseDelay("1min")).toBe(60_000);
  });

  it("parses hours", () => {
    expect(parseDelay("1h")).toBe(3_600_000);
    expect(parseDelay("2hr")).toBe(7_200_000);
    expect(parseDelay("3hours")).toBe(10_800_000);
  });

  it("parses days", () => {
    expect(parseDelay("1d")).toBe(86_400_000);
    expect(parseDelay("2days")).toBe(172_800_000);
  });

  it("throws for invalid format", () => {
    expect(() => parseDelay("abc")).toThrow("Invalid delay");
    expect(() => parseDelay("")).toThrow("Invalid delay");
    expect(() => parseDelay("5x")).toThrow("Invalid delay");
  });
});
