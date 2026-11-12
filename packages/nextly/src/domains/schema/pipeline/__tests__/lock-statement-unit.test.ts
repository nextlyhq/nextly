/**
 * The name a schema-lock-marked statement carries: written so no name can close its comment early,
 * and read back as the name or as nothing, never as anything else of the statement.
 *
 * `listed` cuts a comment's content out of a marked statement the way the listing query does in the
 * database (from the comment's opening up to the first closing, and only where a closing follows),
 * so each case runs the same text through the writer and the reader as a running statement would.
 */
import { describe, expect, it } from "vitest";

import {
  UNIT_COMMENT_CLOSE,
  UNIT_COMMENT_OPEN,
  unitComment,
  unitOf,
} from "../lock-statement-unit";

const CLAIM = "/* nextly-lock:host:1#00000000-0000-0000-0000-000000000000 */ ";
const SECRET = "sk_live_must_not_be_read";

/** A statement as the runner marks it, holding a literal no reader may pass on. */
function marked(name: string): string {
  return `${CLAIM}${unitComment(name)}UPDATE t SET k = '${SECRET}'`;
}

/** The comment's content as the listing query cuts it out; null where it would return none. */
function listed(statement: string): string | null {
  const prefix = `${CLAIM}${UNIT_COMMENT_OPEN}`;
  if (!statement.startsWith(prefix)) return null;
  const rest = statement.slice(prefix.length);
  const end = rest.indexOf(UNIT_COMMENT_CLOSE);
  return end < 0 ? null : rest.slice(0, end);
}

describe("unitComment and unitOf", () => {
  it.each([
    "0007_add_keys.sql",
    "0007_late value.sql",
    "plugin:@scope/seo/0001_init",
    "Schema Builder: collection update",
    "nextly db:sync",
    "a */ DROP TABLE users; /* b",
    "x' OR '1'='1",
    "100% done (really)!~*",
    "名前.sql",
    "emoji 🚀.sql",
  ])("reads back %j exactly as written", name => {
    const statement = marked(name);
    const comment = unitComment(name);

    // The comment closes once, at its end, whatever the name holds.
    expect(comment.indexOf(UNIT_COMMENT_CLOSE)).toBe(
      comment.length - UNIT_COMMENT_CLOSE.length - 1
    );
    // The encoded name holds no quote and no placeholder a driver could read: only letters,
    // digits, `%`, `.`, `_` and `-`.
    expect(
      comment.slice(UNIT_COMMENT_OPEN.length, -UNIT_COMMENT_CLOSE.length - 1)
    ).toMatch(/^[A-Za-z0-9%._-]+$/);
    const content = listed(statement);
    expect(unitOf(content)).toBe(name);
    expect(content).not.toContain(SECRET);
  });

  it.each([
    ["an empty name", ""],
    ["a line break", "0007\nFORGED LINE"],
    ["a terminal escape", "0007\u001b[31m.sql"],
    ["a direction override", "0007‮.sql"],
    ["a backtick", "0007`.sql"],
    ["a lone surrogate", "0007\ud800.sql"],
    ["a name too long to survive", "x".repeat(600)],
  ])("writes no comment for %s, so the statement names nothing", (_, name) => {
    expect(unitComment(name)).toBe("");
    expect(listed(marked(name))).toBeNull();
  });

  it.each([
    ["text that is not an encoded name", "UPDATE t SET k = 'x'"],
    ["a quote", "0007'"],
    ["an encoded line break", "0007%0AFORGED"],
    ["an encoded backtick", "0007%60"],
    ["a broken escape", "0007%E0%A4%A"],
    ["a name cut short of its closing", "a".repeat(513)],
    ["nothing", ""],
    ["no text at all", null],
    ["a number", 7],
  ])("reads %s as no name", (_, content) => {
    expect(unitOf(content)).toBeNull();
  });

  it("reads a statement whose closing was cut off as naming nothing", () => {
    // PostgreSQL keeps only the start of a long statement: the comment's opening survives, its
    // closing does not, and what follows the opening is not passed on as a name.
    const statement = marked("0007_add_keys.sql");
    const cut = statement.slice(0, statement.indexOf(UNIT_COMMENT_CLOSE));
    expect(listed(cut)).toBeNull();
  });
});
