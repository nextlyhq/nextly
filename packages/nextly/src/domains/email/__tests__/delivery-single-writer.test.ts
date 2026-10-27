/**
 * Every email delivery record is written through one path.
 *
 * A record naming a plugin-defined person is decided under the deleted-people
 * lock, so a person reported deleted is never written with their address
 * digest or their id. That holds only while every write goes through the one
 * insert that takes the lock. The delivery log is a log, not a queue: nothing
 * retries a delivery and nothing records a provider's report today, and when
 * either is added it has to write through the same path. This test is what
 * makes that the easy way: a new insert into the table, anywhere in the
 * package, fails it until it is routed there.
 *
 * @module domains/email/__tests__/delivery-single-writer.test
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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures seed rows directly to set a scene; they write nothing real.
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
 * Every `.insert(...)` whose target names the delivery table, as
 * `file#enclosing function`. Matched on the argument's text: the table is
 * reached as `deliveries`, `emailDeliveries…` or `"email_deliveries"`, and an
 * insert into anything else names none of them.
 *
 * The enclosing name is the nearest named function declaration or method,
 * class or object-literal, around the call; arrow functions and function
 * expressions are not names a reader looks for, so they are passed through.
 */
function deliveryInserts(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!/deliver/i.test(text)) continue;
    const at = relative(SRC, file).split(sep).join("/");
    // One entry per function or method the walk is inside, null for one with
    // no name, so the nearest named one is the last non-null entry.
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
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "insert" &&
          node.arguments.some(arg =>
            /deliveries|email_deliveries/i.test(text.slice(arg.start, arg.end))
          )
        ) {
          let name = "(module)";
          for (let i = enclosing.length - 1; i >= 0; i--) {
            const entry = enclosing[i];
            if (entry !== null) {
              name = entry;
              break;
            }
          }
          found.push(`${at}#${name}`);
        }
      },
    }).visit(parseSource(text, file).program);
  }
  return found.sort();
}

describe("email delivery records", () => {
  it("are inserted only by the delivery service's one person-aware path", () => {
    expect(deliveryInserts()).toEqual([
      // A chunk naming a person, decided under the deleted-people lock.
      "domains/email/services/email-delivery-service.ts#insertNamingPeople",
      // A chunk naming no person, which `insertRows` checks before it.
      "domains/email/services/email-delivery-service.ts#insertRows",
    ]);
  });
});
