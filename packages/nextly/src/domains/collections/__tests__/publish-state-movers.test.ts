/**
 * Every call that moves an entry's publishing state through a method of the publish engine, named
 * with the reason it is allowed. Publishing chosen languages and the shared part has one service
 * (`publishParts`), which moves them through the transition of every language. A call added
 * anywhere else in the package fails this test until it goes through the service or is listed
 * here with why it does not yet.
 *
 * What this cannot see, stated so its silence is not read as a clean answer: a save whose data
 * carries a `status` moves that language's state through the update itself, and whether a save
 * carries one is known only when it runs. Those writes are the update's own, and are not listed.
 *
 * @module domains/collections/__tests__/publish-state-movers.test
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource } from "@nextlyhq/module-specifiers/parse-source";
import { Visitor } from "oxc-parser";
import type { MethodDefinition, ObjectProperty } from "oxc-parser";
import { describe, expect, it } from "vitest";

/** The package's whole source tree. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The methods that move publishing state, or ask what moving it would do. */
const MOVERS = new Set([
  "publishParts",
  "publishPartsReads",
  "publishAllLocales",
  "unpublishAllLocales",
  "previewPublishAllLocales",
  "setLifecycleAllLocales",
  "writeCompanionStatus",
]);

/** Each call allowed, as `file#enclosing method -> called method`, with why. */
const ALLOWED: Record<string, string> = {
  // The service and the transition it moves the parts through.
  "services/collections/collection-entry-service.ts#publishParts -> publishPartsReads":
    "the service reads the entry and asks every refusal",
  "services/collections/collection-entry-service.ts#publishParts -> unpublishAllLocales":
    "the same, taking the chosen parts down",
  "services/collections/collection-entry-service.ts#publishParts -> previewPublishAllLocales":
    "the service describes a publish through that transition's own preview",
  "services/collections/collection-entry-service.ts#transitionEveryLanguage -> publishAllLocales":
    "the transition of every language (or of the chosen parts), which the service moves the parts through",
  "services/collections/collection-entry-service.ts#valueRuleRefusal -> publishPartsReads":
    "publishing every language, and a save that publishes, ask the service's value rules",
  "services/collections/collection-entry-service.ts#unpublishAllLocales -> unpublishAllLocales":
    "the same, taking parts down",
  "services/collections/collection-entry-service.ts#previewPublishAllLocales -> previewPublishAllLocales":
    "the same, for the preview",
  "domains/collections/services/collection-mutation-service.ts#publishAllLocales -> setLifecycleAllLocales":
    "the transition itself",
  "domains/collections/services/collection-mutation-service.ts#unpublishAllLocales -> setLifecycleAllLocales":
    "the transition itself",
  "domains/collections/services/collection-mutation-service.ts#setLifecycleAllLocales -> writeCompanionStatus":
    "the transition writes each moved language's status",
  // The service's own doors.
  "services/collections-handler.ts#publishParts -> publishParts":
    "the handler's door to the service",
  "direct-api/namespaces/collections.ts#moveParts -> publishParts":
    "the Direct API's `publish` and `unpublish`",
  "dispatcher/handlers/collection-dispatcher.ts#partsLifecycle -> publishParts":
    "REST's `publish` and `unpublish` routes",
  // Still moving state beside the service.
  "services/collections-handler.ts#publishAllLocales -> publishAllLocales":
    "publishing every language through its earlier door, not yet through the service",
  "services/collections-handler.ts#unpublishAllLocales -> unpublishAllLocales":
    "the same, unpublishing every language",
  "services/collections-handler.ts#previewPublishAllLocales -> previewPublishAllLocales":
    "the same, its preview",
  "dispatcher/handlers/collection-dispatcher.ts#(module) -> previewPublishAllLocales":
    "REST's preview of publishing every language, not yet through the service",
  "domains/collections/services/collection-mutation-service.ts#sweepCompanionLifecycle -> writeCompanionStatus":
    "a save to every language (`*`) carrying a status, not yet through the service",
  // Singles publish every language through an engine of their own.
  "domains/singles/services/single-entry-service.ts#publishAllLocales -> publishAllLocales":
    "a Single's publish of every language, through the Singles engine",
  "domains/singles/services/single-entry-service.ts#previewPublishAllLocales -> previewPublishAllLocales":
    "its preview",
  "dispatcher/handlers/single-dispatcher.ts#(module) -> publishAllLocales":
    "REST's publish of every language of a Single",
  "dispatcher/handlers/single-dispatcher.ts#(module) -> previewPublishAllLocales":
    "its preview",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(test|integration\.test)(-d)?\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

/**
 * Every call to a mover in `text`, as `at#enclosing -> mover`: a member call by name, dotted or
 * optional (`a.b()`, `a?.b()`), or computed with a literal name (`a["b"]()`). The enclosing name is
 * the nearest named function declaration or method around the call.
 */
function moverCalls(text: string, at: string): string[] {
  const found: string[] = [];
  const enclosing: (string | null)[] = [];
  const methodName = (node: MethodDefinition | ObjectProperty): string =>
    text.slice(node.key.start, node.key.end);
  new Visitor({
    FunctionDeclaration: node => enclosing.push(node.id?.name ?? null),
    "FunctionDeclaration:exit": () => enclosing.pop(),
    MethodDefinition: node => enclosing.push(methodName(node)),
    "MethodDefinition:exit": () => enclosing.pop(),
    Property: node => {
      if (node.method) enclosing.push(methodName(node));
    },
    "Property:exit": node => {
      if (node.method) enclosing.pop();
    },
    CallExpression: node => {
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return;
      const name = callee.computed
        ? callee.property.type === "Literal" &&
          typeof callee.property.value === "string"
          ? callee.property.value
          : null
        : callee.property.type === "Identifier"
          ? callee.property.name
          : null;
      if (name === null || !MOVERS.has(name)) return;
      let named = "(module)";
      for (let i = enclosing.length - 1; i >= 0; i--) {
        const entry = enclosing[i];
        if (entry !== null && entry !== undefined) {
          named = entry;
          break;
        }
      }
      found.push(`${at}#${named} -> ${name}`);
    },
  }).visit(parseSource(text, at).program);
  return found;
}

/** Every call to a mover in the package, each once, and how many files were read. */
function packageMoverCalls(): { calls: string[]; filesRead: number } {
  const calls = new Set<string>();
  const files = sourceFiles(SRC);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (![...MOVERS].some(mover => text.includes(mover))) continue;
    const at = relative(SRC, file).split(sep).join("/");
    for (const call of moverCalls(text, at)) calls.add(call);
  }
  return { calls: [...calls].sort(), filesRead: files.length };
}

