/**
 * The providers a site has, and the `forms` service a plugin adds one
 * through: what is refused at registration, and what a new boot forgets.
 */
import type { FormProvider } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import {
  createFormProviders,
  FORM_SERVICE,
  SIMPLE_FORM_PROVIDER,
} from "./providers";

function provider(id: string, extra: Partial<FormProvider> = {}): FormProvider {
  return {
    id,
    label: "Acme",
    list: async () => [],
    describe: async () => ({ unavailable: "missing" }),
    accept: async () => ({ kind: "failed" }),
    ...extra,
  };
}

describe("registering a provider", () => {
  it("makes it the one its id reaches", () => {
    const providers = createFormProviders();
    const acme = provider("acme");
    providers.start().register(acme);

    expect(providers.get("acme")).toBe(acme);
    expect(providers.get("other")).toBeUndefined();
  });

  it("refuses a second provider under one id, keeping the first", () => {
    const providers = createFormProviders();
    const service = providers.start();
    const first = provider("acme");
    service.register(first);

    expect(() => service.register(provider("acme"))).toThrow(/"acme"/);
    expect(providers.get("acme")).toBe(first);
  });

  it("refuses the page builder's own id", () => {
    const service = createFormProviders().start();
    expect(() => service.register(provider(SIMPLE_FORM_PROVIDER))).toThrow(
      /page builder's own/
    );
  });

  it.each([
    ["no id", { id: "" }],
    ["an id with capitals", { id: "Acme" }],
    ["an id too long", { id: "a".repeat(65) }],
    ["no label", { label: " " }],
    ["no accept", { accept: undefined }],
    ["no describe", { describe: "x" }],
  ])("refuses a provider with %s", (_, extra) => {
    const service = createFormProviders().start();
    expect(() =>
      service.register({
        ...provider("acme"),
        ...extra,
      } as unknown as FormProvider)
    ).toThrow(/form provider/);
  });
});

describe("a new boot", () => {
  it("forgets the providers the last one registered", () => {
    const providers = createFormProviders();
    providers.start().register(provider("acme"));
    providers.start();

    expect(providers.get("acme")).toBeUndefined();
  });
});

describe("the plugin's forms service", () => {
  it("is offered under its name", () => {
    const services = pageBuilder().contributes?.services ?? {};
    const factory = services[FORM_SERVICE];
    expect(typeof factory).toBe("function");

    const service = (factory as (ctx: never) => { register: unknown })(
      {} as never
    );
    expect(typeof service.register).toBe("function");
  });
});
