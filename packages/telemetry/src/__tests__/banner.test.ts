import { describe, it, expect, vi } from "vitest";

import { maybeShowBanner } from "../banner.js";

function makeStream() {
  const writes: string[] = [];
  return {
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    writes,
  };
}

describe("maybeShowBanner", () => {
  it("does NOT print when disabled", () => {
    const out = makeStream();
    const markNotified = vi.fn();
    maybeShowBanner({
      disabled: true,
      notifiedAt: null,
      markNotified,
      out: out.write,
    });
    expect(out.writes).toHaveLength(0);
    expect(markNotified).not.toHaveBeenCalled();
  });
  it("does NOT print when notifiedAt is set", () => {
    const out = makeStream();
    const markNotified = vi.fn();
    maybeShowBanner({
      disabled: false,
      notifiedAt: 123,
      markNotified,
      out: out.write,
    });
    expect(out.writes).toHaveLength(0);
    expect(markNotified).not.toHaveBeenCalled();
  });
  it("prints and marks notified when enabled + notifiedAt null", () => {
    const out = makeStream();
    const markNotified = vi.fn();
    maybeShowBanner({
      disabled: false,
      notifiedAt: null,
      markNotified,
      out: out.write,
    });
    expect(out.writes.length).toBeGreaterThan(0);
    const combined = out.writes.join("");
    expect(combined).toContain("Anonymous telemetry");
    expect(combined).toContain("https://nextlyhq.com/docs/telemetry");
    expect(combined).toContain("nextly telemetry disable");
    expect(combined).toContain("NEXTLY_TELEMETRY_DISABLED=1");
    expect(markNotified).toHaveBeenCalledTimes(1);
  });
});
