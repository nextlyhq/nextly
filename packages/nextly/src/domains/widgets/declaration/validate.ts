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
import { isValidWidgetId } from "../definition";
import { SETTING_NOT_AN_OBJECT, widgetSettingsProblems } from "../settings";
import { WIDGET_WIDTHS, type WidgetWidth } from "../widths";

import { cardAnswerProblem } from "./card-answer";
import { CORE_DISPLAYS, isCoreDisplay } from "./displays";
import { quote } from "./quote";

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
}

/** The widths a card may take: core's own list, narrowest first. */
const WIDTHS: readonly WidgetWidth[] = WIDGET_WIDTHS;

/**
 * Namespaces core keeps for itself: its own widgets, and the cards it generates
 * per collection and per Single. A declared widget there would take an id core
 * may hand out tomorrow.
 */
const RESERVED_NAMESPACES = ["core", "collection", "single"] as const;

/** The longest description the add panel shows on one line. */
const MAX_DESCRIPTION = 80;

/**
 * A permission as core stores and seeds it, `action-resource` (`read-orders`).
 * A widget names the stored form, the one spelling a permission has, and a
 * sentence names no permission at all.
 */
const PERMISSION_NAME = /^[a-z][a-z0-9_]*-[a-z0-9][a-z0-9_-]*$/;

/** The fields a declaration may carry. Anything else is named as a mistake. */
const FIELDS = new Set([
  "id",
  "title",
  "description",
  "category",
  "widths",
  "width",
  "permission",
  "several",
  "sketch",
  "settings",
  "data",
  "display",
  "empty",
  "example",
]);

const nonBlank = z.string().trim().min(1);
const isFunction = (value: unknown): boolean => typeof value === "function";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** One line of text: no line break anywhere in it. */
const oneLine = (text: string): boolean => !/[\r\n]/.test(text);

/**
 * Whether a link is a path inside the admin: no scheme, no host, and not from
 * the root, where it would name the admin's own address. Core resolves it to
 * wherever the admin is served.
 */
function isAdminRelative(link: unknown): boolean {
  return (
    typeof link === "string" &&
    link.trim() !== "" &&
    !/^[a-z][a-z0-9+.-]*:/i.test(link) &&
    !link.startsWith("/") &&
    !link.includes("\\")
  );
}

/**
 * Everything wrong with one declaration, in field order.
 *
 * `owner` is copied onto every fault, so a list gathered from several plugins
 * still says whose each one is.
 */
