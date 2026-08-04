/**
 * The validator boot runs, and the shapes that survive JSON only by accident.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";
import { assertClientConfigs } from "./validate-client-config";

const plugin = (clientConfig: unknown): PluginDefinition =>
  ({
    name: "@acme/p",
    version: "1.0.0",
    nextly: "*",
    contributes: { admin: { clientConfig } },
  }) as unknown as PluginDefinition;

describe("client config is validated at boot", () => {
  it("fails plugin resolution, not the first admin-meta request", () => {
    // The contract promises a boot error. Validating only where the metadata is
    // serialized would let the app start healthy and then take the entire
    // branding response down when the admin first asks for it.
    expect(() =>
      resolvePlugins([plugin({ when: new Date() })], {
        coreVersion: "0.0.2-alpha.51",
      })
    ).toThrow(NextlyError);
  });

  it("checks a disabled plugin too, whose config is serialized as well", () => {
    const disabled = {
      ...plugin({ fn: () => 1 }),
      enabled: false,
    } as PluginDefinition;
    expect(() => assertClientConfigs([disabled])).toThrow(NextlyError);
  });

  it("lets a valid config through", () => {
    expect(() =>
      assertClientConfigs([plugin({ remotePatterns: [{ hostname: "a.io" }] })])
    ).not.toThrow();
  });
});

describe("shapes that survive JSON only by accident", () => {
  it("refuses a getter that throws on the second read", () => {
    // `JSON.stringify` reads each property once and the comparison reads it
    // again. A getter that answers once and then throws would escape the
    // validator as a raw exception rather than as a configuration error.
    let reads = 0;
    const config = {
      get flaky(): number {
        reads += 1;
        if (reads > 1) throw new Error("second read");
        return 1;
      },
    };
    expect(() => assertClientConfigs([plugin(config)])).toThrow(NextlyError);
  });

  it("refuses an own key JSON cannot carry", () => {
    // Invisible to `Object.keys` on both sides, so a comparison of enumerable
    // string keys alone would certify the decoded object as unchanged while the
    // component that placed them finds them gone.
    const withSymbol = { a: 1, [Symbol("s")]: 2 };
    expect(() => assertClientConfigs([plugin(withSymbol)])).toThrow(
      NextlyError
    );

    const withHidden: Record<string, unknown> = { a: 1 };
    Object.defineProperty(withHidden, "hidden", {
      value: 2,
      enumerable: false,
    });
    expect(() => assertClientConfigs([plugin(withHidden)])).toThrow(
      NextlyError
    );
  });

  it("still accepts arrays, whose own keys include a non-enumerable length", () => {
    expect(() =>
      assertClientConfigs([
        plugin({ list: [1, 2, 3], nested: [{ a: [true] }] }),
      ])
    ).not.toThrow();
  });
});

describe("arrays are not a blanket exemption", () => {
  it("refuses an array carrying an own key JSON cannot hold", () => {
    // The `length` descriptor is discounted because JSON carries the array's
    // shape; anything hung beside it is dropped exactly like a symbol key on a
    // plain object, and was previously waved through by exempting arrays.
    const withSymbol = [1, 2, 3] as unknown as Record<string, unknown>;
    (withSymbol as unknown as Record<symbol, unknown>)[Symbol("s")] = 1;
    expect(() => assertClientConfigs([plugin({ list: withSymbol })])).toThrow(
      NextlyError
    );

    const withHidden = [1, 2, 3];
    Object.defineProperty(withHidden, "hidden", {
      value: 2,
      enumerable: false,
    });
    expect(() => assertClientConfigs([plugin({ list: withHidden })])).toThrow(
      NextlyError
    );
  });

  it("still accepts an ordinary array", () => {
    expect(() =>
      assertClientConfigs([
        plugin({ list: [1, "two", { three: 3 }], empty: [] }),
      ])
    ).not.toThrow();
  });
});

describe("a hostile Proxy is still a configuration error", () => {
  it("reports a throwing prototype trap rather than leaking it", () => {
    // `Array.isArray` and `getPrototypeOf` are observable operations on a
    // Proxy, so a trap that throws would escape the validator as a raw
    // exception — from the function whose job is to report exactly this.
    const hostile = new Proxy(
      { a: 1 },
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      }
    );
    expect(() => assertClientConfigs([plugin(hostile)])).toThrow(NextlyError);
  });
});
