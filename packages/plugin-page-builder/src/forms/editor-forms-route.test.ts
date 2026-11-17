/**
 * The editor's form routes: the picker's list and the canvas's describe,
 * each read with the author's own access and nothing more.
 */
import type {
  FormAccess,
  FormDescription,
  FormListing,
  FormProvider,
} from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it, vi } from "vitest";

import {
  authorAccess,
  describeEditorForm,
  editorFormsRoutes,
  listEditorForms,
} from "./editor-forms-route";
import { createFormProviders } from "./providers";

const AUTHOR = { id: "u1", email: "a@example.com" } as never;
const AS_AUTHOR: FormAccess = { as: "user", user: AUTHOR };

const QUOTE: FormDescription = {
  ref: "7",
  title: "Request a quote",
  fields: [{ name: "email", label: "Email", kind: "email", required: true }],
  submitText: "Send",
  afterSending: { kind: "message", message: "Thanks" },
  encoding: "urlencoded",
};

/** A provider whose forms each reader sees as `rows` says. */
function provider(
  rows: {
    listing: FormListing;
    asAuthor?: FormDescription | { unavailable: "closed" | "missing" };
    asVisitor?:
      | FormDescription
      | { unavailable: "closed" | "missing"; message?: string };
  }[],
  extra: Partial<FormProvider> = {}
): FormProvider {
  return {
    id: "forms",
    label: "Forms",
    list: vi.fn(async (access: FormAccess) =>
      access.as === "user" ? rows.map(row => row.listing) : []
    ),
    describe: vi.fn(async (ref: string, { access }: { access: FormAccess }) => {
      const row = rows.find(each => each.listing.ref === ref);
      if (row === undefined) return { unavailable: "missing" as const };
      return access.as === "public"
        ? (row.asVisitor ?? { unavailable: "missing" as const })
        : (row.asAuthor ?? { unavailable: "missing" as const });
    }),
    accept: async () => ({ kind: "failed" }),
    ...extra,
  };
}

function registered(...providers: FormProvider[]) {
  const set = createFormProviders();
  const service = set.start();
  for (const each of providers) service.register(each);
  return set;
}

describe("listing the forms an author may pick", () => {
  it("asks each provider as the author, and passes on what it lists", async () => {
    const forms = provider([
      {
        listing: {
          ref: "7",
          title: "Request a quote",
          state: "draft",
          editHref: "/admin/collections/forms/7",
        },
      },
    ]);
    const answer = await listEditorForms(registered(forms), AS_AUTHOR);

    expect(forms.list).toHaveBeenCalledWith(AS_AUTHOR);
    expect(answer).toEqual({
      providers: [
        {
          id: "forms",
          label: "Forms",
          forms: [
            {
              ref: "7",
              title: "Request a quote",
              state: "draft",
              editHref: "/admin/collections/forms/7",
            },
          ],
        },
      ],
    });
  });

  it("asks no provider when there is no one to read as", async () => {
    const forms = provider([]);
    expect(await listEditorForms(registered(forms), undefined)).toEqual({
      providers: [],
    });
    expect(forms.list).not.toHaveBeenCalled();
  });

  it("keeps a provider whose listing fails, with no forms", async () => {
    const failing = provider([], {
      list: async () => {
        throw new Error("down");
      },
    });
    expect(await listEditorForms(registered(failing), AS_AUTHOR)).toEqual({
      providers: [{ id: "forms", label: "Forms", forms: [] }],
    });
  });

  it("lists nothing on a site with no provider", async () => {
    expect(await listEditorForms(registered(), AS_AUTHOR)).toEqual({
      providers: [],
    });
  });
});

describe("describing a picked form for the canvas", () => {
  const ask = (set: ReturnType<typeof registered>, ref = "7") =>
    describeEditorForm(set, { provider: "forms", ref }, AS_AUTHOR);

  it("draws a published form from the author's description", async () => {
    const forms = provider([
      {
        listing: { ref: "7", title: "Quote", state: "published" },
        asAuthor: QUOTE,
        asVisitor: QUOTE,
      },
    ]);
    expect(await ask(registered(forms))).toEqual({
      state: "published",
      drawing: QUOTE,
    });
    expect(forms.describe).toHaveBeenCalledWith("7", { access: AS_AUTHOR });
  });

  it("draws a draft, which only its author can read, and says it is one", async () => {
    const forms = provider([
      {
        listing: { ref: "7", title: "Quote", state: "draft" },
        asAuthor: QUOTE,
      },
    ]);
    expect(await ask(registered(forms))).toEqual({
      state: "draft",
      drawing: QUOTE,
    });
  });

  it("says a closed form is closed, with the words a visitor reads", async () => {
    const forms = provider([
      {
        listing: { ref: "7", title: "Quote", state: "published" },
        asAuthor: QUOTE,
        asVisitor: { unavailable: "closed", message: "Entries are closed." },
      },
    ]);
    expect(await ask(registered(forms))).toEqual({
      state: "closed",
      message: "Entries are closed.",
    });
  });

  it("says a form the author cannot read, or that was deleted, is missing", async () => {
    const forms = provider([]);
    expect(await ask(registered(forms), "8")).toEqual({ state: "missing" });
  });

  it("says a form of a provider the site no longer has is missing", async () => {
    expect(await ask(registered())).toEqual({ state: "missing" });
  });

  it("asks no provider when there is no one to read as", async () => {
    const forms = provider([]);
    expect(
      await describeEditorForm(
        registered(forms),
        { provider: "forms", ref: "7" },
        undefined
      )
    ).toEqual({ state: "missing" });
    expect(forms.describe).not.toHaveBeenCalled();
  });
});

describe("the routes", () => {
  it("are signed-in routes whose providers judge each caller", () => {
    const routes = editorFormsRoutes(registered());
    expect(routes.list).toMatchObject({ method: "GET", checksAccess: true });
    expect(routes.describe).toMatchObject({
      method: "GET",
      checksAccess: true,
    });
    expect(routes.list.path).not.toBe(routes.describe.path);
  });

  it("read as the caller, an API key's own scope included", () => {
    const scope = { kind: "api-key" } as never;
    expect(authorAccess({ user: AUTHOR, authenticatedScope: scope })).toEqual({
      as: "user",
      user: AUTHOR,
      authenticatedScope: scope,
    });
    expect(authorAccess({ user: null })).toBeUndefined();
  });

  it("answers a provider's failure as a failure, never as a deleted form", async () => {
    const failing = provider([], {
      describe: async () => {
        throw new Error("down");
      },
    });
    const response = await editorFormsRoutes(
      registered(failing)
    ).describe.handler(new Request("http://site/x?provider=forms&ref=7"), {
      user: AUTHOR,
    } as never);
    expect(response.status).toBe(502);
  });
});