export function widgetDeclarationFaults(
  raw: unknown,
  owner: string
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
  return declarationProblems(raw).map(problem => ({ owner, widget, problem }));
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
const CHECKS: readonly ((d: Record<string, unknown>) => Found)[] = [
  d =>
    Object.keys(d)
      .filter(key => !FIELDS.has(key))
      .map(key => `${quote(key)} is not a field of a widget declaration`),
  d => idProblem(d.id),
  d => requiredTextProblem("title", d.title),
  d => requiredTextProblem("category", d.category),
  d => descriptionProblem(d.description),
  d => widthsProblems(d.widths, d.width),
  d =>
    d.permission === undefined || isPermissionName(d.permission)
      ? undefined
      : `permission must be a permission name such as "read-orders", got ${quote(d.permission)}`,
  d =>
    d.several === undefined || typeof d.several === "boolean"
      ? undefined
      : "several must be true or false",
  d =>
    d.sketch === undefined || isCoreDisplay(d.sketch)
      ? undefined
      : `sketch must name one of core's displays (${CORE_DISPLAYS.join(", ")}), got ${quote(d.sketch)}`,
  d => settingsProblems(d.settings),
  d => dataProblem(d.data),
  d => displayProblem(d.display),
  d => emptyProblems(d.empty, d.display),
  d => exampleProblem(d.example, d.display),
];

/** The problems with a declaration that is at least an object. */
function declarationProblems(d: Record<string, unknown>): string[] {
  return CHECKS.flatMap(check => {
    const found = check(d);
    if (found === undefined) return [];
    return typeof found === "string" ? [found] : [...found];
  });
}

function requiredTextProblem(
  field: string,
  value: unknown
): string | undefined {
  if (value === undefined) return `${field} is required`;
  return nonBlank.safeParse(value).success
    ? undefined
    : `${field} must be a non-empty string`;
}

/**
 * An example is drawn as the card's preview, so it is held to the rule every
 * card's data is held to (`cardAnswerProblem`): it reaches the browser as
 * itself, and a core display's example has the shape that display draws.
 */
function exampleProblem(
  example: unknown,
  display: unknown
): string | undefined {
  if (example === undefined) return undefined;
  const problem = cardAnswerProblem(display, example);
  if (problem === undefined) return undefined;
  return problem.kind === "untransportable"
    ? `example cannot be sent to the browser as it is: ${problem.detail.replace("the value", "example")}`
    : `example does not have the shape the "${problem.display}" display draws (${problem.detail})`;
}

function idProblem(id: unknown): string | undefined {
  if (id === undefined) return "id is required";
  if (!isValidWidgetId(id)) {
    return `id must be namespace/name in lowercase slug form, such as "acme/orders", got ${quote(id)}`;
  }
  const namespace = id.slice(0, id.indexOf("/"));
  if ((RESERVED_NAMESPACES as readonly string[]).includes(namespace)) {
    return `id "${id}" is in the reserved "${namespace}/" namespace; use your own, such as your package's name`;
  }
  return undefined;
}

function descriptionProblem(description: unknown): string | undefined {
  if (description === undefined) return "description is required";
  const parsed = nonBlank.safeParse(description);
  if (!parsed.success) return "description must be a non-empty string";
  const text = parsed.data;
  if (!oneLine(text)) return "description must be one line";
  if (text.length > MAX_DESCRIPTION) {
    return `description must be at most ${MAX_DESCRIPTION} characters, has ${text.length}`;
  }
  return undefined;
}

/**
 * Every problem with the widths a declaration allows and its starting width.
 *
 * The starting width is judged against the allowed widths only when those
 * could be read; otherwise the same mistake would be reported twice.
 */
function widthsProblems(widths: unknown, width: unknown): string[] {
  const named = `(${WIDTHS.join(", ")})`;
  if (!Array.isArray(widths) || widths.length === 0) {
    return [
      `widths must list at least one of the widths a card may take ${named}`,
      ...optional(widthProblem(width, undefined)),
    ];
  }
  const strange = widths.filter(
    entry => !(WIDTHS as readonly unknown[]).includes(entry)
  );
  const allowed = strange.length === 0 ? (widths as string[]) : undefined;
  return [
    ...strange.map(
      entry => `widths holds ${quote(entry)}, which is not a width ${named}`
    ),
    ...optional(widthProblem(width, allowed)),
  ];
}

/** A problem as a list of none or one, to spread into a longer list. */
const optional = (problem: string | undefined): string[] =>
  problem === undefined ? [] : [problem];

function widthProblem(
  width: unknown,
  widths: readonly string[] | undefined
): string | undefined {
  if (width === undefined) return "width is required";
  if (
    typeof width !== "string" ||
    !(WIDTHS as readonly string[]).includes(width)
  ) {
    return `width must be one of the widths a card may take (${WIDTHS.join(", ")}), got ${quote(width)}`;
  }
  if (widths !== undefined && !widths.includes(width)) {
    return `width ${quote(width)} is not one of the widths it allows (${widths.join(", ")})`;
  }
  return undefined;
}

function isPermissionName(value: unknown): boolean {
  return typeof value === "string" && PERMISSION_NAME.test(value);
}

/**
 * Every problem with a declaration's settings.
 *
 * Judged by the registry's own rules (`widgetSettingsProblems`), all eight
 * types alike, each setting with its key as its name: a declaration and a
 * stored definition cannot be judged by two rules, the dependency rule (a
 * filter, sort or grouping names one of the widget's own Collection settings)
 * included. What only a declaration can get wrong, a setting that is not an
 * object at all, is named here first.
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
  return [...malformed, ...shared];
}

function dataProblem(data: unknown): string | undefined {
  if (data === undefined) return "data is required";
  if (isFunction(data)) return undefined;
  if (isRecord(data) && "query" in data) {
    return isFunction(data.query)
      ? undefined
      : "data.query must be a function that writes the query from the settings";
  }
  return "data must be a data function, or { query } with a function that writes the query from the settings";
}

function displayProblem(display: unknown): string | undefined {
  if (display === undefined) return "display is required";
  if (isCoreDisplay(display)) return undefined;
  if (isRecord(display) && "component" in display) {
    return nonBlank.safeParse(display.component).success
      ? undefined
      : "display.component must name where the admin loads the component from";
  }
  return `display must be one of core's displays (${CORE_DISPLAYS.join(", ")}) or { component: "<path>" }, got ${quote(display)}`;
}

/** Every problem with a declaration's empty state. */
function emptyProblems(empty: unknown, display: unknown): string[] {
  if (empty === undefined) return [];
  if (!isRecord(empty)) return ["empty must be an object"];
  return [
    ...optional(emptyWhenProblem(empty.when, display)),
    ...optional(emptyMessageProblem(empty.message)),
    ...emptyActionProblems(empty.action),
  ];
}

function emptyWhenProblem(when: unknown, display: unknown): string | undefined {
  if (when !== undefined) {
    return isFunction(when)
      ? undefined
      : "empty.when must be a function of the widget's data";
  }
  // A core display has its own rule for when its data is empty; a component
  // has none, so its message and action could never be shown.
  return isCoreDisplay(display)
    ? undefined
    : "empty.when is required for a widget drawn by its own component: core cannot tell when its data is empty";
}

function emptyMessageProblem(message: unknown): string | undefined {
  if (message === undefined) return undefined;
  const parsed = nonBlank.safeParse(message);
  return parsed.success && oneLine(parsed.data)
    ? undefined
    : "empty.message must be one line of text";
}

function emptyActionProblems(action: unknown): string[] {
  if (action === undefined) return [];
  if (!isRecord(action) || !nonBlank.safeParse(action.label).success) {
    return ["empty.action must have a label"];
  }
  return [
    ...optional(
      isAdminRelative(action.link)
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
  for (const { owner, declarations } of groups) {
    if (!Array.isArray(declarations)) {
      faults.push({
        owner,
        widget: "(none)",
        problem: "its dashboard widgets must be a list of widget declarations",
      });
      continue;
    }
    for (const declaration of declarations) {
      faults.push(...widgetDeclarationFaults(declaration, owner));
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
