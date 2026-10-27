/**
 * What a media cleanup log may show of a failure: the file, never a secret
 * a signed or tokenized URL, or a message quoting one, can carry.
 */
import { describe, expect, it } from "vitest";

import { errorForLog, storedPathForLog } from "../remove-stored-files";

describe("errorForLog", () => {
  it.each([
    [
      "a URL with credentials, a signed query and a fragment",
      "refused https://id:key-secret@bucket.example/a.png?X-Amz-Signature=sig-secret#frag-secret",
      "refused https://bucket.example/a.png",
    ],
    [
      "a URL without a scheme",
      "refused //bucket.example/a.png?token=token-secret",
      "refused //bucket.example/a.png",
    ],
    [
      "a query outside a URL",
      "request failed with X-Amz-Credential=cred-secret&token=token-secret in it",
      "request failed with X-Amz-Credential=[redacted] in it",
    ],
    [
      "a credential named on its own",
      "refused: access_token=token-secret was rejected",
      "refused: access_token=[redacted] was rejected",
    ],
  ])("drops the secrets of %s", (_shape, message, expected) => {
    const said = errorForLog(new Error(message));
    expect(said).not.toMatch(/secret/);
    expect(said).toBe(expected);
  });

  it.each([
    ["X-Api-Key: header-secret-1 while removing", "header-secret-1"],
    ['upstream said {"token":"json-secret-2"}', "json-secret-2"],
    ["Rejected Bearer bearer-secret-3 for this bucket", "bearer-secret-3"],
  ])("keeps a credential's name joined to its value: %s", (message, secret) => {
    const said = errorForLog(new Error(message));
    // The control: the words around it are still said.
    expect(said.length).toBeGreaterThan(10);
    expect(said).not.toContain(secret);
  });

  it("logs nothing of a thrown value that is not an error", () => {
    expect(errorForLog({ token: "token-secret" })).not.toMatch(/secret/);
  });
});

describe("storedPathForLog", () => {
  it("keeps a stored path's spelling, without its query", () => {
    expect(storedPathForLog("2026/10/a b.png?v=1")).toBe("2026/10/a b.png");
  });
});
