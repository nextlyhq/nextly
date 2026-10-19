/**
 * Statements that escape an open transaction, caught as the suites run.
 *
 * On PostgreSQL and MySQL a transaction holds one pooled connection. Anything
 * the same flow takes from the pool while it is open, such as a query through a
 * pool-bound handle, a nested transaction or a helper that never received the
 * `tx`, runs on another connection: outside the transaction, blind to its
 * uncommitted writes, kept when it rolls back, and able to stall a small pool.
 * SQLite has one connection, so the same code passes there, which is why
 * nothing noticed.
 *
 * The adapters report each such pool access to the observer installed here
 * (`DrizzleAdapter.notePoolAccess`). The setup file fails the test that caused
 * one, naming its call site, unless the call site is listed below as a known
 * or deliberate escape. Each known one names the change that removes it, and
 * that change deletes its entry.
 *
 * Dependency-free, like `aborted-transaction-sightings`, because the setup
 * file it serves is loaded into every unit test as well.
 *
 * @module __tests__/transaction-escapes
 */
import { appendFileSync } from "node:fs";

/** One escape, as the adapter reported it. */
export interface TransactionEscape {
  dialect: string;
  /** The first frame outside the adapters and dependencies: where to look. */
  site: string;
  /**
   * The site as its file and function, without the line, so an entry keyed on
   * it survives ordinary edits to the file. A statement reached through a
   * query builder awaited as a thenable carries no caller, since V8 links none
   * across that; it is keyed by where its transaction was opened instead,
   * marked `OPENED_BY`, with the statement's verb and table
   * (`statementFingerprint`), so escapes of one flow stay apart.
   * `UNKNOWN_SITE` when neither was captured.
   */
  key: string;
  stack: string;
  /** The accepted entry it matched, when it matched one. */
  accepted?: AcceptedEscape;
}

/** The key of an escape whose stack never reached the code that made it. */
export const UNKNOWN_SITE = "(unknown)";

/** Marks a key taken from where the escaping statement's transaction was opened. */
export const OPENED_BY = " (opened the transaction)";

/** The variable naming the run's inventory file, set by its global setup. */
export const INVENTORY_ENV = "NEXTLY_TRANSACTION_ESCAPES_LOG";

/** An escape the run accepts, matched against any frame of its stack. */
interface AcceptedEscape {
  /** A substring of a stack frame (`<file>:` or a function name). */
  frame: string;
  /** Why it is accepted: deliberate, or known and waiting for its fix. */
  reason: string;
}

/**
 * Escapes the run accepts. A deliberate one stays; a known one names the
 * change that removes it and is deleted by that change.
 */
export const ACCEPTED_ESCAPES: readonly AcceptedEscape[] = [
  {
    frame: "open-transaction.integration.test.ts:",
    reason:
      "deliberate: opens a transaction nested in another to prove flow tracking survives it",
  },
  {
    frame: "transaction-one-connection.integration.test.ts:",
    reason:
      "deliberate: reads the sessions from another connection while a transaction is open, the detector's positive control",
  },
];

const OBSERVER = Symbol.for("nextly.transactionEscapeObserver");

/** Escapes reported since the last `takeTransactionEscapes`. */
const seen: TransactionEscape[] = [];

/**
 * The first frame that is neither the adapters, a dependency, Node itself nor
 * the test harness: the code that reached the pool. A frame with no file, such
 * as `new Promise (<anonymous>)`, names no code to look at, and `async ` only
 * says the frame was awaited. Undefined when no such frame was captured.
 *
 * For the stack that opened a transaction, `wrappers` also skips a frame whose
 * function is itself a transaction wrapper (`BaseService.withTransaction`,
 * `runAdapterTransaction`): it is shared by many flows, and the key it gave
 * would hide which one escaped.
 */
function callSiteOf(
  stack: string,
  { wrappers = false }: { wrappers?: boolean } = {}
): string | undefined {
  return stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/^async /, "")
    )
    .find(
      frame =>
        frame.includes("/") &&
        !frame.includes("/packages/adapter-") &&
        !frame.includes("/node_modules/") &&
        !frame.includes("node:") &&
        !frame.includes("transaction-escapes.ts") &&
        // The test harness's own wrapper around every transaction callback.
        !frame.includes("/plugins/test-nextly.") &&
        !(wrappers && /transaction/i.test(functionOf(frame)))
    );
}

/** A frame's function name; empty for an anonymous frame, which is only a location. */
function functionOf(frame: string): string {
  const at = frame.indexOf(" (");
  return at < 0 ? "" : frame.slice(0, at);
}

/** A table name as written in SQL, quoted or schema-qualified. */
const NAME = String.raw`((?:[\`"]?[\w$]+[\`"]?\.)*[\`"]?[\w$]+[\`"]?)`;

