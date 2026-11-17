/**
 * The `site-forms` service a routed page reads to fill `ctx.forms`: the
 * address forms post to, which stored documents a form's post can name, and
 * a picked form as the public reads it.
 */
import type { FormProvider } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it, vi } from "vitest";

import { parseDefiningDocument } from "./defining-document";
import { createFormProviders } from "./providers";
import { FORM_ACTION, siteForms } from "./site-forms";

const SELF = {
  name: "@nextlyhq/plugin-page-builder",
  collections: { pages: "site-pages" },
  singles: {},
};

function service(provider?: FormProvider) {
  const providers = createFormProviders();
  const registry = providers.start();
  if (provider !== undefined) registry.register(provider);
  const forms = siteForms({
    providers,
    componentStore: { field: "content" },
  });
  forms.start(SELF);
  return forms.service();
}

describe("the site's forms service", () => {
  it("posts every form to the receiver under the scaffold's mount", () => {
    expect(FORM_ACTION).toBe(
      "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send"
    );
    expect(service().action).toBe(FORM_ACTION);
  });

  it("posts under the app's base path, where it is served under one", () => {
    vi.stubEnv("__NEXT_ROUTER_BASEPATH", "/site");
    try {
      expect(service().action).toBe(`/site${FORM_ACTION}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serves a provider's script under the app's base path, as its post is", async () => {
    // A provider names its script by the API mount alone; under a base path
    // the browser finds it only below that path, as it finds the form's post.
    const module = "/admin/api/plugins/forms/bot-check.js";
    const provider: FormProvider = {
      id: "forms",
      label: "Forms",
      list: async () => [],
      describe: async ref => ({
        ref,
        title: "Quote",
        fields: [],
        submitText: "Send",
        afterSending: { kind: "message", message: "Thanks" },
        encoding: "urlencoded",
        script: { module, reason: "Draws the bot check." },
      }),
      accept: async () => ({ kind: "sent" }),
    };
    vi.stubEnv("__NEXT_ROUTER_BASEPATH", "/site");
    try {
      const described = await service(provider).describe({
        provider: "forms",
        ref: "quote",
      });
      expect(
        "script" in described ? described.script?.module : undefined
      ).toBe(`/site${module}`);
    } finally {
      vi.unstubAllEnvs();
    }
    // Served at the root, the address is the provider's own.
    const atRoot = await service(provider).describe({
      provider: "forms",
      ref: "quote",
    });
    expect("script" in atRoot ? atRoot.script?.module : undefined).toBe(
      module
    );
  });

  it("names the documents the receiver reads, under the host's names", () => {
    const forms = service();
    const named = forms.documentOf({
      collection: "site-pages",
      id: "p1",
      field: "content",
    });
    expect(named).toBe("page:p1");
    // What it names, the receiver reads back.
    expect(parseDefiningDocument(named)).toEqual({ kind: "page", id: "p1" });
    expect(
      forms.documentOf({ collection: "templates", id: "t1", field: "" })
    ).toBe("template:t1");
    expect(forms.componentDocument("c1")).toBe("component:c1");
    // An entry its design draws: named as the entry, which the receiver
    // draws as its page does.
    expect(
      forms.documentOf({
        collection: "posts",
        id: "e1",
        field: "",
        design: true,
      })
    ).toBe("entry:posts:e1");
    expect(parseDefiningDocument("entry:posts:e1")).toEqual({
      kind: "entry",
      collection: "posts",
      id: "e1",
    });
  });

  it("names nothing for a document the receiver cannot read a form from", () => {
    const forms = service();
    for (const row of [
      // The declared name, which the host renamed.
      { collection: "pages", id: "p1", field: "content" },
      // Another field of a page.
      { collection: "site-pages", id: "p1", field: "summary" },
      // A collection the page builder does not own.
      { collection: "posts", id: "x", field: "content" },
    ]) {
      expect(forms.documentOf(row), JSON.stringify(row)).toBeUndefined();
    }
  });

  it("describes a picked form as the public reads it", async () => {
    const describe = vi.fn(async () => ({
      unavailable: "closed" as const,
      message: "Closed.",
    }));
    const forms = service({
      id: "acme",
      label: "Acme",
      list: async () => [],
      describe,
      accept: async () => ({ kind: "failed" }),
    });
    expect(await forms.describe({ provider: "acme", ref: "r1" }, "de")).toEqual(
      {
        unavailable: "closed",
        message: "Closed.",
      }
    );
    expect(describe).toHaveBeenCalledWith("r1", {
      access: { as: "public" },
      locale: "de",
    });
  });

  it("answers a form whose provider is not installed as gone", async () => {
    expect(
      await service().describe({ provider: "gone", ref: "r1" }, undefined)
    ).toEqual({ unavailable: "missing" });
  });
});
