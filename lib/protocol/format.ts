import { formatUnits, parseUnits } from "viem";

const GROUPED = new Intl.NumberFormat("en-US");

export function groupDigits(value: bigint | number): string {
  return GROUPED.format(value);
}

/** Display precision is per asset. WETH needs more places than a low-priced token. */
export function displayPlaces(symbol: string): number {
  return symbol === "WETH" ? 4 : 2;
}

/** Rounds down, so a displayed balance is never more than the real one. */
export function formatAmount(value: bigint, decimals: number, places: number): string {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const kept = fraction.slice(0, places).padEnd(places, "0");
  if (value > 0n && BigInt(whole) === 0n && /^0*$/.test(kept)) {
    return `<0.${"0".repeat(Math.max(places - 1, 0))}1`;
  }
  const grouped = GROUPED.format(BigInt(whole));
  return places > 0 ? `${grouped}.${kept}` : grouped;
}

export function formatToken(value: bigint, token: { decimals: number; symbol: string }): string {
  return `${formatAmount(value, token.decimals, displayPlaces(token.symbol))} ${token.symbol}`;
}

/** The hero figure drops zeros that carry no information, keeping at least two places. */
export function formatFigure(value: bigint, token: { decimals: number; symbol: string }): string {
  const full = formatAmount(value, token.decimals, displayPlaces(token.symbol));
  if (full.startsWith("<")) return full;
  const [whole, fraction = ""] = full.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}

/** Returns null for anything that isn't a plain positive-or-zero decimal the token can hold. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const value = text.trim();
  if (!/^\d*\.?\d*$/.test(value) || value === "" || value === ".") return null;
  const [, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return parseUnits(value, decimals);
}

export function ticketLabel(index: number): string {
  return `#${String(index + 1).padStart(4, "0")}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function channelLabel(version: bigint): string {
  return String(version).padStart(2, "0");
}

export function countdown(seconds: bigint): string {
  if (seconds <= 0n) return "now";
  const total = Number(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours) return `${hours}h ${pad(minutes)}m ${pad(rest)}s`;
  return `${pad(minutes)}:${pad(rest)}`;
}

export function roundedDuration(seconds: bigint): string {
  const minutes = Math.ceil(Number(seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

export type TicketRange = Readonly<{ start: number; end: number }>;

/** Joins ranges from separate purchases that happen to be adjacent. */
export function mergeRanges(ranges: readonly TicketRange[]): TicketRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: TicketRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && last.end === range.start) {
      merged[merged.length - 1] = { start: last.start, end: range.end };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function ticketRanges(ranges: readonly TicketRange[]): string {
  return mergeRanges(ranges)
    .map(({ start, end }) =>
      end - start === 1 ? ticketLabel(start) : `${ticketLabel(start)}–${ticketLabel(end - 1)}`
    )
    .join(", ");
}

export function ticketTotal(ranges: readonly TicketRange[]): number {
  return ranges.reduce((total, { start, end }) => total + end - start, 0);
}

export function percent(numerator: bigint, denominator: bigint, places = 2): string {
  if (denominator === 0n) return `${(0).toFixed(places)}%`;
  const scale = 10n ** BigInt(places + 2);
  const scaled = (numerator * scale) / denominator;
  return `${(Number(scaled) / 10 ** places).toFixed(places)}%`;
}
