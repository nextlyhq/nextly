// Why: getBaseUrl resolves the public origin used in email links and in
// absolutized media URLs returned by the API. A regression in the priority
// chain (override > NEXT_PUBLIC_APP_URL > localhost) or the trailing-slash
// strip will silently break outbound links and break double-prefix detection
// in media-variant. These tests lock the rules.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv: { NEXT_PUBLIC_APP_URL?: string } = {
  NEXT_PUBLIC_APP_URL: undefined,
};
vi.mock("../env", () => ({
  get env() {
    return mockEnv;
  },
}));

import { getBaseUrl } from "../get-base-url";

beforeEach(() => {
  mockEnv.NEXT_PUBLIC_APP_URL = undefined;
});

describe("getBaseUrl", () => {
  describe("priority chain", () => {
    it("uses the override when provided", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://env.example.com";
      expect(getBaseUrl("https://override.example.com")).toBe(
        "https://override.example.com"
      );
    });

    it("falls back to env.NEXT_PUBLIC_APP_URL when override is missing", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://env.example.com";
      expect(getBaseUrl()).toBe("https://env.example.com");
    });

    it("falls back to env when override is empty string", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://env.example.com";
      expect(getBaseUrl("")).toBe("https://env.example.com");
    });

    it("falls back to env when override is whitespace-only", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://env.example.com";
      expect(getBaseUrl("   ")).toBe("https://env.example.com");
    });

    it("falls back to env when override is null", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://env.example.com";
      expect(getBaseUrl(null)).toBe("https://env.example.com");
    });

    it("falls back to localhost when nothing is set", () => {
      expect(getBaseUrl()).toBe("http://localhost:3000");
    });

    it("falls back to localhost when env is whitespace-only", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "   ";
      expect(getBaseUrl()).toBe("http://localhost:3000");
    });
  });

  describe("normalisation", () => {
    it("strips a single trailing slash", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://example.com/";
      expect(getBaseUrl()).toBe("https://example.com");
    });

    it("strips multiple trailing slashes", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://example.com///";
      expect(getBaseUrl()).toBe("https://example.com");
    });

    it("trims surrounding whitespace from env", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "  https://example.com/  ";
      expect(getBaseUrl()).toBe("https://example.com");
    });

    it("trims surrounding whitespace from override", () => {
      expect(getBaseUrl("  https://override.example.com/  ")).toBe(
        "https://override.example.com"
      );
    });

    it("preserves paths after the host", () => {
      mockEnv.NEXT_PUBLIC_APP_URL = "https://example.com/cms/";
      expect(getBaseUrl()).toBe("https://example.com/cms");
    });
  });
});
