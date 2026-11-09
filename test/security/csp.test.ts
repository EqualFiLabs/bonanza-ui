import { describe, expect, it } from "vitest";

import { DRAND_RELAYS } from "@/lib/chain/drand";
import {
  buildContentSecurityPolicy,
  cspResponseHeader,
  readCspConfiguration,
} from "@/lib/security/csp";

describe("content security policy", () => {
  const policy = buildContentSecurityPolicy("abc123", readCspConfiguration({}));

  it("lets the app reach the drand relays and Privy", () => {
    for (const relay of DRAND_RELAYS) expect(policy).toContain(relay);
    expect(policy).toContain("https://auth.privy.io");
  });

  it("allows no third-party scripts or fonts", () => {
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("defaults production to report-only and development to off", () => {
    expect(readCspConfiguration({ NODE_ENV: "production" }).mode).toBe("report-only");
    expect(readCspConfiguration({ NODE_ENV: "development" }).mode).toBe("off");
    expect(cspResponseHeader("enforce")).toBe("Content-Security-Policy");
    expect(cspResponseHeader("off")).toBeNull();
  });

  it("rejects an unsafe nonce", () => {
    expect(() => buildContentSecurityPolicy("a b", readCspConfiguration({}))).toThrow();
  });
});
