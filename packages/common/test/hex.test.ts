import {
  bytes16FromHex,
  bytes32FromHex,
  bytesToHex,
  hexToBytes,
  intToBigint,
  intToHex,
  isHex,
  isHex32,
} from "../index";

import { describe, expect, it } from "vitest";

describe("hex helpers", () => {
  it("validates hex strings", () => {
    expect(isHex("0a0b0c")).toBe(true);
    expect(isHex("0x0a0b0c")).toBe(true);
    expect(isHex("xyz")).toBe(false);
    expect(isHex("0x0g")).toBe(false);
  });

  it("validates 32-byte hex strings", () => {
    const hex64 = "11".repeat(32);
    expect(isHex32(hex64)).toBe(true);
    expect(isHex32("0x" + hex64)).toBe(true);
    expect(isHex32("11".repeat(31))).toBe(false);
  });

  it("round-trips hex to bytes", () => {
    const input = "deadbeef";
    const bytes = hexToBytes(input);
    expect(bytesToHex(bytes)).toBe(input);
  });

  it("enforces 16-byte and 32-byte conversions", () => {
    expect(() => bytes16FromHex("11".repeat(16))).not.toThrow();
    expect(() => bytes32FromHex("22".repeat(32))).not.toThrow();
    expect(() => bytes16FromHex("11".repeat(15))).toThrow();
    expect(() => bytes32FromHex("22".repeat(31))).toThrow();
  });

  it("converts to bigint and hex", () => {
    expect(intToBigint(42)).toBe(42n);
    expect(intToBigint("123")).toBe(123n);
    expect(intToBigint(0n)).toBe(0n);
    expect(intToHex(255)).toBe("ff");
    expect(intToHex(255, 2)).toBe("00ff");
  });
});