/** Where each verb names its table. */
const TABLE_AFTER: Readonly<Partial<Record<string, RegExp>>> = {
  select: new RegExp(String.raw`\bfrom ${NAME}`, "i"),
  with: new RegExp(String.raw`\bfrom ${NAME}`, "i"),
  delete: new RegExp(String.raw`\bfrom ${NAME}`, "i"),
  insert: new RegExp(String.raw`\binto ${NAME}`, "i"),
  update: new RegExp(String.raw`^update ${NAME}`, "i"),
  truncate: new RegExp(String.raw`^truncate (?:table )?${NAME}`, "i"),
  create: new RegExp(
    String.raw`\b(?:table|index|view) (?:if not exists )?${NAME}`,
    "i"
  ),
  alter: new RegExp(String.raw`\btable (?:if exists )?${NAME}`, "i"),
  drop: new RegExp(
    String.raw`\b(?:table|index|view) (?:if exists )?${NAME}`,
    "i"
  ),
};

/**
 * A statement as its verb and table, `select nextly_dynamic_collections`:
 * what an escape keyed by its transaction's opener adds, so a new statement in
 * the same flow is told apart from the known ones. No literals, parameters or
 * columns, so an ordinary edit to the query keeps its fingerprint. `checkout`
 * for a connection taken with no statement.
 */
export function statementFingerprint(sql: string | undefined): string {
  if (sql === undefined) return "checkout";
  const text = sql.replace(/\s+/g, " ").trim();
  const verb = (/^\(?\s*(\w+)/.exec(text)?.[1] ?? "?").toLowerCase();
  const table = TABLE_AFTER[verb]?.exec(text)?.[1];
  if (table === undefined) return verb;
  const bare = table.split(".").pop() ?? table;
  return `${verb} ${bare.replace(/[`"]/g, "")}`;
}

/**
 * A site as `<file>#<function>`: the file from `packages/` on, without the
 * line and column, and `<anonymous>` for a frame with no function name.
 */
export function siteKeyOf(site: string | undefined): string {
  if (site === undefined) return UNKNOWN_SITE;
  const named = /^(.*?) \((.*)\)$/.exec(site);
  const fn = named?.[1] ?? "<anonymous>";
  const location = (named?.[2] ?? site).replace(/^file:\/\//, "");
  const file = location.replace(/:\d+:\d+$/, "");
  const from = file.indexOf("packages/");
  return `${from >= 0 ? file.slice(from) : file}#${fn}`;
}

/** Installs the observer the adapters report to. Idempotent. */
export function installTransactionEscapeObserver(): void {
  (globalThis as Record<symbol, unknown>)[OBSERVER] = (report: {
    dialect: string;
    stack: string;
    openedAt?: string;
    statement?: string;
  }): void => {
    const site = callSiteOf(report.stack);
    const opener =
      report.openedAt === undefined
        ? undefined
        : callSiteOf(report.openedAt, { wrappers: true });
    const stacks = `${report.stack}\n${report.openedAt ?? ""}`;
    seen.push({
      dialect: report.dialect,
      site:
        site ??
        (opener === undefined
          ? "(no frame outside the adapters and dependencies)"
          : `transaction opened at ${opener}`),
      key:
        site !== undefined || opener === undefined
          ? siteKeyOf(site)
          : `${siteKeyOf(opener)}${OPENED_BY} · ${statementFingerprint(report.statement)}`,
      stack: stacks,
      accepted: ACCEPTED_ESCAPES.find(entry => stacks.includes(entry.frame)),
    });
  };
}

/**
 * The escapes reported since the last call, accepted ones included, removing
 * them from the buffer.
 */
export function takeTransactionEscapes(): TransactionEscape[] {
  return seen.splice(0, seen.length);
}

/**
 * The failure message for `escapes`, or undefined when there are none. Each
 * call site once, with how many times it escaped and the full stack of the
 * first, since the site alone does not always say which path led there.
 */
export function describeTransactionEscapes(
  reported: readonly TransactionEscape[]
): string | undefined {
  const escapes = reported.filter(escape => escape.accepted === undefined);
  if (escapes.length === 0) return undefined;
  const bySite = new Map<string, TransactionEscape[]>();
  for (const escape of escapes) {
    const key = `${escape.dialect} ${escape.key}`;
    bySite.set(key, [...(bySite.get(key) ?? []), escape]);
  }
  const lines = [...bySite.entries()].map(
    ([key, group]) =>
      `- ${key} (${String(group.length)}x)\n${group[0].stack
        .split("\n")
        .slice(1, 12)
        .join("\n")}`
  );
  return (
    `${String(escapes.length)} statement(s) ran on another connection while ` +
    `their flow held an open transaction: outside it, blind to its writes and ` +
    `kept on rollback. Pass the transaction's \`tx\` down to them, or list the ` +
    `call site in ACCEPTED_ESCAPES (src/__tests__/transaction-escapes.ts) with ` +
    `why.\n${lines.join("\n")}`
  );
}

/**
 * Appends `escapes`, with the test file that made them, to the run's inventory
 * (`./transaction-escapes-inventory`) when the run keeps one. One JSON object
 * per line, so the forks that run the suites can each append to the one file.
 */
export function recordTransactionEscapes(
  escapes: readonly TransactionEscape[],
  testFile: string | undefined
): void {
  const log = process.env[INVENTORY_ENV];
  if (log === undefined || escapes.length === 0) return;
  appendFileSync(
    log,
    escapes
      .map(escape =>
        JSON.stringify({
          dialect: escape.dialect,
          key: escape.key,
          accepted: escape.accepted !== undefined,
          testFile,
        })
      )
      .join("\n") + "\n"
  );
}
