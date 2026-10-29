/**
 * Whether a widget declaration can work, checked as startup receives it.
 *
 * The types refuse most of these mistakes to an author writing TypeScript. A
 * plugin written in plain JavaScript, or one whose declarations arrive through
 * a bundler that dropped the types, reaches startup with nothing enforced, so
 * every rule the types state is checked again here, on the value.
 *
 * 🔴 Every fault, not the first. Each check below records a problem and carries
 * on, and startup reports the whole list in one message: an author with three
 * mistakes in two plugins fixes all three after one restart, rather than
 * discovering them one restart at a time.
 *
 * @module domains/widgets/declaration/validate
 */

import { z } from "zod";

import { NextlyError } from "../../../errors/nextly-error";
import { isAdminRelativePath } from "../admin-path";
import { isValidWidgetId, offeredProblem } from "../definition";
import { sizeDeclarationProblems } from "../grid-size";
import { RETIRED_WIDGET_NAMESPACES } from "../retired-widget-namespaces";
import {
  SETTING_NOT_AN_OBJECT,
  startingValueProblem,
  widgetSettingsProblems,
  type AnyWidgetSetting,
} from "../settings";

import { cardAnswerProblem } from "./card-answer";
import {
  CORE_VIEWS,
  displayOfView,
  isComponentView,
  isCoreView,
  viewOfDisplay,
} from "./displays";
import { isPermissionName } from "./permission-name";
import { quote } from "./quote";
import { transportableProblem } from "./transportable";

/** One thing wrong with one declaration, said where an author reads it. */
export interface WidgetDeclarationFault {
  /** Who declared it: `plugin "<name>"`, or `the site config`. */
  owner: string;
  /** The widget's id, or `(no id)` when it has none to name. */
  widget: string;
  /** What is wrong, and what to change. */
  problem: string;
}

/**
 * The declarations one owner contributes: a list, as an author writes it, or
 * whatever a plain JavaScript plugin put there instead, which is a fault.
 */
export interface WidgetDeclarationGroup {
  owner: string;
  declarations: unknown;
  /**
   * Core's own declarations: the one group whose ids are in core's `core/`
   * namespace, and must be. Set by core where it registers them, never read
   * from a plugin or the site.
   */
  core?: true;
}

/**
 * Namespaces core keeps for itself: its own widgets, and the namespaces of the
 * per-collection and per-Single cards it once made. A declared widget in
 * `core/` would take an id core may hand out tomorrow; one in a retired
 * namespace would be dropped from every saved layout that held it, since a
 * layout read drops those cards by namespace.
 */
const RESERVED_NAMESPACES = ["core", ...RETIRED_WIDGET_NAMESPACES] as const;

/** The fields a declaration may carry. Anything else is named as a mistake. */
const FIELDS = new Set([
  "id",
  "title",
  "description",
  "icon",
  "category",
  "size",
  "access",
  "offered",
  "shows",
  "several",
  "hidesWhenEmpty",
  "settings",
  "load",
  "view",
  "isEmpty",
  "empty",
  "preview",
  "summary",
]);

/**
 * The fields a declaration had before this shape, each with what took its
 * place, so a declaration written the old way is told the new name rather
 * than only that the old one is wrong.
 */
const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  data: 'it is now "load"',
  display: 'it is now "view"',
  example: 'it is now "preview", a list of named cases',
  permission: 'it is now "access"',
  sketch:
    "it is removed: the add panel draws the view's own skeleton until it draws the preview cases",
};

/** Said of a field this core types but does not apply yet, so a declaration fails closed. */
const LATER_RELEASE = "available in a later release";

const nonBlank = z.string().trim().min(1);
const isFunction = (value: unknown): boolean => typeof value === "function";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** One line of text: no line break anywhere in it. */
const oneLine = (text: string): boolean => !/[\r\n]/.test(text);

/**
 * Everything wrong with one declaration, in field order.
 *
 * `owner` is copied onto every fault, so a list gathered from several plugins
 * still says whose each one is.
 */
