type Counter = { windowStartedAt: number; count: number };

export const cspReportLimiterState = globalThis as typeof globalThis & {
  __bonanzaCspReportLimits?: Map<string, Counter>;
};

export function resetCspReportLimiterForTests(): void {
  cspReportLimiterState.__bonanzaCspReportLimits?.clear();
}
