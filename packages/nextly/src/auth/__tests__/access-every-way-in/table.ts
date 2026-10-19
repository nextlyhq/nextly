/**
 * The table of access cases every way in is asked about, as data.
 *
 * A case is who is asking, what they ask to do, to what, and which code rule
 * that target declares. Every dimension is a list here, and the rows are
 * generated from the lists, so adding a caller, a rule or a way in is one entry
 * rather than a new block of tests.
 *
 * The suite in `suite.ts` reads it twice: it pins what each way in answers
 * today, and checks each way in against the one answer `oneAnswer` below
 * works out for every row.
 */

/**
 * Who is asking.
 *
 * `user-with` holds every permission the targets need through a role named
 * `editor`, and `custom-role` holds the same permissions through a role named
 * `reviewer`, so a rule that checks a role's NAME answers them differently
 * while the role screen says the same thing for both. `user-partial` holds
 * read, update and publish only, through a role named `partial`, so a door
 * that asks for the wrong action's permission answers it differently from the
 * others. The read-only and full-access keys are made by `user-with`; the
 * role-based keys carry `reviewer` and `partial`; `key-super-admin` is a
 * full-access key made by the super-admin. `principal` and `principal-other`
 * are plugin-defined signed-in people of two different kinds.
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
  "user-partial",
  "key-partial",
  "principal",
  "principal-other",
] as const;
export type Caller = (typeof CALLERS)[number];

const USERS: readonly Caller[] = [
  "user-with",
  "user-without",
  "custom-role",
  "super-admin",
  "super-admin-inherited",
  "user-partial",
];
const KEYS: readonly Caller[] = [
  "key-read-only",
  "key-full-access",
  "key-role-based",
  "key-super-admin",
  "key-partial",
];
const STAFF: readonly Caller[] = [...USERS, ...KEYS];

const PRINCIPALS: readonly Caller[] = ["principal", "principal-other"];

/**
 * The code rule a target declares, for every action it is asked about.
 *
 * `true` and `false` are the plain booleans the rule types and the
 * documentation allow. `throws` fails as it is called and `async-throws`
 * returns a promise that rejects, so a door that guards the call but awaits
 * its result outside the guard answers the two differently. `other-operation`
 * declares only `update: false`, so a
 * read, a create or a delete meets an access object with no rule for it.
 * `role-name` admits a caller whose roles include one named `editor`, the
 * shape a template rule takes when it checks names instead of permissions.
 * `permission-spelling` admits a caller whose rule-facing permissions hold
 * `<collection>:<operation>`, the spelling a rule is promised, so a door that
 * hands a rule the stored `<operation>-<collection>` spelling refuses it.
 * `principal-kind` admits only a person of the `principal` caller's kind,
 * so a door that drops the person from the rule's context refuses it too.
 * `user-present` admits a caller the rule is handed a `user` for: a signed-in
 * user, and an API key, which acts as the user who made it. A visitor and a
 * plugin's person have none, so a door that hands a rule the wrong `user`, or
 * none, answers it differently.
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
  "async-throws",
  "other-operation",
  "role-name",
  "permission-spelling",
  "principal-kind",
  "user-present",
] as const;
export type Rule = (typeof RULES)[number];

/**
 * What a caller asks to do. `list` and `count` read a collection's entries
 * through the list and count paths, which a door judges apart from the read
 * of one entry by its id.
 */
export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "publish",
  "unpublish",
  "list",
  "count",
] as const;
export type Action = (typeof ACTIONS)[number];

/** The actions that name one entry, which every collection door can ask. */
const ENTRY_ACTIONS = ACTIONS.filter(
  action => action !== "list" && action !== "count"
);

/**
 * What is asked about. A `related` target is a rule collection reached through
 * a relationship on another collection; `media` and `users` are the system
 * resources, which declare no code rule. A `single-pub` target is a Single
 * with a draft and a published status, asked to publish and unpublish.
 */
