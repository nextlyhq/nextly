/**
 * The allowlist arrives as JSON, so the TypeScript declaration constrains the
 * host that wrote it and not the bytes that arrive. Everything here is a shape
 * that type-checks nowhere and can still reach the hook.
 */
import { describe, expect, it, vi } from "vitest";

const clientConfig = vi.fn();
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginClientConfig: (name: string) => clientConfig(name) as unknown,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // The hook only memoizes; calling the factory directly keeps this a unit
  // test of the filtering rather than of React.
  return { ...actual, useMemo: (fn: () => unknown) => fn() };
});

const { useRemotePatterns } = await import("./useRemotePatterns");

const withConfig = (config: unknown): readonly unknown[] => {
  clientConfig.mockReturnValue(config);
  return useRemotePatterns();
};

describe("useRemotePatterns", () => {
  it("asks for its own plugin's entry", () => {
    withConfig(undefined);
    expect(clientConfig).toHaveBeenCalledWith("@nextlyhq/plugin-page-builder");
  });

  it("is empty when nothing is configured, which refuses every remote host", () => {
    expect(withConfig(undefined)).toEqual([]);
    expect(withConfig({})).toEqual([]);
    expect(withConfig({ remotePatterns: "not-an-array" })).toEqual([]);
  });

  it("keeps a well-formed pattern", () => {
    const pattern = {
      protocol: "https",
      hostname: "cdn.example",
      port: "443",
      pathname: "/img/**",
      search: "",
    };
    expect(withConfig({ remotePatterns: [pattern] })).toEqual([pattern]);
  });

  it("drops an entry whose optional field is the wrong type", () => {
    // Each of these type-checks nowhere and reaches the matcher if accepted:
    // `protocol` is passed to `.replace`, `pathname` to picomatch. Both throw
    // on a non-string, so the editor would crash rather than refuse a host.
    for (const bad of [
      { hostname: "cdn.example", protocol: 1 },
      { hostname: "cdn.example", protocol: "ftp" },
      { hostname: "cdn.example", pathname: null },
      { hostname: "cdn.example", port: 443 },
      { hostname: "cdn.example", search: {} },
      { hostname: "" },
      { hostname: 1 },
      {},
      null,
      "cdn.example",
    ]) {
      expect(
        withConfig({ remotePatterns: [bad] }),
        JSON.stringify(bad)
      ).toEqual([]);
    }
  });

  it("keeps the good entries beside a bad one", () => {
    const good = { hostname: "cdn.example" };
    expect(withConfig({ remotePatterns: [good, { hostname: 1 }] })).toEqual([
      good,
    ]);
  });
});