export function widgetDeclarationFaults(
  raw: unknown,
  owner: string,
  inCore = false
): WidgetDeclarationFault[] {
  if (!isRecord(raw)) {
    return [
      {
        owner,
        widget: "(no id)",
        problem: "a widget declaration must be an object",
      },
    ];
  }
  const widget = typeof raw.id === "string" ? raw.id : "(no id)";
  return declarationProblems(raw, inCore).map(problem => ({
    owner,
    widget,
    problem,
  }));
}

/** What one check finds: nothing, one problem, or several. */
type Found = string | readonly string[] | undefined;

/**
 * The checks a declaration goes through, in field order.
 *
 * A list of small checks rather than one long function, so each rule reads on
 * its own and a new field adds a line here rather than a branch somewhere in
 * the middle.
 */
const CHECKS: readonly ((
  d: Record<string, unknown>,
  inCore: boolean
) => Found)[] = [
  d =>
    Object.keys(d)
      .filter(key => !FIELDS.has(key))
      .map(key =>
        key in RENAMED_FIELDS
          ? `${quote(key)} is not a field of a widget declaration; ${RENAMED_FIELDS[key]}`
          : `${quote(key)} is not a field of a widget declaration`
      ),
  (d, inCore) => idProblem(d.id, inCore),
  d => requiredTextProblem("title", d.title),
  d => descriptionProblem(d.description),
  d => optionalTextProblem("icon", d.icon),
  d => optionalTextProblem("category", d.category),
  d => sizeProblems(d.size),
  d => accessProblem(d.access),
  d => declaredOfferedProblem(d.offered, d.settings),
  d =>
    d.shows === undefined || isFunction(d.shows)
      ? undefined
      : "shows must be a function of the person asking",
  d =>
    d.several === undefined || typeof d.several === "boolean"
      ? undefined
      : "several must be true or false",
  d =>
    d.hidesWhenEmpty === undefined || typeof d.hidesWhenEmpty === "boolean"
      ? undefined
      : "hidesWhenEmpty must be true or false",
  d => settingsProblems(d.settings),
  d => loadProblem(d.load),
  d => viewProblem(d.view),
  d => isEmptyProblem(d.isEmpty, d.view),
  d => emptyProblems(d.empty, d.settings),
  d => previewProblems(d.preview, d.view, d.settings),
  d => summaryProblems(d.summary),
];

/** The problems with a declaration that is at least an object. */
function declarationProblems(
  d: Record<string, unknown>,
  inCore: boolean
): string[] {
  return CHECKS.flatMap(check => {
    const found = check(d, inCore);
    if (found === undefined) return [];
    return typeof found === "string" ? [found] : [...found];
  });
}

/** Why `value` is not a usable required text `field`, or `undefined`. */
export function requiredTextProblem(
  field: string,
  value: unknown
): string | undefined {
  if (value === undefined) return `${field} is required`;
  return nonBlank.safeParse(value).success
    ? undefined
    : `${field} must be a non-empty string`;
}

/** Why `value` is not a usable optional text `field`, or `undefined`. */
function optionalTextProblem(
  field: string,
  value: unknown
): string | undefined {
  return value === undefined || nonBlank.safeParse(value).success
    ? undefined
    : `${field} must be a non-empty string when given`;
}

/** The keys that each name one of `access`'s object forms. */
const ACCESS_FORMS = ["collections", "anyOf", "allOf"] as const;

/**
 * Why `access` is none of its forms, or `undefined`: a permission gate (a
 * permission name, `{ anyOf }` or `{ allOf }`), the collections the widget
 * reads (each judged with the person through the batch's own check), or a
 * predicate of the person.
 */
function accessProblem(access: unknown): string | undefined {
  if (access === undefined || isPermissionName(access) || isFunction(access)) {
    return undefined;
  }
  // 🔴 A bare list is refused rather than read as one of the two gates: an
  // author writing one means "any of these" or "all of these", and whichever
  // was guessed would gate the widget for people its author did not intend.
  if (Array.isArray(access)) {
    return "access cannot be a list: write { anyOf: [...] } for any one of several permissions, or { allOf: [...] } for every one of them";
  }
  if (isRecord(access)) {
    const forms = ACCESS_FORMS.filter(form => form in access);
    if (forms.length > 1) {
      return `access must take one form, but names ${forms.join(" and ")}`;
    }
    if ("collections" in access) return collectionsAccessProblem(access);
    if ("anyOf" in access || "allOf" in access) return gateProblem(access);
  }
  return `access must be a permission name such as "read-orders", { anyOf }, { allOf }, { collections }, or a function of the person, got ${quote(access)}`;
}

