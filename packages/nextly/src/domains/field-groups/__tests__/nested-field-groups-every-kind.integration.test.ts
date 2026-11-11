/**
 * Every field kind a field group may hold is stored and read back at each of five levels of field
 * groups placed directly in one another.
 *
 * A level that stored only some kinds, or only the first level, reads back short: each kind is
 * asserted at every level by its own value, so a value read from the wrong level or left out reads
 * as a mismatch, not as absence. Written as trusted code; relationships and uploads are read at
 * depth 0, as the ids written; a password is written and never read back.
 */
import { afterEach, describe, expect, it } from "vitest";

import { verifyPassword } from "../../../auth/password";
import {
  checkbox,
  code,
  date,
  defineCollection,
  defineFieldGroup,
  email,
  fieldGroup,
  group,
  icon,
  json,
  number,
  password,
  radio,
  relationship,
  repeater,
  richText,
  select,
  text,
  textarea,
  upload,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { pdfDocument } from "../../../services/upload-validation/__tests__/format-fixtures";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const DEPTH = 5;
const slugAt = (level: number) => `k${level}`;
const OPTIONS = [
  { label: "A", value: "a" },
  { label: "B", value: "b" },
];

/** Level `level`'s field group: one field of every kind, and the next level placed directly. */
function levelGroup(level: number) {
  return defineFieldGroup({
    slug: slugAt(level),
    fields: [
      text({ name: "t" }),
      textarea({ name: "ta" }),
      email({ name: "em" }),
      number({ name: "n" }),
      checkbox({ name: "cb" }),
      date({ name: "d" }),
      select({ name: "s", options: OPTIONS }),
      radio({ name: "r", options: OPTIONS }),
      json({ name: "j" }),
      icon({ name: "ic" }),
      code({ name: "cd" }),
      richText({ name: "rt" }),
      password({ name: "pw" }),
      relationship({ name: "au", relationTo: "authors" }),
      upload({ name: "up", relationTo: "media" }),
      group({ name: "g", fields: [text({ name: "gt" })] }),
      repeater({ name: "rp", fields: [text({ name: "rpt" })] }),
      ...(level < DEPTH
        ? [fieldGroup({ name: "next", component: slugAt(level + 1) })]
        : []),
    ],
  });
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: Array.from({ length: DEPTH }, (_, i) => levelGroup(i + 1)),
    collections: [
      defineCollection({ slug: "authors", fields: [text({ name: "name" })] }),
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "top", component: slugAt(1) }),
        ],
      }),
    ],
  });
  return current;
}

/** A Lexical document holding `words`, as the rich-text editor writes one. */
function lexical(words: string): Record<string, unknown> {
  return {
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: null,
      children: [
        {
          type: "paragraph",
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          children: [
            {
              type: "text",
              version: 1,
              text: words,
              format: 0,
              mode: "normal",
              style: "",
              detail: 0,
            },
          ],
        },
      ],
    },
  };
}

/** The value written at `level` and below, each field marked with its level. */
function valueAt(
  level: number,
  ids: { author: string; media: string }
): Record<string, unknown> {
  return {
    t: `t${level}`,
    ta: `ta${level}`,
    em: `l${level}@example.com`,
    n: level,
    cb: level % 2 === 0,
    d: `2026-01-0${level}T00:00:00.000Z`,
    s: level % 2 === 0 ? "a" : "b",
    r: level % 2 === 0 ? "b" : "a",
    j: { level },
    ic: "lucide:star",
    cd: `x = ${level}`,
    rt: lexical(`words ${level}`),
    pw: `secret-${level}-Aa1!`,
    au: ids.author,
    up: ids.media,
    g: { gt: `g${level}` },
    rp: [{ rpt: `r${level}` }],
    ...(level < DEPTH ? { next: valueAt(level + 1, ids) } : {}),
  };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`every field kind at every level of nested field groups — ${dialect}`, () => {
    it("stores and reads each kind at each of five levels", async () => {
      const t = await boot(dialect);
      const author = await t.nextly.create({
        collection: "authors" as never,
        data: { name: "A" } as never,
      });
      const pdf = pdfDocument("nested");
      const media = await t.nextly.media.upload({
        file: {
          data: pdf,
          name: "doc.pdf",
          mimetype: "application/pdf",
          size: pdf.length,
        },
      });
      const ids = {
        author: (author.item as { id: string }).id,
        media: (media as { id: string }).id,
      };

      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { title: "P", top: valueAt(1, ids) } as never,
      });
      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: (created.item as { id: string }).id as never,
        depth: 0,
      })) as Record<string, unknown>;

      let at = read.top as Record<string, unknown> | undefined;
      for (let level = 1; level <= DEPTH; level++) {
        const sent = valueAt(level, ids);
        expect(at, `level ${level} read back`).toBeDefined();
        const got = at as Record<string, unknown>;
        for (const name of ["t", "ta", "em", "n", "cb", "s", "r", "ic", "cd"]) {
          expect(got[name], `${name} at level ${level}`).toEqual(sent[name]);
        }
        expect(
          new Date(got.d as string).toISOString(),
          `d at level ${level}`
        ).toBe(sent.d);
        expect(got.j, `j at level ${level}`).toEqual(sent.j);
        expect(got.rt, `rt at level ${level}`).toEqual(sent.rt);
        expect(got.au, `au at level ${level}`).toBe(ids.author);
        expect(got.up, `up at level ${level}`).toBe(ids.media);
        expect(got.g, `g at level ${level}`).toEqual(sent.g);
        expect(
          (got.rp as { rpt?: string }[]).map(row => row.rpt),
          `rp at level ${level}`
        ).toEqual([`r${level}`]);
        // Written, and never read back.
        expect(got.pw, `pw at level ${level}`).toBeUndefined();
        at = got.next as Record<string, unknown> | undefined;
      }

      // The deepest level's password is stored hashed once: not absent, not as it was sent, and the
      // password sent verifies against it, which a hash of a hash would not.
      const [deepest] = await t.adapter.select<{ pw?: unknown }>(
        `comp_${slugAt(DEPTH)}`,
        {}
      );
      expect(typeof deepest?.pw).toBe("string");
      expect(deepest?.pw).not.toBe(`secret-${DEPTH}-Aa1!`);
      expect(
        await verifyPassword(`secret-${DEPTH}-Aa1!`, deepest?.pw as string)
      ).toBe(true);
    });
  });
}
