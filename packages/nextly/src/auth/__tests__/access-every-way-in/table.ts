/**
 * The table of access cases every way in is asked about, as data.
 *
 * A case is who is asking, what they ask to do, to what, and which code rule
 * that target declares. Every dimension is a list here, and the rows are
 * generated from the lists, so adding a caller, a rule or a way in is one entry
 * rather than a new block of tests.
 *
 * Two readers share it: `access-every-way-in.integration.test.ts` pins what
 * each way in answers today, and checks each way in against the one answer
 * `oneAnswer` below works out from the composition the access design states.
 */

/**
 * Who is asking.
 *
 * `user-with` holds every permission the targets need through a role named
 * `editor`, and `custom-role` holds the same permissions through a role named
 * `reviewer`, so a rule that checks a role's NAME answers them differently
 * while the role screen says the same thing for both. The read-only and
 * full-access keys are made by `user-with`; the role-based key carries
 * `reviewer`; `key-super-admin` is a full-access key made by the super-admin.
 */
export const CALLERS = [
  "visitor",
  "user-with",
  "user-without",
  "custom-role",
  "super-admin",
  "super-admin-inherited",
  "key-read-only",
  "key-full-access",
  "key-role-based",
  "key-super-admin",
  "principal",
] as const;
export type Caller = (typeof CALLERS)[number];

const USERS: readonly Caller[] = [
  "user-with",
  "user-without",
  "custom-role",
  "super-admin",
  "super-admin-inherited",
];
const KEYS: readonly Caller[] = [
  "key-read-only",
  "key-full-access",
  "key-role-based",
  "key-super-admin",
];
const STAFF: readonly Caller[] = [...USERS, ...KEYS];

export function isKey(caller: Caller): boolean {
  return KEYS.includes(caller);
}

/**
 * The code rule a target declares, for every action it is asked about.
 *
 * `true` and `false` are the plain booleans the rule types and the
 * documentation allow. `other-operation` declares only `update: false`, so a
 * read, a create or a delete meets an access object with no rule for it.
 * `role-name` admits a caller whose roles include one named `editor`, the
 * shape a template rule takes when it checks names instead of permissions.
 */
export const RULES = [
  "none",
  "true",
  "false",
  "returns-true",
  "returns-false",
  "returns-null",
  "returns-undefined",
  "throws",
  "async-true",
  "async-false",
  "other-operation",
  "role-name",
] as const;
export type Rule = (typeof RULES)[number];

export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "publish",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What is asked about. A `related` target is a rule collection reached through
 * a relationship on another collection; `media` and `users` are the system
 * resources, which declare no code rule.
 */
export const TARGETS = [
  "collection",
  "single",
  "related",
  "media",
  "users",
] as const;
export type Target = (typeof TARGETS)[number];

/**
 * Every way in, in the order the answer file lists them.
 *
 * - `rest`: the REST collection, Single, media and users routes the admin uses.
 * - `direct`: the Direct API with `overrideAccess: false` and the caller.
 * - `website`: the website's checked rendering path, `resolveContent`.
 * - `route`: a plugin route gated by `requiredPermission`.
 * - `can`: `ctx.caller.can` inside a plugin route.
 * - `service`: a plugin service call made as the caller (`ServiceOpts`).
 * - `entity`: `canReadEntity`, behind versions, translations, document locks,
 *   widgets and the dashboard.
 * - `schema`: the schema builder's collection list.
 * - `population`: relationship and upload population.
 * - `system`: `canReadSystemResource`, behind media and users reads.
 */
export const DOORS = [
  "rest",
  "direct",
  "website",
  "route",
  "can",
  "service",
  "entity",
  "schema",
  "population",
  "system",
] as const;
export type Door = (typeof DOORS)[number];

/**
 * With or without the access-control service registered. Without it, only the
 * read of a collection and a Single is asked, by the callers and rules whose
 * answers a missing service can change.
 */
