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

import ts from "typescript";
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

/** The name of the function or method a node sits in. */
function enclosingName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (
      (ts.isMethodDeclaration(at) || ts.isFunctionDeclaration(at)) &&
      at.name
    ) {
      return at.name.getText();
    }
  }
  return "(module)";
}

/**
 * Every `.insert(...)` whose target names the delivery table, as
 * `file#enclosing function`. Matched on the argument's text: the table is
 * reached as `deliveries`, `emailDeliveries…` or `"email_deliveries"`, and an
 * insert into anything else names none of them.
 */
function deliveryInserts(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!/deliver/i.test(text)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "insert" &&
        node.arguments.some(arg =>
          /deliveries|email_deliveries/i.test(arg.getText())
        )
      ) {
        const at = relative(SRC, file).split(sep).join("/");
        found.push(`${at}#${enclosingName(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
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