function collectionsAccessProblem(
  access: Record<string, unknown>
): string | undefined {
  const { collections } = access;
  return Array.isArray(collections) &&
    collections.length > 0 &&
    collections.every(slug => nonBlank.safeParse(slug).success)
    ? undefined
    : "access.collections must be a list of the collections the widget reads, each named by its slug";
}

/**
 * Why an `{ anyOf }` or `{ allOf }` gate cannot be used, or `undefined`.
 *
 * Every list must name at least one permission, each as stored: "any of
 * nothing" admits nobody and "all of nothing" everybody, each reading to its
 * author like the opposite. The gate the registry judges refuses both as
 * unusable (`requiredPermissionGroups`); refused here, the author is told at
 * startup which list is wrong rather than finding the widget offered to
 * nobody.
 */
function gateProblem(gate: Record<string, unknown>): string | undefined {
  const extra = Object.keys(gate).filter(
    key => key !== "anyOf" && key !== "allOf"
  );
  if (extra.length > 0) {
    return `access takes no ${extra.map(quote).join(", ")} beside its ${"anyOf" in gate ? "anyOf" : "allOf"}`;
  }
  if ("anyOf" in gate) return anyOfProblem(gate.anyOf, "access.anyOf");
  const { allOf } = gate;
  if (!Array.isArray(allOf) || allOf.length === 0) {
    return "access.allOf must be a non-empty list, each entry a permission name or { anyOf: [...] }";
  }
  // A stray comma's empty slot is named as one, not as an entry that is no permission.
  const sparse = sparseListProblem(allOf, "access.allOf");
  if (sparse !== undefined) return sparse;
  for (const [index, entry] of allOf.entries()) {
    const problem = allOfEntryProblem(entry, `access.allOf[${index}]`);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** Why one `allOf` entry is neither a permission name nor `{ anyOf }`, or `undefined`. */
function allOfEntryProblem(entry: unknown, at: string): string | undefined {
  if (isPermissionName(entry)) return undefined;
  if (isRecord(entry) && Object.keys(entry).join() === "anyOf") {
    return anyOfProblem(entry.anyOf, `${at}.anyOf`);
  }
  return `${at} must be a permission name such as "read-orders" or { anyOf: [...] }, got ${quote(entry)}`;
}

/** Why an any-of list is not a non-empty list of permission names, or `undefined`. */
function anyOfProblem(list: unknown, at: string): string | undefined {
  // `every` skips an empty slot, so a list with one would pass as if the
  // entry were never written: refused by the declarations' own rule instead.
  const sparse = Array.isArray(list) ? sparseListProblem(list, at) : undefined;
  if (sparse !== undefined) return sparse;
  return Array.isArray(list) && list.length > 0 && list.every(isPermissionName)
    ? undefined
    : `${at} must be a non-empty list of permission names such as "read-orders"`;
}

/**
 * Why `offered` cannot work, or `undefined`: judged by the registry's own rule
 * (`offeredProblem`), so a declaration it would refuse when published stops
 * startup with every other fault, before any widget is kept. The registry
 * reads settings as a list, so the declaration's are handed over as one.
 */
function declaredOfferedProblem(
  offered: unknown,
  settings: unknown
): string | undefined {
  return offeredProblem({
    offered,
    settings: isRecord(settings) ? Object.values(settings) : settings,
  });
}

/**
 * Every problem with a widget's preview cases. Each is drawn as the card's
 * ready state on the preview page, so its data is held to the rule every
 * card's data is held to (`cardAnswerProblem`): it reaches the browser as
 * itself, and a core view's data has the shape that view draws. Its settings
 * are what the case is drawn with, so each must be one the widget declares,
 * with a value that setting accepts (`previewSettingsProblems`).
 */
function previewProblems(
  preview: unknown,
  view: unknown,
  settings: unknown
): string[] {
  if (preview === undefined) return [];
  if (!Array.isArray(preview)) {
    return ["preview must be a list of cases, each { name, data, settings? }"];
  }
  const display =
    isCoreView(view) || isComponentView(view) ? displayOfView(view) : view;
  const names = new Set<string>();
  return preview.flatMap((entry: unknown, index): string[] => {
    const at = `preview[${index}]`;
    if (!isRecord(entry)) return [`${at} must be { name, data, settings? }`];
    const problems: string[] = [];
    const name = nonBlank.safeParse(entry.name);
    if (!name.success) problems.push(`${at}.name must be a non-empty string`);
    else if (names.has(name.data)) {
      problems.push(`${at}.name "${name.data}" is used by another case`);
    } else names.add(name.data);
    if (entry.settings !== undefined && !isRecord(entry.settings)) {
      problems.push(`${at}.settings must be an object of setting values`);
    } else if (entry.settings !== undefined) {
      problems.push(
        ...previewCaseSettingsProblems(at, entry.settings, settings)
      );
    }
    const problem = cardAnswerProblem(display, entry.data);
    if (problem !== undefined) {
      problems.push(
        problem.kind === "untransportable"
          ? `${at}.data cannot be sent to the browser as it is: ${problem.detail.replace("the value", `${at}.data`)}`
          : `${at}.data does not have the shape the "${viewOfDisplay(problem.display)}" view draws (${problem.detail})`
      );
    }
    return problems;
  });
}

/**
 * Why a preview case's settings cannot be drawn: first whether they reach the
 * browser as themselves, then whether each value is one the widget accepts.
 *
 * 🔴 The transport rule first, and on its own. The preview page is sent each
 * case whole, its settings beside its data, and a setting's own type does not
 * keep every value out that JSON changes: a `filter` setting accepts any plain
 * object, so a `Date`, a `Map` or a class instance nested in one passed its
 * type and arrived as a string or `{}`. Judged by the rule a card's data is
 * held to (`transportableProblem`), in the words a case's data is refused in.
 */
function previewCaseSettingsProblems(
  at: string,
  values: Record<string, unknown>,
  settings: unknown
): string[] {
  const where = `${at}.settings`;
  const untransportable = transportableProblem(values);
  if (untransportable !== undefined) {
    return [
      `${where} cannot be sent to the browser as it is: ${untransportable.replace("the value", where)}`,
    ];
  }
  return previewSettingsProblems(where, values, settings);
}

/**
 * Why each of a preview case's setting values cannot be drawn: a name the
 * widget does not declare, or a value its setting would refuse as a starting
 * value (`startingValueProblem`), the rule a site dashboard's starting values
 * are held to, so a case never shows a card no reader could set up.
 *
 * Judged only once the widget's own settings are sound: their faults are
 * reported as themselves, and a value cannot be judged against a setting
 * that is not one.
 */
function previewSettingsProblems(
  where: string,
  values: Record<string, unknown>,
  settings: unknown
): string[] {
  const declared = isRecord(settings) ? settings : {};
  const named = Object.entries(declared).map(([name, setting]) =>
    isRecord(setting) ? { ...setting, name } : setting
  );
  // The shared rules passing is what makes each entry a setting.
  const sound =
    widgetSettingsProblems(named).length === 0
      ? (named as AnyWidgetSetting[])
      : undefined;
  return Object.entries(values).flatMap(([name, value]) => {
    if (!Object.hasOwn(declared, name)) {
      return [`${where} sets "${name}", which the widget does not declare`];
    }
    const setting = sound?.find(candidate => candidate.name === name);
    if (setting === undefined) return [];
    const problem = startingValueProblem(setting, value);
    return problem === undefined ? [] : [`${where}: ${problem}`];
  });
}

/**
 * Every problem with a widget's summary: a label and a count, run as the
 * person. A well-formed one is refused until the dashboard's header reads it:
 * started, it would be accepted and never shown.
 */
function summaryProblems(summary: unknown): string[] {
  if (summary === undefined) return [];
  if (!isRecord(summary)) return ["summary must be { label, count }"];
  const problems = [
    ...optional(
      nonBlank.safeParse(summary.label).success
        ? undefined
        : "summary.label must be a non-empty string"
    ),
    ...optional(
      isFunction(summary.count)
        ? undefined
        : "summary.count must be a function that counts, as the person asking"
    ),
  ];
  return problems.length > 0
    ? problems
    : [
        `summary is ${LATER_RELEASE}: until then a widget that declares it is not started, so a summary it states is never accepted and left unshown`,
      ];
}

function idProblem(id: unknown, inCore: boolean): string | undefined {
  if (id === undefined) return "id is required";
  if (!isValidWidgetId(id)) {
    return `id must be namespace/name in lowercase slug form, such as "acme/orders", got ${quote(id)}`;
  }
  const namespace = id.slice(0, id.indexOf("/"));
  // Core's own widgets live in `core/`, and only there: the per-collection and
  // per-Single namespaces are retired, and nobody's.
  if (inCore) {
    return namespace === "core"
      ? undefined
      : `id "${id}" is one of core's own widgets, so it must be in the "core/" namespace`;
  }
  if ((RESERVED_NAMESPACES as readonly string[]).includes(namespace)) {
    return `id "${id}" is in the reserved "${namespace}/" namespace; use your own, such as your package's name`;
  }
  return undefined;
}

/**
 * Why `description` is not one line of text, or `undefined`.
 *
 * Its length is no fault: the add gallery truncates a long one, and refusing
 * to start over a sentence's length stops a whole site for a cosmetic reason.
 */
export function descriptionProblem(description: unknown): string | undefined {
  if (description === undefined) return "description is required";
  const parsed = nonBlank.safeParse(description);
  if (!parsed.success) return "description must be a non-empty string";
  if (!oneLine(parsed.data)) return "description must be one line";
  return undefined;
}

/**
 * Every problem with a declaration's size: its starting size and the bounds
 * it may be resized within, in grid units.
 *
 * 🔴 Judged by the grid's own rules (`sizeDeclarationProblems`), the ones the
 * registry and the site config's checks use, so a declaration and a stored
 * definition cannot be judged by two rules.
 */
function sizeProblems(size: unknown): readonly string[] {
  if (size === undefined) return ["size is required"];
  return sizeDeclarationProblems(size);
}

/** A problem as a list of none or one, to spread into a longer list. */
const optional = (problem: string | undefined): string[] =>
  problem === undefined ? [] : [problem];

/**
 * Every problem with a declaration's settings.
 *
 * Judged by the registry's own rules (`widgetSettingsProblems`), every type
 * alike, each setting with its key as its name: a declaration and a stored
 * definition cannot be judged by two rules, the dependency rule (a filter,
 * sort or grouping names one of the widget's own Collection settings)
 * included. What only a declaration can get wrong is named here first: a
 * setting that is not an object at all, and one without a label. The builders'
 * types require a label, so this is the refusal plain JavaScript meets; a
 * stored definition may still omit one, and its sheet falls back to the name.
 */
function settingsProblems(settings: unknown): string[] {
  if (settings === undefined) return [];
  if (!isRecord(settings)) {
    return ["settings must be an object of setting declarations"];
  }
  const entries = Object.entries(settings);
  const malformed = entries
    .filter(([, setting]) => !isRecord(setting))
    .map(([name]) => `setting "${name}" must be a setting declaration`);
  const unlabelled = entries
    .filter(
      ([, setting]) =>
        isRecord(setting) && !nonBlank.safeParse(setting.label).success
    )
    .map(
      ([name]) =>
        `setting "${name}" needs a label: the settings sheet names every setting by what its label says, never by its key`
    );
  /*
   * 🔴 Every entry goes to the shared rules, the malformed ones included, so
   * the limit on how many there are and every well-formed sibling are still
   * judged in the same restart. Only the shared rules' unnamed fault for a
   * non-object is dropped: it is named above, by the key the author wrote.
   */
  const shared = widgetSettingsProblems(
    entries.map(([name, setting]) =>
      isRecord(setting) ? { ...setting, name } : setting
    )
  ).filter(problem => problem !== SETTING_NOT_AN_OBJECT);
  return [...malformed, ...unlabelled, ...shared];
}

/**
 * Why `load` is not a function of the card's settings and the person asking,
 * or `undefined`. The `{ query }` form a declaration once had is named, with
 * what to write instead, rather than refused as any other value.
 */
function loadProblem(load: unknown): string | undefined {
  if (load === undefined) return "load is required";
  if (isFunction(load)) return undefined;
  if (isRecord(load) && "query" in load) {
    return "load must be a function: the { query } form is removed. Read with the services a load function is handed (count, find), which read as the person asking";
  }
  return "load must be a function of the card's settings and the person asking";
}

function viewProblem(view: unknown): string | undefined {
  if (view === undefined) return "view is required";
  if (isCoreView(view)) return undefined;
  if (isRecord(view) && "component" in view) {
    return nonBlank.safeParse(view.component).success
      ? undefined
      : 'view.component must name where the admin loads the component from, as "<module>#<Export>"';
  }
  return `view must be one of core's views (${Object.keys(CORE_VIEWS).join(", ")}) or { component: "<module>#<Export>" }, got ${quote(view)}`;
}

/**
 * Every problem with a declaration's empty state: its message and its one action. Handed the
 * declaration's settings, since an action that opens them needs some to open.
 */
function emptyProblems(empty: unknown, settings: unknown): string[] {
  if (empty === undefined) return [];
  if (!isRecord(empty)) return ["empty must be { message?, action? }"];
  return [
    // `when` was where the test lived; left there it would never run, so it
    // is named with where it went rather than ignored.
    ...Object.keys(empty)
      .filter(key => key !== "message" && key !== "action")
      .map(key =>
        key === "when"
          ? `${quote(key)} is not a field of empty; the test is now "isEmpty", beside it`
          : `${quote(key)} is not a field of empty, which holds a message and an action`
      ),
    ...optional(emptyMessageProblem(empty.message)),
    ...emptyActionProblems(empty.action, settings),
  ];
}

function isEmptyProblem(isEmpty: unknown, view: unknown): string | undefined {
  if (isEmpty !== undefined) {
    return isFunction(isEmpty)
      ? undefined
      : "isEmpty must be a function of the widget's data";
  }
  // A core view has its own rule for when its data is empty; a component has
  // none, so the empty state could never be shown. A view that is neither is
  // named by its own check, not here as well.
  return isComponentView(view)
    ? "isEmpty is required for a view with its own component: core cannot tell when its data is empty"
    : undefined;
}

function emptyMessageProblem(message: unknown): string | undefined {
  if (message === undefined) return undefined;
  const parsed = nonBlank.safeParse(message);
  return parsed.success && oneLine(parsed.data)
    ? undefined
    : "empty.message must be one line of text";
}

/**
 * Every problem with an empty state's one action: a link relative to the admin, with the
 * permission it is offered under, or `opens: "settings"`, the card's own settings sheet. One
 * or the other, never both, so the frame never has to choose which one a click takes.
 */
function emptyActionProblems(action: unknown, settings: unknown): string[] {
  if (action === undefined) return [];
  if (!isRecord(action) || !nonBlank.safeParse(action.label).success) {
    return ["empty.action must have a label"];
  }
  if (action.opens !== undefined) return opensActionProblems(action, settings);
  return [
    ...optional(
      isAdminRelativePath(action.link)
        ? undefined
        : `empty.action.link must be a path relative to the admin, such as "collections/orders", got ${quote(action.link)}`
    ),
    ...optional(
      action.permission === undefined || isPermissionName(action.permission)
        ? undefined
        : `empty.action.permission must be a permission name such as "create-orders", got ${quote(action.permission)}`
    ),
  ];
}

/** Every problem with an action that opens the card's settings, as `opens` says. */
function opensActionProblems(
  action: Record<string, unknown>,
  settings: unknown
): string[] {
  if (action.opens !== "settings") {
    return [
      `empty.action.opens must be "settings", the card's own settings, got ${quote(action.opens)}`,
    ];
  }
  return [
    ...optional(
      action.link === undefined && action.permission === undefined
        ? undefined
        : 'empty.action opens the card\'s settings, so it takes no link or permission: give either { label, link, permission? } or { label, opens: "settings" }'
    ),
    // Nothing to open: the button would open an empty sheet, or none at all.
    ...optional(
      isRecord(settings) && Object.keys(settings).length > 0
        ? undefined
        : "empty.action opens the card's settings, but the widget declares none: declare the setting it asks for, or give a link instead"
    ),
  ];
}

/**
 * Why a list has an empty slot, naming the list and the first slot, or
 * `undefined`: `[a, , b]` holds a hole every reading of it skips, so an entry
 * left out by a stray comma would otherwise vanish without a word.
 */
export function sparseListProblem(
  list: readonly unknown[],
  name: string
): string | undefined {
  for (let index = 0; index < list.length; index++) {
    if (!(index in list)) {
      return `${name} has an empty slot at position ${index + 1}; remove the extra comma`;
    }
  }
  return undefined;
}

/**
 * Why an owner's declarations are not a list to check one by one: not a list at all, or one with
 * an empty slot, which every reading of it would skip. `undefined` for a list.
 */
function groupShapeFault(
  owner: string,
  declarations: unknown
): WidgetDeclarationFault | undefined {
  if (!Array.isArray(declarations)) {
    return {
      owner,
      widget: "(none)",
      problem: "its dashboard widgets must be a list of widget declarations",
    };
  }
  const sparse = sparseListProblem(declarations, "widgets");
  return sparse === undefined
    ? undefined
    : { owner, widget: "(widgets)", problem: sparse };
}

/**
 * Every fault across every owner's declarations, a duplicate id included.
 *
 * A duplicate is reported against the later claimant, naming the earlier one,
 * so the message tells its reader which two to reconcile.
 */
export function collectWidgetDeclarationFaults(
  groups: readonly WidgetDeclarationGroup[]
): WidgetDeclarationFault[] {
  const faults: WidgetDeclarationFault[] = [];
  const claimed = new Map<string, string>();
  for (const group of groups) {
    const { owner, declarations } = group;
    const shape = groupShapeFault(owner, declarations);
    if (shape !== undefined) {
      faults.push(shape);
      continue;
    }
    for (const declaration of declarations as readonly unknown[]) {
      faults.push(
        ...widgetDeclarationFaults(declaration, owner, group.core === true)
      );
      const id = isRecord(declaration) ? declaration.id : undefined;
      if (typeof id !== "string") continue;
      const earlier = claimed.get(id);
      if (earlier === undefined) claimed.set(id, owner);
      else {
        faults.push({
          owner,
          widget: id,
          problem: `id "${id}" is already declared by ${earlier}`,
        });
      }
    }
  }
  return faults;
}

/**
 * Refuses startup when any declaration cannot work, with every fault in one
 * message.
 */
export function assertWidgetDeclarations(
  groups: readonly WidgetDeclarationGroup[]
): void {
  const faults = collectWidgetDeclarationFaults(groups);
  if (faults.length > 0) throw widgetDeclarationsRefused(faults);
}

/**
 * The startup error for a list of faults.
 *
 * The public message stays generic, as every boot-time plugin error's does;
 * the list an author acts on goes to the log a boot failure is read in.
 */
export function widgetDeclarationsRefused(
  faults: readonly WidgetDeclarationFault[]
): NextlyError {
  const count =
    faults.length === 1
      ? "1 widget declaration cannot work"
      : `${faults.length} widget declarations cannot work`;
  return new NextlyError({
    code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage: [
      `${count}. Fix each, then restart:`,
      ...faults.map(
        fault => `- ${fault.owner}, widget "${fault.widget}": ${fault.problem}`
      ),
    ].join("\n"),
    logContext: { faults },
  });
}