export type Setup = "service" | "no-service";

export interface Row {
  setup: Setup;
  caller: Caller;
  action: Action;
  target: Target;
  rule: Rule;
}

/** Which doors ask a case, so a row is never sent where it cannot be asked. */
function asks(door: Door, row: Row): boolean {
  const { caller, action, target, setup } = row;
  const read = action === "read";
  if (setup === "no-service") {
    if (target === "related") return door === "population";
    if (door === "direct") return true;
    return (
      caller !== "visitor" &&
      (door === "rest" || door === "entity" || door === "can")
    );
  }
  switch (door) {
    case "rest":
      if (caller === "principal") return false;
      if (target === "collection") return true;
      if (target === "single") return action === "read" || action === "update";
      return read && (target === "media" || target === "users");
    case "direct":
      if (target === "collection") return true;
      return target === "single" && (read || action === "update");
    case "website":
      return (
        target === "collection" &&
        read &&
        (caller === "visitor" || USERS.includes(caller))
      );
    case "route":
      if (caller === "principal") return false;
      if (target === "collection") return true;
      return target === "single" && (read || action === "update");
    case "can":
      if (!STAFF.includes(caller)) return false;
      if (target === "collection") return true;
      if (target === "single") return read || action === "update";
      return read && (target === "media" || target === "users");
    case "service":
      return target === "collection";
    case "entity":
      // Only a resolved caller reaches it: every route in front of it has
      // already refused a visitor.
      return (
        STAFF.includes(caller) &&
        read &&
        (target === "collection" || target === "single")
      );
    case "schema":
      return caller !== "principal" && read && target === "collection";
    case "population":
      return read && ["related", "media", "users"].includes(target);
    case "system":
      return (
        caller !== "principal" &&
        read &&
        (target === "media" || target === "users")
      );
  }
}

const NO_SERVICE_CALLERS: readonly Caller[] = [
  "visitor",
  "user-with",
  "user-without",
  "key-role-based",
];
const NO_SERVICE_RULES: readonly Rule[] = [
  "none",
  "returns-true",
  "returns-false",
  "returns-null",
];

/** Rows pinned elsewhere for now, which join this table later. */
function pinnedElsewhere(row: Row): boolean {
  return (
    row.caller === "visitor" &&
    (row.action === "create" ||
      row.action === "update" ||
      row.action === "delete")
  );
}

/** Every row the table holds, in a stable order. */
export function rows(): Row[] {
  const out: Row[] = [];
  for (const target of TARGETS) {
    const rules: readonly Rule[] =
      target === "media" || target === "users" ? ["none"] : RULES;
    for (const rule of rules) {
      for (const action of ACTIONS) {
        for (const caller of CALLERS) {
          const row: Row = { setup: "service", caller, action, target, rule };
          if (pinnedElsewhere(row)) continue;
          if (DOORS.some(door => asks(door, row))) out.push(row);
        }
      }
    }
  }
  for (const target of ["collection", "single", "related"] as const) {
    for (const rule of NO_SERVICE_RULES) {
      for (const caller of NO_SERVICE_CALLERS) {
        const row: Row = {
          setup: "no-service",
          caller,
          action: "read",
          target,
          rule,
        };
        if (DOORS.some(door => asks(door, row))) out.push(row);
      }
    }
  }
  return out;
}

export function doorsAsking(row: Row): Door[] {
  return DOORS.filter(door => asks(door, row));
}

export function rowKey(row: Row): string {
  return `${row.setup} ${row.caller} ${row.action} ${row.target} ${row.rule}`;
}

// ---------------------------------------------------------------------------
// The one answer
// ---------------------------------------------------------------------------

export type Verdict = "allow" | "refuse";

/** What the target's rule says to this caller for this action. */
function ruleSays(rule: Rule, action: Action, caller: Caller): boolean | null {
  switch (rule) {
    case "none":
      return null;
    case "other-operation":
      return action === "update" ? false : null;
    case "true":
    case "returns-true":
    case "async-true":
      return true;
    case "role-name":
      return holdsRoleNamedEditor(caller);
    default:
      return false;
  }
}

