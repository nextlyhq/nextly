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
import type {
  MemberExpression,
  MethodDefinition,
  ObjectProperty,
} from "oxc-parser";
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
  "unpublishParts",
]);

/** The write calls a status could be set in as a literal key: an adapter's or a query builder's. */
const WRITE_METHODS = new Set(["update", "insert", "set", "values"]);

/** The keys that name an entry's publishing state: the entry's own, and each language's. */
const STATUS_KEYS = new Set(["status", "_status"]);

/**
 * The files of the publish service, where a status may be written as such. Every other write of
 * one as a literal key is listed in STATUS_WRITES_ALLOWED with why.
 */
const PUBLISH_SERVICE_FILES = new Set([
  "domains/collections/services/publish-parts.ts",
  "domains/collections/services/publish-gate.ts",
  "domains/collections/services/save-door-gate.ts",
  "domains/collections/services/all-locales-lifecycle.ts",
]);

/** Each status written as a literal key outside the publish service, as `file#enclosing -> key`, with why. */
const STATUS_WRITES_ALLOWED: Record<string, string> = {
  // The publish service's own moves, kept in the mutation services that hold the tables.
  "domains/collections/services/collection-mutation-service.ts#setLifecycleAllLocales -> status":
    "the publish service's move of chosen parts: the entry's own status, under the row lock",
  "domains/collections/services/collection-mutation-service.ts#writeCompanionStatus -> _status":
    "each language's status, written for the move of chosen parts and the save to every language",
  "domains/singles/services/single-publish-all.ts#writePublishedStatuses -> status":
    "the Singles engine's publish of chosen parts: the Single's own status",
  "domains/singles/services/single-publish-all.ts#writePublishedStatuses -> _status":
    "the same, each language's status",
  "domains/singles/services/single-publish-all.ts#commitUnpublish -> status":
    "the Singles engine's unpublish of chosen parts: the Single's own status",
  "domains/singles/services/single-publish-all.ts#commitUnpublish -> _status":
    "the same, each language's status",
  "domains/singles/services/single-mutation-service.ts#update -> _status":
    "a Single's save to every language (`*`) naming a status, judged by the publish gate; its routing through the service's status writes is a follow-up",
  // A `status` that is no entry's publishing state: another table's own column of that name.
  "domains/dynamic-collections/services/dynamic-collection-registry-service.ts#registerCollection -> status":
    "a collection's registry record, not an entry",
  "domains/schema/migrate/metadata-register.ts#registerCollection -> status":
    "a collection's registry record, not an entry",
  "domains/schema/migrate/metadata-register.ts#registerSingle -> status":
    "a Single's registry record, not its document",
  "domains/schema/events/schema-events-repository.ts#markApplied -> status":
    "a schema change event's state",
  "domains/schema/events/schema-events-repository.ts#markFailed -> status":
    "a schema change event's state",
  "domains/schema/events/schema-events-repository.ts#markNothingApplied -> status":
    "a schema change event's state",
  "domains/schema/events/schema-events-repository.ts#supersede -> status":
    "a schema change event's state",
  "domains/plugin-events/dispatch.ts#dispatchDurableEvents -> status":
    "a durable plugin event's delivery state",
  "domains/versions/versions-repository.ts#insertVersion -> status":
    "the status a version records of its document, a copy in history, not the document's own",
  "domains/versions/versions-repository.ts#upsertAutosave -> status":
    "the status an author's recovery point records, not the document's own",
  "domains/webhooks/services/webhook-endpoint-service.ts#cancelQueuedDeliveries -> status":
    "a webhook delivery's state",
  "domains/webhooks/services/webhook-endpoint-service.ts#redeliverDelivery -> status":
    "a webhook delivery's state",
};

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
  // The service, called by its own name: the collection door and the Single door each hand it
  // their engines, and it unpublishes chosen parts through its own takedown.
  "services/collections/collection-entry-service.ts#publishParts -> publishParts":
    "the collection entry service hands the service its engines",
  "domains/singles/services/single-entry-service.ts#publishParts -> publishParts":
    "the Single entry service hands the service its engines",
  "domains/collections/services/publish-parts.ts#publishParts -> unpublishParts":
    "the service's own takedown of chosen parts",
  "domains/singles/services/single-entry-service.ts#publishParts -> unpublishParts":
    "the Singles engine's takedown of chosen parts, which the service moves them through",
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
  // A Single's publish of chosen parts: the same service, moving them through the Singles engine.
  "domains/singles/services/single-entry-service.ts#publishParts -> publishPartsReads":
    "the service reads the Single and asks every refusal",
  "domains/singles/services/single-entry-service.ts#publishParts -> publishAllLocales":
    "the Singles engine's publish, told which parts it moves",
  "domains/singles/services/single-entry-service.ts#publishParts -> previewPublishAllLocales":
    "the service describes a publish through that engine's own preview",
  "dispatcher/handlers/single-dispatcher.ts#singlePartsLifecycle -> publishParts":
    "REST's `publish` and `unpublish` routes of a Single",
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
 * What one file does to an entry's publishing state, each as `at#enclosing -> name`: every call to
 * a mover, by member (`a.b()`, `a?.b()`, `a["b"]()`) or by bare name (`b()`); and every status
 * written as a literal key of an object handed to a write (`.update`, `.insert`, `.set`,
 * `.values`), named or computed from the language status column. The enclosing name is the
 * nearest named function declaration or method around it.
 */
