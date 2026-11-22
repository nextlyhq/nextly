/**
 * The SEO plugin's page checks: each problem the problem list shows the
 * person editing on the page, in its own words under Search, a fix in the
 * page's SEO tab opening the builder's SEO tab, in the language asked about.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_BUILDER_TAB } from "../template/contributions";

import type { ProblemChecks, ProblemListBody } from "./check";
import { KIND_TEXT, type Problem } from "./contract";
import { findingOfProblem, seoPageChecks } from "./page-check-provider";

const listed = vi.fn<() => Promise<Problem[]>>();
const readable = vi.fn<() => Promise<Set<string>>>();
const asReader = vi.fn();
const askedTypes = vi.fn();
const readsWith = vi.fn();
const ownCheck = vi.fn<() => Promise<void>>();
vi.mock("./check", () => ({
  checkedInTurn: () => ownCheck(),
  problemList: async (_ctx: unknown, _checks: unknown, reader: unknown) => {
    asReader(reader);
    return { problems: await listed() } as Partial<ProblemListBody>;
  },
}));
vi.mock("./reader", () => ({
  readableTypesOf: (caller: unknown) => {
    askedTypes(caller);
    return readable();
  },
  readsAs: (_collections: unknown, access: unknown) => {
    readsWith(access);
    return "reads";
  },
  readerAs: (reads: string, types: Set<string>, seesRedirects: boolean) => ({
    reads,
    types: [...types],
    seesRedirects,
  }),
}));

beforeEach(() => {
  vi.useRealTimers();
  listed.mockReset();
  asReader.mockReset();
  askedTypes.mockReset();
  readsWith.mockReset();
  ownCheck.mockReset().mockResolvedValue(undefined);
  readable.mockReset().mockResolvedValue(new Set(["pages"]));
});

const subject = { type: "pages", id: "p-1", label: "Home" };

const noTitle: Problem = {
  kind: "noTitle",
  subject,
  what: "No search title",
  action: "Write a title",
  fix: { place: "page", tab: "seo" },
};

const brokenLink: Problem = {
  kind: "brokenLink",
  subject,
  what: "A link leads nowhere",
  action: "Fix the link",
  fix: { place: "page", tab: "content" },
};

const ACCESS = {
  access: { as: "user" as const, user: { id: "u", email: "u@example.com" } },
};
const PAGE = { collection: "pages", entryId: "p-1", document: null };

describe("a problem as a page check finding", () => {
  it("keeps its words, says why from its kind, and opens the SEO tab", () => {
    expect(findingOfProblem(noTitle)).toEqual({
      part: "noTitle",
      what: "No search title",
      why: KIND_TEXT.noTitle.explain,
      todo: "Write a title",
      fix: { settingsTab: PAGE_BUILDER_TAB.id },
    });
  });

  it("names no fix where it isn't in the page's SEO tab", () => {
    expect(findingOfProblem(brokenLink).fix).toBeUndefined();
  });
});

describe("the SEO page checks", () => {
  const ctx = {
    services: { collections: {} },
    publicAddresses: { defaultLanguage: async () => "en" },
  } as unknown as PluginContext;
  const provider = () => seoPageChecks(ctx, {} as ProblemChecks);

  it("lists the page's problems under Search, and no other page's", async () => {
    listed.mockResolvedValue([
      noTitle,
      { ...brokenLink, subject: { ...subject, id: "p-2" } },
      { ...brokenLink, subject: { ...subject, type: "posts" } },
      brokenLink,
    ]);
    expect(provider().group).toBe("search");
    const found = await provider().check(PAGE, ACCESS);
    expect(found.map(each => each.what)).toEqual([
      "No search title",
      "A link leads nowhere",
    ]);
  });

  it("reads the list as the person editing, who is shown no redirect", async () => {
    listed.mockResolvedValue([]);
    await provider().check(PAGE, ACCESS);
    expect(asReader).toHaveBeenCalledWith({
      reads: "reads",
      types: ["pages"],
      seesRedirects: false,
    });
  });

  it("keeps the language asked about, the default named by none", async () => {
    const fr = { ...brokenLink, subject: { ...subject, locale: "fr" } };
    listed.mockResolvedValue([noTitle, fr]);
    const inFrench = await provider().check({ ...PAGE, locale: "fr" }, ACCESS);
    expect(inFrench.map(each => each.part)).toEqual(["brokenLink"]);
    for (const locale of ["en", undefined]) {
      const found = await provider().check({ ...PAGE, locale }, ACCESS);
      expect(found.map(each => each.part)).toEqual(["noTitle"]);
    }
  });

  it("finds nothing for a page not saved, or of a type its editor may not read", async () => {
    listed.mockResolvedValue([noTitle]);
    expect(await provider().check({ ...PAGE, entryId: null }, ACCESS)).toEqual(
      []
    );
    readable.mockResolvedValue(new Set(["posts"]));
    expect(await provider().check(PAGE, ACCESS)).toEqual([]);
    expect(asReader).not.toHaveBeenCalled();
  });

  it("asks which types an API key may read with its scope, so its grants decide", async () => {
    listed.mockResolvedValue([]);
    const scope = { actorType: "apiKey" as const, permissions: ["read-pages"] };
    const access = { ...ACCESS.access, authenticatedScope: scope };
    await provider().check(PAGE, { access });
    expect(askedTypes).toHaveBeenCalledWith({
      user: ACCESS.access.user,
      authenticatedScope: scope,
    });
  });

  it("reads each entry in the language edited", async () => {
    listed.mockResolvedValue([]);
    await provider().check({ ...PAGE, locale: "fr" }, ACCESS);
    expect(readsWith).toHaveBeenCalledWith({ ...ACCESS.access, locale: "fr" });
  });

  it("reads the list once the check the page's save started has finished", async () => {
    listed.mockResolvedValue([noTitle]);
    let finish = () => {};
    ownCheck.mockReturnValue(new Promise<void>(resolve => (finish = resolve)));
    const found = provider().check(PAGE, ACCESS);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(asReader).not.toHaveBeenCalled();
    finish();
    expect((await found).map(each => each.part)).toEqual(["noTitle"]);
  });

  it("reads the list anyway once the wait for that check runs out", async () => {
    vi.useFakeTimers();
    listed.mockResolvedValue([noTitle]);
    ownCheck.mockReturnValue(new Promise<void>(() => {}));
    const found = provider().check(PAGE, ACCESS);
    await vi.advanceTimersByTimeAsync(5900);
    expect(asReader).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect((await found).map(each => each.part)).toEqual(["noTitle"]);
  });
});
