import { describe, expect, it } from "vitest";

import {
  deriveCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from "./pkce";

/** The unreserved set RFC 7636 §4.1 permits in a code verifier. */
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe("generateCodeVerifier", () => {
  it("produces a 43-character verifier, the RFC 7636 minimum", () => {
    expect(generateCodeVerifier()).toHaveLength(43);
  });

  it("draws only from the unreserved character set", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCodeVerifier()).toMatch(UNRESERVED);
    }
  });

  it("never repeats across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(200);
  });
});

describe("deriveCodeChallenge", () => {
  // RFC 7636 Appendix B fixes this pair, so a change to the encoding or the
  // digest is caught against the specification rather than against ourselves.
  it("matches the RFC 7636 Appendix B test vector", () => {
    expect(
      deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("emits unpadded base64url", () => {
    const challenge = deriveCodeChallenge(generateCodeVerifier());
    expect(challenge).toHaveLength(43);
    expect(challenge).not.toContain("=");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
  });

  it("is deterministic for a given verifier", () => {
    const verifier = generateCodeVerifier();
    expect(deriveCodeChallenge(verifier)).toBe(deriveCodeChallenge(verifier));
  });

  it("differs for different verifiers", () => {
    expect(deriveCodeChallenge("a")).not.toBe(deriveCodeChallenge("b"));
  });
});

describe("generateState and generateNonce", () => {
  it("produce 43-character unreserved values", () => {
    expect(generateState()).toHaveLength(43);
    expect(generateNonce()).toHaveLength(43);
    expect(generateState()).toMatch(UNRESERVED);
    expect(generateNonce()).toMatch(UNRESERVED);
  });

  it("never repeat across calls", () => {
    const states = new Set<string>();
    const nonces = new Set<string>();
    for (let i = 0; i < 200; i++) {
      states.add(generateState());
      nonces.add(generateNonce());
    }
    expect(states.size).toBe(200);
    expect(nonces.size).toBe(200);
  });

  it("are independent of each other", () => {
    expect(generateState()).not.toBe(generateNonce());
  });
});