function scanFile(
  text: string,
  at: string
): { movers: string[]; statusWrites: string[] } {
  const movers: string[] = [];
  const statusWrites: string[] = [];
  const enclosing: (string | null)[] = [];
  const methodName = (node: MethodDefinition | ObjectProperty): string =>
    text.slice(node.key.start, node.key.end);
  const around = (): string => {
    for (let i = enclosing.length - 1; i >= 0; i--) {
      const entry = enclosing[i];
      if (entry !== null && entry !== undefined) return entry;
    }
    return "(module)";
  };
  const memberName = (callee: MemberExpression): string | null => {
    const property = callee.property;
    if (callee.computed) {
      return property.type === "Literal" && typeof property.value === "string"
        ? property.value
        : null;
    }
    return property.type === "Identifier" ? property.name : null;
  };
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
      const name =
        callee.type === "Identifier"
          ? callee.name
          : callee.type === "MemberExpression"
            ? memberName(callee)
            : null;
      if (name === null) return;
      if (MOVERS.has(name)) movers.push(`${at}#${around()} -> ${name}`);
      if (callee.type !== "MemberExpression" || !WRITE_METHODS.has(name)) {
        return;
      }
      for (const argument of node.arguments) {
        if (argument.type !== "ObjectExpression") continue;
        for (const property of argument.properties) {
          if (property.type !== "Property") continue;
          const key = property.key;
          const keyName = property.computed
            ? key.type === "Identifier" &&
              key.name === "COMPANION_STATUS_COLUMN"
              ? "_status"
              : null
            : key.type === "Identifier"
              ? key.name
              : key.type === "Literal" && typeof key.value === "string"
                ? key.value
                : null;
          if (keyName !== null && STATUS_KEYS.has(keyName)) {
            statusWrites.push(`${at}#${around()} -> ${keyName}`);
          }
        }
      }
    },
  }).visit(parseSource(text, at).program);
  return { movers, statusWrites };
}

/** Every call to a mover in `text`; see {@link scanFile}. */
function moverCalls(text: string, at: string): string[] {
  return scanFile(text, at).movers;
}

/**
 * Every call to a mover and every literal status write in the package outside the publish
 * service's own files, each once, and how many files were read.
 */
function packageMoverCalls(): {
  calls: string[];
  statusWrites: string[];
  filesRead: number;
} {
  const calls = new Set<string>();
  const statusWrites = new Set<string>();
  const files = sourceFiles(SRC);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const at = relative(SRC, file).split(sep).join("/");
    const scanned = scanFile(text, at);
    for (const call of scanned.movers) calls.add(call);
    if (PUBLISH_SERVICE_FILES.has(at)) continue;
    for (const write of scanned.statusWrites) statusWrites.add(write);
  }
  return {
    calls: [...calls].sort(),
    statusWrites: [...statusWrites].sort(),
    filesRead: files.length,
  };
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

  it("are found when called by bare name, and a status is found as a literal key of a write", () => {
    const fixture = [
      "function move(tx, svc) {",
      "  publishParts(id, request, engines);",
      '  tx.update("dc_posts", { title: "t", status: "published" });',
      '  tx.update("dc_posts_locales", { ["_status"]: "draft" });',
      "  tx.update(table, { [COMPANION_STATUS_COLUMN]: next });",
      '  db.update(main).set({ status: "draft" });',
      '  db.insert(main).values({ "status": "published" });',
      '  cache.get({ status: "published" });',
      "  tx.update(table, { ...payload });",
      "}",
    ].join("\n");

    const scanned = scanFile(fixture, "fixture.ts");

    expect(scanned.movers).toEqual(["fixture.ts#move -> publishParts"]);
    // Each write naming a status, whichever way it is spelled; a call that writes nothing, and a
    // payload spread from elsewhere, are not seen (the latter is the scan's stated limit).
    expect(scanned.statusWrites).toEqual([
      "fixture.ts#move -> status",
      "fixture.ts#move -> _status",
      "fixture.ts#move -> status",
      "fixture.ts#move -> status",
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

  // A status written as a literal key outside the publish service is listed with why. What this
  // cannot see, stated so its silence is not read as a clean answer: a status that reaches a write
  // as one key of a payload built elsewhere (a save's own data). Every such write is judged by
  // the publish gate; routing it through the status writes of the publish service is a follow-up.
  it("write a status as a literal key only in the publish service, or where listed with why", () => {
    const { statusWrites, filesRead } = packageMoverCalls();

    expect(filesRead).toBeGreaterThan(500);
    expect(statusWrites).toContain(
      "domains/collections/services/collection-mutation-service.ts#setLifecycleAllLocales -> status"
    );
    expect(statusWrites).toEqual(Object.keys(STATUS_WRITES_ALLOWED).sort());
  });
});
