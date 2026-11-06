import { describe, expect, it } from "vitest";

import {
  countdown,
  formatAmount,
  formatFigure,
  formatToken,
  mergeRanges,
  parseAmount,
  percent,
  ticketLabel,
  ticketRanges,
} from "@/lib/protocol/format";

const weth = { symbol: "WETH", decimals: 18 };
const usdc = { symbol: "USDC", decimals: 6 };

describe("token amounts", () => {
  it("uses each token's own decimals", () => {
    expect(formatToken(1_500_000n, usdc)).toBe("1.50 USDC");
    expect(formatToken(1_500_000_000_000_000_000n, weth)).toBe("1.5000 WETH");
  });

  it("rounds down so a balance is never overstated", () => {
    expect(formatAmount(1_999_999n, 6, 2)).toBe("1.99");
  });

  it("shows dust instead of a false zero", () => {
    expect(formatAmount(1n, 18, 2)).toBe("<0.01");
    expect(formatAmount(0n, 18, 2)).toBe("0.00");
  });

  it("groups large values", () => {
    expect(formatAmount(1_234_567n * 10n ** 18n, 18, 2)).toBe("1,234,567.00");
  });

  it("drops uninformative zeros from the hero figure", () => {
    expect(formatFigure(25n * 10n ** 16n, weth)).toBe("0.25");
    expect(formatFigure(125n * 10n ** 15n, weth)).toBe("0.125");
  });
});

describe("parseAmount", () => {
  it("reads plain decimals in token units", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount(".5", 18)).toBe(5n * 10n ** 17n);
    expect(parseAmount("0", 18)).toBe(0n);
  });

  it.each(["", ".", "abc", "1e3", "-1", "1,000", "1.2.3"])("rejects %j", (text) => {
    expect(parseAmount(text, 18)).toBeNull();
  });

  it("rejects more precision than the token holds", () => {
    expect(parseAmount("0.1234567", 6)).toBeNull();
  });
});

describe("tickets", () => {
  it("numbers tickets from one", () => {
    expect(ticketLabel(0)).toBe("#0001");
    expect(ticketLabel(1_233)).toBe("#1234");
  });

  it("joins adjacent purchases and keeps gaps", () => {
    const ranges = [
      { start: 10, end: 15 },
      { start: 0, end: 5 },
      { start: 5, end: 8 },
    ];
    expect(mergeRanges(ranges)).toEqual([
      { start: 0, end: 8 },
      { start: 10, end: 15 },
    ]);
    expect(ticketRanges(ranges)).toBe("#0001–#0008, #0011–#0015");
  });

  it("shows a lone ticket once", () => {
    expect(ticketRanges([{ start: 4, end: 5 }])).toBe("#0005");
  });
});

describe("display helpers", () => {
  it("counts down across units", () => {
    expect(countdown(0n)).toBe("now");
    expect(countdown(65n)).toBe("01:05");
    expect(countdown(3_661n)).toBe("1h 01m 01s");
    expect(countdown(90_000n)).toBe("1d 01h 00m");
  });

  it("guards an empty denominator", () => {
    expect(percent(1n, 0n)).toBe("0.00%");
    expect(percent(1n, 3n)).toBe("33.33%");
  });
});