/** The callers whose roles, as a rule sees them, include one named `editor`. */
function holdsRoleNamedEditor(caller: Caller): boolean {
  return (
    caller === "user-with" ||
    caller === "key-read-only" ||
    caller === "key-full-access"
  );
}

/** Whether the role screen grants the caller this action on this target. */
function holdsPermission(caller: Caller, action: Action, target: Target) {
  switch (caller) {
    case "user-with":
    case "custom-role":
    case "key-full-access":
    case "key-role-based":
      return target !== "users";
    case "key-read-only":
      return action === "read" && target !== "users";
    case "key-super-admin":
      // A full-access key carries its maker's live permissions, and a
      // super-admin's are the whole catalogue.
      return true;
    default:
      return false;
  }
}

/**
 * The answer the composition in the access design gives a row, the same for
 * every way in and with or without the access-control service:
 *
 * - a visitor's permissions are the Public role's, and no Public role exists
 *   yet, so it holds none: every row is refused;
 * - a super-admin, held directly or through inheritance, passes every
 *   collection and Single rule. No key carries super-admin authority;
 * - a plugin's signed-in person holds no role, so the target's rule decides
 *   alone, and a target that declares none refuses;
 * - everyone else needs the permission AND, where the target declares a rule
 *   for the action, a rule that answers exactly `true`.
 */
export function oneAnswer(row: Row): Verdict {
  const { caller, action, target, rule } = row;
  const says = ruleSays(rule, action, caller);
  if (caller === "principal") return says === true ? "allow" : "refuse";
  if (caller === "visitor") return "refuse";
  if (caller === "super-admin" || caller === "super-admin-inherited") {
    return "allow";
  }
  if (!holdsPermission(caller, action, target)) return "refuse";
  return says === null || says === true ? "allow" : "refuse";
}

// ---------------------------------------------------------------------------
// The answers file
// ---------------------------------------------------------------------------

/**
 * One door's answer as the file spells it: `A` allowed, `R` refused, an HTTP
 * status for a refusal or failure that carried one, `E` for a failure without
 * one, and `.` where the door does not ask the row.
 */
export type Answer = string;

export function verdictOf(answer: Answer): Verdict | "error" {
  if (answer === "A") return "allow";
  if (answer === "R" || answer === "401" || answer === "403") return "refuse";
  if (answer === "404") return "refuse";
  return "error";
}

const COLUMNS = ["setup", "caller", "action", "target", "rule"] as const;

export function renderAnswers(
  answers: ReadonlyMap<string, ReadonlyMap<Door, Answer>>
): string {
  const header = [...COLUMNS, ...DOORS];
  const lines = rows().map(row => {
    const byDoor = answers.get(rowKey(row));
    return [
      ...COLUMNS.map(column => row[column]),
      ...DOORS.map(door => byDoor?.get(door) ?? "."),
    ];
  });
  const widths = header.map((title, i) =>
    Math.max(title.length, ...lines.map(line => line[i].length))
  );
  const pad = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return `${[pad(header), ...lines.map(pad)].join("\n")}\n`;
}

/** The answers a rendered file records, by row key and door. */
export function parseAnswers(text: string): Map<string, Map<Door, Answer>> {
  const out = new Map<string, Map<Door, Answer>>();
  const [, ...body] = text.split("\n").filter(line => line.trim() !== "");
  for (const line of body) {
    const cells = line.trim().split(/\s+/);
    const key = cells.slice(0, COLUMNS.length).join(" ");
    const byDoor = new Map<Door, Answer>();
    DOORS.forEach((door, i) => {
      const answer = cells[COLUMNS.length + i] ?? ".";
      if (answer !== ".") byDoor.set(door, answer);
    });
    out.set(key, byDoor);
  }
  return out;
}
