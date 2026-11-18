/**
 * A page's own code, judged on the server on every write that changes it:
 * who may change it (never a key, only someone with the site settings
 * permission, or trusted code), what can't be stored, and what the site's
 * declared policy would block unless acknowledged. A write that leaves the
 * code as stored asks none of it.
 */
import type { PluginFieldWriteCaller } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { judgeCode } from "../site-code/route";

import type { JudgedField, StoredForms } from "./added-undefined-ids";
import { PAGE_CODE_REFUSED, pageCodeIssues } from "./page-code-judgement";

/** A page holding `code`, as the blocks field stores it. */
function pageWith(code?: Record<string, string>): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [],
    ...(code === undefined ? {} : { settings: { code } }),
  };
}

/** A caller of `kind`, who may or may not change the site's settings. */
function caller(
  kind: PluginFieldWriteCaller["kind"],
  may: boolean
): PluginFieldWriteCaller & { asked: string[] } {
  const asked: string[] = [];
  return {
    kind,
    asked,
    can: (action, resource) => {
      asked.push(`${action}-${resource}`);
      return Promise.resolve(may);
    },
  };
}

/** The field's write, made as `who`. */
function writeAs(who: PluginFieldWriteCaller | undefined): JudgedField {
  return {
    path: "content",
    write: {
      kind: "collection",
      slug: "pages",
      id: "p1",
      inTransaction: false,
      readStored: () => Promise.reject(new Error("not read here")),
      readStoredOf: () => Promise.reject(new Error("not read here")),
      ...(who === undefined ? {} : { caller: who }),
    },
  };
}

/** The stored forms: none for a new page, else these documents. */
function stored(...forms: Record<string, unknown>[]) {
  return (): Promise<StoredForms> =>
    Promise.resolve({ forms: forms as never, readable: true });
}

const DEPS = { options: undefined, siteOrigin: () => "https://site.test" };
const HARMLESS = { head: "<script>window.pageCodeTest = 1</script>", body: "" };

const issuesOf = (
  value: unknown,
  who: PluginFieldWriteCaller | undefined,
  forms = stored(pageWith())
) =>
  pageCodeIssues(value, writeAs(who), "Content", DEPS, forms).then(found =>
    found.map(issue => issue.message)
  );

describe("a page's own code, judged on every write that changes it", () => {
  it("lets someone who may change the site's settings change it, asking that permission", async () => {
    const manager = caller("user", true);
    expect(await issuesOf(pageWith(HARMLESS), manager)).toEqual([]);
    expect(manager.asked).toEqual(["manage-page-builder-site"]);
    // Trusted code, which the write's own access lets through.
    expect(await issuesOf(pageWith(HARMLESS), caller("system", true))).toEqual(
      []
    );
  });

  it("refuses anyone else, an API key whatever its scope, and a write that says nobody", async () => {
    expect(await issuesOf(pageWith(HARMLESS), caller("user", false))).toEqual([
      "Content: Only people who can change site settings can change a page's code.",
    ]);
    expect(await issuesOf(pageWith(HARMLESS), caller("apiKey", true))).toEqual([
      "Content: An API key can't change a page's code. Sign in as someone who can change the site's settings.",
    ]);
    expect((await issuesOf(pageWith(HARMLESS), undefined))[0]).toMatch(
      /doesn't say who is making it/
    );
    // Removing it is a change too.
    expect(
      await issuesOf(
        pageWith(),
        caller("user", false),
        stored(pageWith(HARMLESS))
      )
    ).toHaveLength(1);
  });

  it("asks nothing of a write that leaves the code as either stored form holds it", async () => {
    const editor = caller("user", false);
    // A save of other changes, and a publish of the draft that holds it.
    expect(
      await issuesOf(
        pageWith(HARMLESS),
        editor,
        stored(pageWith(), pageWith(HARMLESS))
      )
    ).toEqual([]);
    expect(await issuesOf(pageWith(), editor)).toEqual([]);
    expect(editor.asked).toEqual([]);
    // A stored value that can't be read is no proof it is unchanged.
    expect(
      await pageCodeIssues(
        pageWith(HARMLESS),
        writeAs(editor),
        "Content",
        DEPS,
        () => Promise.resolve({ forms: [], readable: false })
      )
    ).toHaveLength(1);
  });

  it("refuses what the site code rules can't store, by name, in its place", async () => {
    const found = await issuesOf(
      pageWith({ head: "", body: "<div>not code</div>" }),
      caller("user", true)
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatch(/^Content \(end of body\): /);
    for (const issue of await pageCodeIssues(
      pageWith({ head: "", body: "<div>not code</div>" }),
      writeAs(caller("user", true)),
      "Content",
      DEPS,
      stored(pageWith())
    )) {
      expect(issue.code).toBe(PAGE_CODE_REFUSED);
    }
  });

  it("keeps code the declared policy blocks only where those findings were acknowledged", async () => {
    const options = { csp: "script-src 'self'" };
    const deps = { ...DEPS, options };
    const manager = caller("user", true);
    const judge = (code: Record<string, string>) =>
      pageCodeIssues(
        pageWith(code),
        writeAs(manager),
        "Content",
        deps,
        stored(pageWith())
      );
    expect((await judge(HARMLESS))[0]?.message).toMatch(
      /Content Security Policy would block/
    );
    const { checked } = await judgeCode(HARMLESS, DEPS.siteOrigin(), options);
    expect(checked.cspKey).not.toBeNull();
    expect(
      await judge({ ...HARMLESS, acknowledgedCsp: "not the key" })
    ).toHaveLength(1);
    expect(
      await judge({ ...HARMLESS, acknowledgedCsp: checked.cspKey ?? "" })
    ).toEqual([]);
  });
});