export const TARGETS = [
  "collection",
  "single",
  "related",
  "media",
  "users",
  "single-pub",
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

/** Which callers a door can name, and which actions it asks of each target. */
interface Reach {
  callers: readonly Caller[];
  targets: Partial<Record<Target, readonly Action[]>>;
}

const READ: readonly Action[] = ["read"];
const READ_UPDATE: readonly Action[] = ["read", "update"];
const PUBLISHING: readonly Action[] = ["publish", "unpublish"];
const NOT_PRINCIPAL = CALLERS.filter(caller => !PRINCIPALS.includes(caller));
const NOT_VISITOR = CALLERS.filter(caller => caller !== "visitor");

/**
 * What each door asks, with the access-control service registered.
 *
 * A principal is read only by routes that declare one, so the staff routes,
 * the readers behind them and the schema list never see it. Only a resolved
 * caller reaches `entity` and `can`: every route in front of them has already
 * refused a visitor. `website` names a user or nobody, never a key. A
 * plugin route's gate and `can` name one permission for one entry, so they are
 * asked no `list` or `count`.
 */
const REACH: Record<Door, Reach> = {
  rest: {
    callers: NOT_PRINCIPAL,
    targets: {
      collection: ACTIONS,
      single: READ_UPDATE,
      media: READ,
      users: READ,
      "single-pub": PUBLISHING,
    },
  },
  direct: {
    callers: CALLERS,
    targets: {
      collection: ACTIONS,
      single: READ_UPDATE,
      "single-pub": PUBLISHING,
    },
  },
  website: { callers: ["visitor", ...USERS], targets: { collection: READ } },
  route: {
    callers: NOT_PRINCIPAL,
    targets: {
      collection: ENTRY_ACTIONS,
      single: READ_UPDATE,
      "single-pub": PUBLISHING,
    },
  },
  can: {
    callers: STAFF,
    targets: {
      collection: ENTRY_ACTIONS,
      single: READ_UPDATE,
      media: READ,
      users: READ,
      "single-pub": PUBLISHING,
    },
  },
  service: { callers: CALLERS, targets: { collection: ACTIONS } },
  entity: { callers: STAFF, targets: { collection: READ, single: READ } },
  schema: { callers: NOT_PRINCIPAL, targets: { collection: READ } },
  population: {
    callers: CALLERS,
    targets: { related: READ, media: READ, users: READ },
  },
  system: { callers: NOT_PRINCIPAL, targets: { media: READ, users: READ } },
};

/** What each door asks without the access-control service. */
const REACH_WITHOUT_SERVICE: Partial<Record<Door, Reach>> = {
  rest: { callers: NOT_VISITOR, targets: { collection: READ, single: READ } },
  direct: { callers: CALLERS, targets: { collection: READ, single: READ } },
  can: { callers: NOT_VISITOR, targets: { collection: READ, single: READ } },
  entity: { callers: NOT_VISITOR, targets: { collection: READ, single: READ } },
  population: { callers: CALLERS, targets: { related: READ } },
};

/** Whether a door asks a case, so a row is never sent where it cannot be. */
function asks(door: Door, row: Row): boolean {
  const reach = (row.setup === "service" ? REACH : REACH_WITHOUT_SERVICE)[door];
  if (!reach || !reach.callers.includes(row.caller)) return false;
  return reach.targets[row.target]?.includes(row.action) ?? false;
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

/** Rows left out of this table for now, which join it later. */
function joinsLater(row: Row): boolean {
  return (
    row.setup === "service" &&
    row.caller === "visitor" &&
    ["create", "update", "delete"].includes(row.action)
  );
}

/** Every combination of the lists, target first and caller last. */
function cross(
  setup: Setup,
  targets: readonly Target[],
  rulesOf: (target: Target) => readonly Rule[],
  actions: readonly Action[],
  callers: readonly Caller[]
): Row[] {
  return targets.flatMap(target =>
    rulesOf(target).flatMap(rule =>
      actions.flatMap(action =>
        callers.map(caller => ({ setup, caller, action, target, rule }))
      )
    )
  );
}

/** The system resources declare no code rule, so they are asked once. */
const rulesOf = (target: Target): readonly Rule[] =>
  target === "media" || target === "users" ? ["none"] : RULES;

/** Every row the table holds, in a stable order. */
export function rows(): Row[] {
  const withService = cross("service", TARGETS, rulesOf, ACTIONS, CALLERS);
  const withoutService = cross(
    "no-service",
    ["collection", "single", "related"],
    () => NO_SERVICE_RULES,
    READ,
    NO_SERVICE_CALLERS
  );
  return [...withService, ...withoutService].filter(
    row => !joinsLater(row) && DOORS.some(door => asks(door, row))
  );
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

/**
 * What a rule says to a caller for an action: `true` only when it answers
 * exactly `true`, and `null` where it declares nothing for the action.
 */
type RuleAnswer = (action: Action, caller: Caller) => boolean | null;

const SAYS_TRUE: RuleAnswer = () => true;
/** `false`, a non-boolean answer and a throw all count as a refusal. */
const SAYS_NOT_TRUE: RuleAnswer = () => false;

/** What each rule says, one entry per rule so none is decided by a fallback. */
const RULE_SAYS: Record<Rule, RuleAnswer> = {
  none: () => null,
  true: SAYS_TRUE,
  false: SAYS_NOT_TRUE,
  "returns-true": SAYS_TRUE,
  "returns-false": SAYS_NOT_TRUE,
  "returns-null": SAYS_NOT_TRUE,
  "returns-undefined": SAYS_NOT_TRUE,
  throws: SAYS_NOT_TRUE,
  "async-true": SAYS_TRUE,
  "async-false": SAYS_NOT_TRUE,
  "async-throws": SAYS_NOT_TRUE,
  "other-operation": action => (action === "update" ? false : null),
  "role-name": (_action, caller) => holdsRoleNamedEditor(caller),
  "permission-spelling": (action, caller) =>
    STAFF.includes(caller) && holdsPermission(caller, action, "collection"),
  "principal-kind": (_action, caller) => caller === "principal",
  "user-present": (_action, caller) =>
    USERS.includes(caller) || KEYS.includes(caller),
};

/** The callers whose roles, as a rule sees them, include one named `editor`. */
function holdsRoleNamedEditor(caller: Caller): boolean {
  return (
    caller === "user-with" ||
    caller === "key-read-only" ||
    caller === "key-full-access"
  );
}

const PARTIAL_ACTIONS: readonly Action[] = ["read", "update", "publish"];

/**
 * The actions the role screen grants each caller on the rule targets and
 * media. A caller missing here holds none of them.
 */
const GRANTS: Partial<Record<Caller, (action: Action) => boolean>> = {
  "user-with": () => true,
  "custom-role": () => true,
  "key-full-access": () => true,
  "key-role-based": () => true,
  "key-read-only": action => action === "read",
  "user-partial": action => PARTIAL_ACTIONS.includes(action),
  "key-partial": action => PARTIAL_ACTIONS.includes(action),
};

/** Whether the role screen grants the caller this action on this target. */
function holdsPermission(caller: Caller, action: Action, target: Target) {
  // A full-access key carries its maker's live permissions, and a
  // super-admin's are the whole catalogue, users included.
  if (caller === "key-super-admin") return true;
  if (target === "users") return false;
  return GRANTS[caller]?.(action) ?? false;
}

/** A list and a count are reads; every other action is judged as itself. */
const judgedAs = (action: Action): Action =>
  action === "list" || action === "count" ? "read" : action;

const isLifecycle = (action: Action) =>
  action === "publish" || action === "unpublish";

/**
 * Whether the target's rules let the action through: its own rule, where the
 * target declares one, answers exactly `true`, and for a publish or an
 * unpublish the update rule does not refuse.
 */
function rulesAllow(rule: Rule, action: Action, caller: Caller): boolean {
  const says = RULE_SAYS[rule](action, caller);
  if (says !== null && says !== true) return false;
  return !(isLifecycle(action) && RULE_SAYS[rule]("update", caller) === false);
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
 *   alone, and a target that declares none refuses. As today, a person never
 *   publishes or unpublishes, whatever the rule says;
 * - everyone else needs the permission AND, where the target declares a rule
 *   for the action, a rule that answers exactly `true`. A publish or an
 *   unpublish is judged on top of update (`shared/types/access.ts`), so where
 *   the target declares an update rule, it must allow the change as well.
 *   A `list` and a `count` are reads, judged by the read permission and rule.
 */
export function oneAnswer(row: Row): Verdict {
  const { caller, target, rule } = row;
  const action = judgedAs(row.action);
  if (PRINCIPALS.includes(caller)) {
    const allowed =
      !isLifecycle(action) && RULE_SAYS[rule](action, caller) === true;
    return allowed ? "allow" : "refuse";
  }
  if (caller === "visitor") return "refuse";
  if (caller === "super-admin" || caller === "super-admin-inherited") {
    return "allow";
  }
  const allowed =
    holdsPermission(caller, action, target) && rulesAllow(rule, action, caller);
  return allowed ? "allow" : "refuse";
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
