/**
 * Each write the conversion will make is asked as it would be sent: the
 * field it sets with the value it sets there, the status it names, and its
 * language, so a field rule reading `data` judges the write's own body.
 */
import type { PluginWriteCheck } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { mayMake } from "./judge";

const CONVERTED = { formatVersion: 1, kind: "page", nodes: [] };

/** A write check that records what it was asked, answering `answer`. */
function checks(answer: () => Promise<boolean> = async () => true) {
  const asked: PluginWriteCheck[] = [];
  const mayWrite = async (check: PluginWriteCheck) => {
    asked.push(check);
    return answer();
  };
  return { asked, mayWrite };
}

describe("a planned write, asked as it would be sent", () => {
  it("names the field with its new value, the status and the language", async () => {
    const { asked, mayWrite } = checks();

    const allowed = await mayMake(mayWrite, {
      host: {
        kind: "collection",
        slug: "pages",
        id: "7",
        path: ["content"],
        locale: "de",
      },
      value: CONVERTED,
      status: "published",
    });

    expect(allowed).toBe(true);
    expect(asked).toEqual([
      {
        collection: "pages",
        id: "7",
        status: "published",
        data: { content: CONVERTED },
        locale: "de",
      },
    ]);
  });

  it("names no status for a write that names none", async () => {
    const { asked, mayWrite } = checks();

    await mayMake(mayWrite, {
      host: { kind: "single", slug: "home", path: ["content"] },
      value: CONVERTED,
    });

    expect(asked).toEqual([{ single: "home", data: { content: CONVERTED } }]);
  });

  it("answers no for a refused check, one that throws, and a host below a group", async () => {
    const write = {
      host: { kind: "single" as const, slug: "home", path: ["content"] },
      value: CONVERTED,
    };

    await expect(
      mayMake(checks(async () => false).mayWrite, write)
    ).resolves.toBe(false);
    await expect(
      mayMake(checks(() => Promise.reject(new Error("down"))).mayWrite, write)
    ).resolves.toBe(false);
    const { asked, mayWrite } = checks();
    await expect(
      mayMake(mayWrite, {
        ...write,
        host: { ...write.host, path: ["hero", "content"] },
      })
    ).resolves.toBe(false);
    expect(asked).toEqual([]);
  });
});
