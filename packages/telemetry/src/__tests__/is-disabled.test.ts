import { describe, it, expect } from "vitest";

import { resolveDisabled } from "../is-disabled.js";

function mk(
  env: NodeJS.ProcessEnv = {},
  opts: Partial<{
    isTty: boolean;
    isDocker: boolean;
    enabledInConfig: boolean;
  }> = {}
) {
  return resolveDisabled({
    env,
    isTty: opts.isTty ?? true,
    isDocker: opts.isDocker ?? false,
    enabledInConfig: opts.enabledInConfig ?? true,
  });
}

describe("resolveDisabled", () => {
  it("disables when DO_NOT_TRACK=1", () => {
    expect(mk({ DO_NOT_TRACK: "1" })).toEqual({
      disabled: true,
      reason: "DO_NOT_TRACK",
    });
  });
  it("disables when NEXTLY_TELEMETRY_DISABLED=1", () => {
    expect(mk({ NEXTLY_TELEMETRY_DISABLED: "1" })).toEqual({
      disabled: true,
      reason: "env-var",
    });
  });
  it("disables when NODE_ENV=production", () => {
    expect(mk({ NODE_ENV: "production" })).toEqual({
      disabled: true,
      reason: "production",
    });
  });
  it("disables when CI is set", () => {
    expect(mk({ CI: "1" })).toEqual({ disabled: true, reason: "ci" });
  });
  it("disables inside Docker", () => {
    expect(mk({}, { isDocker: true })).toEqual({
      disabled: true,
      reason: "docker",
    });
  });
  it("disables when stdout is not a TTY", () => {
    expect(mk({}, { isTty: false })).toEqual({
      disabled: true,
      reason: "non-tty",
    });
  });
  it("disables when config says disabled", () => {
    expect(mk({}, { enabledInConfig: false })).toEqual({
      disabled: true,
      reason: "config",
    });
  });
  it("enabled when nothing says otherwise", () => {
    expect(mk()).toEqual({ disabled: false, reason: null });
  });
  it("DO_NOT_TRACK outranks everything else", () => {
    const r = mk(
      {
        DO_NOT_TRACK: "1",
        NEXTLY_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
        CI: "1",
      },
      { isTty: false, isDocker: true, enabledInConfig: false }
    );
    expect(r).toEqual({ disabled: true, reason: "DO_NOT_TRACK" });
  });
});
