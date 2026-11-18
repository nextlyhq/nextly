/**
 * The page check providers: what another plugin may register, that a boot
 * forgets the last boot's, and that a malformed one or a repeated id stops
 * the boot that named it.
 */
import type { PageCheckProvider } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it } from "vitest";

import { createPageCheckProviders } from "./page-check-providers";

const provider = (
  id: string,
  group: PageCheckProvider["group"] = "search"
): PageCheckProvider => ({ id, group, check: () => Promise.resolve([]) });

describe("the page check providers", () => {
  it("holds what plugins register, in order", () => {
    const providers = createPageCheckProviders();
    const service = providers.start();
    service.register(provider("seo"));
    service.register(provider("fixture", "content"));
    expect(providers.all().map(each => each.id)).toEqual(["seo", "fixture"]);
  });

  it("forgets the last boot's providers when a boot starts", () => {
    const providers = createPageCheckProviders();
    providers.start().register(provider("seo"));
    providers.start();
    expect(providers.all()).toEqual([]);
  });

  it("refuses a repeated id, a bad id, an unknown group or no check", () => {
    const service = createPageCheckProviders().start();
    service.register(provider("seo"));
    expect(() => service.register(provider("seo"))).toThrow(
      /Two page check providers/
    );
    expect(() => service.register(provider("Bad Id"))).toThrow(/needs an id/);
    expect(() =>
      service.register({ ...provider("x"), group: "style" as never })
    ).toThrow(/needs a group/);
    expect(() =>
      service.register({
        id: "y",
        group: "search",
      } as unknown as PageCheckProvider)
    ).toThrow(/needs a check function/);
  });
});
