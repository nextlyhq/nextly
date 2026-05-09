import { afterEach, describe, expect, it } from "vitest";

import { getAttachmentLimits } from "../services/attachment-limits";

describe("getAttachmentLimits", () => {
  afterEach(() => {
    delete process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_COUNT;
    delete process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_TOTAL_BYTES;
  });

  it("returns defaults when env vars are unset", () => {
    expect(getAttachmentLimits()).toEqual({
      maxCount: 10,
      maxTotalBytes: 20 * 1024 * 1024,
    });
  });

  it("honors override env vars when valid", () => {
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_COUNT = "5";
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_TOTAL_BYTES = "1048576";
    expect(getAttachmentLimits()).toEqual({
      maxCount: 5,
      maxTotalBytes: 1048576,
    });
  });

  it("falls back to defaults on non-numeric values", () => {
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_COUNT = "not-a-number";
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_TOTAL_BYTES = "also-bad";
    expect(getAttachmentLimits()).toEqual({
      maxCount: 10,
      maxTotalBytes: 20 * 1024 * 1024,
    });
  });

  it("falls back to defaults on non-positive values", () => {
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_COUNT = "-5";
    process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_TOTAL_BYTES = "0";
    expect(getAttachmentLimits()).toEqual({
      maxCount: 10,
      maxTotalBytes: 20 * 1024 * 1024,
    });
  });
});
