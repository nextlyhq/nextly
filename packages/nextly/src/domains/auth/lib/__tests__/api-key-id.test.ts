/**
 * An API key's id verifies without a lookup, under this install's secret
 * alone: one this install minted verifies, under the current secret or a
 * retired one; an altered tag, a key made before ids, and an id another
 * install minted do not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetEnvCache } from "../../../../shared/lib/env";
import { generateApiKey } from "../../services/api-key-service";
import { mintApiKeyId, verifiedApiKeyId } from "../api-key-id";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);

function withSecrets(current: string, previous?: string): void {
  vi.stubEnv("NEXTLY_SECRET", current);
  vi.stubEnv("NEXTLY_SECRET_PREVIOUS", previous ?? "");
  _resetEnvCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
});

const secretPart = "x".repeat(43);

describe("verifiedApiKeyId", () => {
  it("verifies the id of a key this install made", () => {
    withSecrets(SECRET_A);
    const { fullKey } = generateApiKey();
    const id = fullKey.slice(8, 32);
    expect(verifiedApiKeyId(fullKey)).toBe(id);
  });

  it("refuses an id whose tag was altered", () => {
    withSecrets(SECRET_A);
    const id = mintApiKeyId();
    const flipped = `${id.slice(0, 23)}${id[23] === "0" ? "1" : "0"}`;
    expect(verifiedApiKeyId(`nx_live_${flipped}_${secretPart}`)).toBeNull();
  });

  it("finds no id in a key made before ids, or in any other string", () => {
    withSecrets(SECRET_A);
    expect(verifiedApiKeyId(`nx_live_${secretPart}`)).toBeNull();
    expect(verifiedApiKeyId("Bearer something")).toBeNull();
    expect(verifiedApiKeyId(`nx_live_${mintApiKeyId()}_short`)).toBeNull();
  });

  it("refuses an id another install's secret made", () => {
    withSecrets(SECRET_B);
    const foreign = mintApiKeyId();
    withSecrets(SECRET_A);
    expect(verifiedApiKeyId(`nx_live_${foreign}_${secretPart}`)).toBeNull();
  });

  it("keeps verifying an id across a rotation, while the old secret is listed as previous", () => {
    withSecrets(SECRET_A);
    const id = mintApiKeyId();
    withSecrets(SECRET_B, SECRET_A);
    expect(verifiedApiKeyId(`nx_live_${id}_${secretPart}`)).toBe(id);
    withSecrets(SECRET_B);
    expect(verifiedApiKeyId(`nx_live_${id}_${secretPart}`)).toBeNull();
  });
});
