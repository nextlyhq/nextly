import { describe, it, expect } from "vitest";

import { generateRequestId, readOrGenerateRequestId } from "./request-id";

describe("request-id", () => {
  describe("generateRequestId", () => {
    it("produces values in 'req_' + 16 lowercase base32 chars format", () => {
      const id = generateRequestId();
      expect(id).toMatch(/^req_[a-z2-7]{16}$/);
    });

    it("produces unique values across many invocations", () => {
      const ids = new Set(
        Array.from({ length: 1000 }, () => generateRequestId())
      );
      expect(ids.size).toBe(1000);
    });
  });

  describe("readOrGenerateRequestId", () => {
    it("honors x-request-id header when set by an upstream proxy or middleware", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-request-id": "req_upstream0000001" },
      });
      expect(readOrGenerateRequestId(req)).toBe("req_upstream0000001");
    });

    it("honors x-vercel-id header when x-request-id is absent", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-vercel-id": "iad1::vercel-id" },
      });
      expect(readOrGenerateRequestId(req)).toBe("iad1::vercel-id");
    });

    it("honors cf-ray header when x-request-id and x-vercel-id are absent", () => {
      const req = new Request("http://localhost/", {
        headers: { "cf-ray": "abc-123" },
      });
      expect(readOrGenerateRequestId(req)).toBe("abc-123");
    });

    it("generates when no recognized header is present", () => {
      const req = new Request("http://localhost/");
      expect(readOrGenerateRequestId(req)).toMatch(/^req_[a-z2-7]{16}$/);
    });

    it("prefers x-request-id over x-vercel-id and cf-ray", () => {
      const req = new Request("http://localhost/", {
        headers: {
          "x-request-id": "req_a",
          "x-vercel-id": "v_b",
          "cf-ray": "cf_c",
        },
      });
      expect(readOrGenerateRequestId(req)).toBe("req_a");
    });

    it("prefers x-vercel-id over cf-ray when x-request-id is absent", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-vercel-id": "v_b", "cf-ray": "cf_c" },
      });
      expect(readOrGenerateRequestId(req)).toBe("v_b");
    });
  });
});
