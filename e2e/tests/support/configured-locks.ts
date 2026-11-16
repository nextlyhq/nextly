/**
 * The locks a spec file configures, read from its source.
 *
 * Two readers need the same answer: `locks-held.test.ts`, which checks that a
 * spec writing shared state holds its lock, and `./test`, which signs every
 * file holding a document's lock in as that lock's one account.
 *
 * @module tests/support/configured-locks
 */
import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";

/**
 * The locks a spec actually configures: each `LOCK.<name>` in the `lock` array
 * of a `test.describe.configure({ ... })` call, read from the parsed source.
 * Not the constant appearing anywhere: an import, a comment or a configure call
 * that was never written would otherwise pass while Playwright schedules the
 * file with no lock at all.
 */
export function configuredLocks(source: string, file: string): Set<string> {
  const { program } = parseSource(source, file);
  const locks = new Set<string>();
  walk(program, node => {
    if (node.type !== "CallExpression") return;
    const callee = source.slice(node.callee.start, node.callee.end);
    if (callee !== "test.describe.configure") return;
    for (const name of lockNames(node.arguments[0])) locks.add(name);
  });
  return locks;
}

/** The node types `lockNames` reads, as oxc names them. */
type Parsed = Parameters<Parameters<typeof walk>[1]>[0];

/** The `LOCK.<name>` names in the `lock` array of a configure call's options. */
function lockNames(options: Parsed | undefined): string[] {
  if (options?.type !== "ObjectExpression") return [];
  return options.properties.flatMap(property =>
    property.type === "Property" &&
    property.key.type === "Identifier" &&
    property.key.name === "lock" &&
    property.value.type === "ArrayExpression"
      ? property.value.elements.flatMap(lockMember)
      : []
  );
}

/** The name in one `LOCK.<name>` element, or none for anything else. */
function lockMember(element: Parsed | null): string[] {
  if (element?.type !== "MemberExpression") return [];
  const { object, property } = element;
  return object.type === "Identifier" &&
    object.name === "LOCK" &&
    property.type === "Identifier"
    ? [property.name]
    : [];
}