describe("the calls that move an entry's publishing state", () => {
  it("are found by each way a method is called, and named by the method around them", () => {
    const fixture = [
      "class Engine {",
      "  run(svc) {",
      "    svc.publishAllLocales(params);",
      "    svc?.writeCompanionStatus(tx, args);",
      '    svc["unpublishAllLocales"](params);',
      "    svc.updateEntry(params, data);",
      "  }",
      "}",
      "function later(svc) { return () => svc.publishParts(params, request); }",
    ].join("\n");

    expect(moverCalls(fixture, "fixture.ts").sort()).toEqual([
      "fixture.ts#later -> publishParts",
      "fixture.ts#run -> publishAllLocales",
      "fixture.ts#run -> unpublishAllLocales",
      "fixture.ts#run -> writeCompanionStatus",
    ]);
  });

  it("are the service's own and those listed with why", () => {
    const { calls, filesRead } = packageMoverCalls();

    // The scan read the package, and found the service's own binding in it: an empty or partial
    // read cannot pass as a clean one.
    expect(filesRead).toBeGreaterThan(500);
    expect(calls).toContain(
      "services/collections/collection-entry-service.ts#publishParts -> publishPartsReads"
    );
    expect(calls).toEqual(Object.keys(ALLOWED).sort());
  });
});
