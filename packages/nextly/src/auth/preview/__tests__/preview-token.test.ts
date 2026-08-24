import { hkdfSync } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import { signAccessToken } from "../../jwt/sign";
import { verifyAccessToken } from "../../jwt/verify";
import {
  DEFAULT_PREVIEW_TTL_SECONDS,
  previewTokenCovers,
  signPreviewToken,
  verifyPreviewToken,
} from "../preview-token";

const TEST_SECRET = "preview-test-secret-at-least-32-characters-long!!";
const GENERATION = 1;

const SCOPE = { collection: "pages", entryId: "entry-1" };

describe("preview tokens", () => {
  it("authorizes the document it was minted for", async () => {
    const { token, expiresAt } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
      minter: "minter-1",
    });

    const result = await verifyPreviewToken(token, TEST_SECRET, {
      generation: GENERATION,
    });

    expect(result).toMatchObject({ valid: true, scope: SCOPE });
    // The reported expiry must BE the claim, not a second clock reading taken
    // after signing: a caller shows this to a user as when their link dies.
    expect(result.valid && result.expiresAt.getTime()).toBe(
      expiresAt.getTime()
    );
  });

  it("defaults to a short life rather than an open-ended one", async () => {
    const before = Date.now();
    const { expiresAt } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
      minter: "minter-1",
    });

    const lifetimeSeconds = (expiresAt.getTime() - before) / 1000;
    expect(lifetimeSeconds).toBeLessThanOrEqual(
      DEFAULT_PREVIEW_TTL_SECONDS + 2
    );
    expect(lifetimeSeconds).toBeGreaterThan(0);
  });

  describe("separation from session tokens", () => {
    it("is not accepted as a session token", async () => {
      // The failure this prevents is the serious one: a preview link is handed
      // to a reviewer who is not a user, so a token that could pass as a
      // session cookie would turn "see this page" into an account.
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
        minter: "minter-1",
      });

      const asSession = await verifyAccessToken(token, TEST_SECRET);

      expect(asSession.valid).toBe(false);
    });

    it("does not accept a session token", async () => {
      const session = await signAccessToken(
        { sub: "user-1", email: "a@b.c", name: "A", image: null, roleIds: [] },
        TEST_SECRET
      );

      const asPreview = await verifyPreviewToken(session, TEST_SECRET, {
        generation: GENERATION,
      });

      expect(asPreview).toEqual({ valid: false, reason: "invalid" });
    });
  });

  describe("refusals", () => {
    it("refuses a token signed with a different secret", async () => {
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
        minter: "minter-1",
      });

      const result = await verifyPreviewToken(token, `${TEST_SECRET}-other`, {
        generation: GENERATION,
      });

      expect(result).toEqual({ valid: false, reason: "invalid" });
    });

    it("refuses a tampered payload", async () => {
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
        minter: "minter-1",
      });
      const [header, payload, signature] = token.split(".");
      const decoded = JSON.parse(
        Buffer.from(payload!, "base64url").toString("utf8")
      ) as Record<string, unknown>;
      // Repointing the token at another entry is the attack, so it is the one
      // asserted rather than a random byte flip.
      decoded.eid = "entry-2";
      const forged = [
        header,
        Buffer.from(JSON.stringify(decoded)).toString("base64url"),
        signature,
      ].join(".");

      const result = await verifyPreviewToken(forged, TEST_SECRET, {
        generation: GENERATION,
      });

      expect(result).toEqual({ valid: false, reason: "invalid" });
    });

    it("refuses an expired token, distinguishably", async () => {
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        ttlSeconds: 1,
        generation: GENERATION,
        minter: "minter-1",
      });

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date(Date.now() + 5_000));
        const result = await verifyPreviewToken(token, TEST_SECRET, {
          generation: GENERATION,
        });
        // A caller tells the holder their link has run out rather than that it
        // was never valid, so the reason has to survive.
        expect(result).toEqual({ valid: false, reason: "expired" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses every outstanding token once the generation moves", async () => {
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
        minter: "minter-1",
      });

      const result = await verifyPreviewToken(token, TEST_SECRET, {
        generation: GENERATION + 1,
      });

      expect(result).toEqual({ valid: false, reason: "revoked" });
    });

    it("reports a malformed token as invalid rather than revoked", async () => {
      // The two need different answers: one is "your link was cancelled", the
      // other is "this is not a link". Order of the checks is what decides it.
      const { token } = await signPreviewToken(
        { collection: "", entryId: "" },
        TEST_SECRET,
        { generation: GENERATION + 1, minter: "minter-1" }
      );

      const result = await verifyPreviewToken(token, TEST_SECRET, {
        generation: GENERATION,
      });

      expect(result).toEqual({ valid: false, reason: "invalid" });
    });
  });

  describe("a locale that is present but unusable", () => {
    it("refuses to mint a token carrying an empty locale", async () => {
      // Verification reads an unreadable locale as ABSENT, and an absent locale
      // covers every locale — so minting one would quietly widen a
      // locale-specific link into an all-locales grant.
      // Asserted on the structured error rather than its message: the public
      // message is deliberately generic, and the field name is the part a
      // caller acts on.
      await expect(
        signPreviewToken({ ...SCOPE, locale: "" }, TEST_SECRET, {
          generation: GENERATION,
          minter: "minter-1",
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: { errors: [{ path: "locale", code: "INVALID_FORMAT" }] },
      });
    });

    it("refuses a token whose locale claim is unusable", async () => {
      // Minted around the guard, the way a token from an older writer or a
      // hand-built one would arrive.
      const forged = await new SignJWT({
        col: SCOPE.collection,
        eid: SCOPE.entryId,
        loc: "",
        gen: GENERATION,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("nextly:preview")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(
          new Uint8Array(
            hkdfSync("sha256", TEST_SECRET, "", "nextly:preview-token:v1", 32)
          )
        );

      const result = await verifyPreviewToken(forged, TEST_SECRET, {
        generation: GENERATION,
      });

      // Widening is the one direction a scope check must never fail in, so an
      // unreadable locale is refused rather than dropped.
      expect(result).toEqual({ valid: false, reason: "invalid" });
    });
  });

  describe("what a token covers", () => {
    it("covers only its own document", async () => {
      expect(previewTokenCovers(SCOPE, SCOPE)).toBe(true);
      expect(
        previewTokenCovers(SCOPE, { collection: "pages", entryId: "entry-2" })
      ).toBe(false);
      // Same id in a different collection is a different document.
      expect(
        previewTokenCovers(SCOPE, { collection: "posts", entryId: "entry-1" })
      ).toBe(false);
    });

    it("restricts to one locale when it names one", async () => {
      const german = { ...SCOPE, locale: "de" };

      expect(previewTokenCovers(german, german)).toBe(true);
      // A reviewer sent the German draft must not read the French one.
      expect(previewTokenCovers(german, { ...SCOPE, locale: "fr" })).toBe(
        false
      );
      expect(previewTokenCovers(german, SCOPE)).toBe(false);
    });

    it("covers any locale when it names none", async () => {
      expect(previewTokenCovers(SCOPE, { ...SCOPE, locale: "de" })).toBe(true);
      expect(previewTokenCovers(SCOPE, SCOPE)).toBe(true);
    });
  });
});
