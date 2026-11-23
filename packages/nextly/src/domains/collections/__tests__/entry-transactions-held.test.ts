/**
 * Every transaction the collection entry write services open goes through `entryTransaction`,
 * which holds the collection for the write first (`holdEntityForWrite`): on MySQL a Builder save
 * deleting a field's values then takes turns with every entry write. A transaction opened any
 * other way in these files fails this test until it goes through `entryTransaction` or is listed
 * here with why it writes no entry.
 *
 * A write on a transaction a caller opened (a plugin's, the legacy batch's: `createEntryInTransaction`
 * and its update and delete) is held by the write itself, before its first row statement:
 * `createEntryWrite`, `updateEntryWrite` and `deleteEntryWrite` each take the hold, and each
 * `*EntryInTransaction` goes through one of them. Both are checked here.
 *
 * What this cannot see, stated so its silence is not read as a clean answer: a Single's writes,
 * which no deleting save holds yet, and a write outside these two services.
 *
 * @module domains/collections/__tests__/entry-transactions-held.test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource } from "@nextlyhq/module-specifiers/parse-source";
import { Visitor } from "oxc-parser";
import type { MemberExpression, MethodDefinition } from "oxc-parser";
import { describe, expect, it } from "vitest";

/** The package's source tree. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The services that open a transaction to write a collection's entries. */
const ENTRY_WRITE_FILES = [
  "domains/collections/services/collection-mutation-service.ts",
  "domains/collections/services/collection-bulk-service.ts",
];

/** Each transaction opened outside `entryTransaction`, as `file#enclosing method`, with why. */
const OPENED_ALLOWED: Record<string, string> = {
  "domains/collections/services/collection-mutation-service.ts#entryTransaction":
    "the hold's own transaction, which holds the collection before the write's work",
  "domains/collections/services/collection-mutation-service.ts#rebuildMediaUsage":
    "records which media each entry uses, in the media usage table: it reads the entry's row and writes none of the collection's, and a save deleting a field's values leaves the media usage table as it is",
  "domains/collections/services/collection-mutation-service.ts#previewPublishAllLocales":
    "describes a publish and rolls back; it writes nothing that stays",
};

/** The methods that take the hold for an entry write themselves, before its first row statement. */
const HELD_BY_THE_WRITE = [
  "domains/collections/services/collection-mutation-service.ts#createEntryWrite",
  "domains/collections/services/collection-mutation-service.ts#deleteEntryWrite",
  "domains/collections/services/collection-mutation-service.ts#entryTransaction",
  "domains/collections/services/collection-mutation-service.ts#updateEntryWrite",
];

/** Each write on a caller's transaction, and the write that holds for it. */
const ON_A_CALLERS_TRANSACTION: Record<string, string> = {
  createEntryInTransaction: "createEntryWrite",
  updateEntryInTransaction: "updateEntryWrite",
  deleteEntryInTransaction: "deleteEntryWrite",
};

/**
 * Each `.transaction(` call in `text` (`a.transaction()`, `a?.transaction()`, `a["transaction"]()`),
 * each `entryTransaction` call, each hold taken (`holdForEntryWrite`), and each call of a method
 * named in ON_A_CALLERS_TRANSACTION's values, as `at#enclosing method`, the last as
 * `enclosing -> called`.
 */
function transactionsOpened(
  text: string,
  at: string
): { opened: string[]; held: string[]; holds: string[]; writes: string[] } {
  const opened: string[] = [];
  const held: string[] = [];
  const holds: string[] = [];
  const writes: string[] = [];
  const writeNames = new Set(Object.values(ON_A_CALLERS_TRANSACTION));
  const enclosing: string[] = [];
  const memberName = (callee: MemberExpression): string | null => {
    const property = callee.property;
    if (callee.computed) {
      return property.type === "Literal" && typeof property.value === "string"
        ? property.value
        : null;
    }
    return property.type === "Identifier" ? property.name : null;
  };
  const methodName = (node: MethodDefinition): string =>
    text.slice(node.key.start, node.key.end);
  new Visitor({
    MethodDefinition: node => enclosing.push(methodName(node)),
    "MethodDefinition:exit": () => enclosing.pop(),
    CallExpression: node => {
      if (node.callee.type !== "MemberExpression") return;
      const name = memberName(node.callee);
      const where = `${at}#${enclosing.at(-1) ?? "(module)"}`;
      if (name === "transaction") opened.push(where);
      if (name === "entryTransaction") held.push(where);
      if (name === "holdForEntryWrite") holds.push(where);
      if (name !== null && writeNames.has(name)) {
        writes.push(`${enclosing.at(-1) ?? "(module)"} -> ${name}`);
      }
    },
  }).visit(parseSource(text, at).program);
  return { opened, held, holds, writes };
}

describe("the transactions the entry write services open", () => {
  it("are found by each way a method is called, and named by the method around them", () => {
    const fixture = [
      "class Writes {",
      "  create() { return this.adapter.transaction(async tx => tx); }",
      "  update() { return this.adapter?.transaction(work); }",
      '  remove() { return this.adapter["transaction"](work); }',
      "  held() { return this.entryTransaction(slug, work); }",
      "}",
    ].join("\n");

    expect(transactionsOpened(fixture, "fixture.ts")).toMatchObject({
      opened: [
        "fixture.ts#create",
        "fixture.ts#update",
        "fixture.ts#remove",
      ],
      held: ["fixture.ts#held"],
    });
  });

  it("go through entryTransaction, or are listed with why they write no entry", () => {
    const opened = new Set<string>();
    let held = 0;
    for (const at of ENTRY_WRITE_FILES) {
      const scanned = transactionsOpened(
        readFileSync(join(SRC, at), "utf8"),
        at
      );
      for (const where of scanned.opened) opened.add(where);
      held += scanned.held.length;
    }

    // The scan reached the writes: the seven of the mutation service and the batches' three.
    expect(held).toBe(10);
    expect([...opened].sort()).toEqual(Object.keys(OPENED_ALLOWED).sort());
  });

  it("hold the write on a caller's transaction in the write itself", () => {
    const at = ENTRY_WRITE_FILES[0] ?? "";
    const scanned = transactionsOpened(readFileSync(join(SRC, at), "utf8"), at);

    expect([...new Set(scanned.holds)].sort()).toEqual(HELD_BY_THE_WRITE);
    for (const [caller, write] of Object.entries(ON_A_CALLERS_TRANSACTION)) {
      expect(scanned.writes).toContain(`${caller} -> ${write}`);
    }
  });
});
