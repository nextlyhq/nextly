/**
 * The one definition of a credential id's shape: every id the service makes
 * matches it, the refresh token is read by it, and nothing else does.
 */
import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_ID_PATTERN,
  mintRefreshToken,
  newCredentialId,
  parseRefreshToken,
} from "../refresh-token";

describe("a credential id's shape", () => {
  it("is the shape of every id the service makes", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newCredentialId()).toMatch(CREDENTIAL_ID_PATTERN);
    }
  });

  it("is what a refresh token's id is read by", () => {
    const id = newCredentialId();
    const token = mintRefreshToken("fixture-".repeat(6), id, 3);
    expect(parseRefreshToken(token)?.credentialId).toBe(id);
  });

  it("refuses anything else", () => {
    const id = newCredentialId();
    for (const other of [
      `${id}\n`,
      ` ${id}`,
      id.toUpperCase(),
      id.replace("ncc_", "nck_"),
      `${id}0`,
      id.slice(0, -1),
      id.slice(4),
      "",
    ]) {
      expect(CREDENTIAL_ID_PATTERN.test(other), JSON.stringify(other)).toBe(
        false
      );
    }
  });
});
