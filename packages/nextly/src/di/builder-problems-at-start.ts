/**
 * What a start says of the problems in the Builder's definitions it serves.
 *
 * Judged from the registry rows the start has already read, by the rules a command judges the
 * definition file by (`builderDefinitionProblems`): no read of the database or of a file is added,
 * and a deployment need not carry the file. One bounded warning per process, since a serverless
 * host starts often, in names and codes alone: a rule's own sentence may quote what a definition
 * holds. Nothing here stops a start.
 *
 * @module di/builder-problems-at-start
 */
import {
  type ConfigEntities,
  builderDefinitionProblems,
} from "../shared/lib/config-problems";

import type { LoadedBuilderEntities } from "./load-dynamic-tables";

/** How many problems the warning names before it counts the rest. */
const NAMED = 10;
/** How much of a name or a place it shows. */
const SHOWN = 80;

const KIND_LABELS = {
  collections: "collection",
  singles: "Single",
  components: "field group",
} as const;

/** One problem as the warning names it. */
export interface StartBuilderProblem {
  /** The entity and the place in it: `collection 'cases' fields[1].name`. */
  place: string;
  code: string;
}

/** This process's warning: whether it was said, and one held until the start's reload is known. */
interface WarningState {
  said: boolean;
  held?: () => void;
}

// On `globalThis`, as a bundler may load this module more than once in a process.
const STATE = Symbol.for("nextly.builderProblemsAtStart");
function state(): WarningState {
  const holder = globalThis as { [STATE]?: WarningState };
  return (holder[STATE] ??= { said: false });
}

/** @internal */
export function _resetBuilderWarningsForTest(): void {
  delete (globalThis as { [STATE]?: WarningState })[STATE];
}

/** `text` cut to a bound, with each control character shown as `?`. */
function shown(text: string): string {
  const cut = text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text;
  return Array.from(cut, char => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? "?" : char;
  }).join("");
}

/** The one line naming `problems`, or null where there are none. */
export function builderProblemsWarning(
  problems: readonly StartBuilderProblem[]
): string | null {
  if (problems.length === 0) return null;
  const named = problems
    .slice(0, NAMED)
    .map(({ place, code }) => `${shown(place)} (${code})`)
    .join(", ");
  const rest = problems.length - NAMED;
  return (
    `[Nextly] Problems in the Schema Builder's definitions: ${named}` +
    (rest > 0 ? `, and ${rest} more` : "") +
    ". The site serves them as they are; every nextly command that reads them refuses them until " +
    "they are fixed."
  );
}

/** The problems in the rows the Schema Builder owns, each placed by its entity's kind and name. */
function problemsOf(
  entities: LoadedBuilderEntities,
  code: ConfigEntities
): StartBuilderProblem[] {
  // `ui` is the Builder's own mark; a row whose registry has no such column may be anyone's.
  const owned = {
    collections: entities.collections.filter(row => row.source === "ui"),
    singles: entities.singles.filter(row => row.source === "ui"),
    components: entities.components.filter(row => row.source === "ui"),
  };
  return builderDefinitionProblems(owned, code, "").map(problem => {
    const match = /^\s*(collections|singles|components)\[(\d+)\]\.?(.*)$/.exec(
      problem.path
    );
    if (match === null) return { place: "an entity", code: problem.code };
    const kind = match[1] as keyof typeof owned;
    const slug: unknown = owned[kind][Number(match[2])]?.slug;
    const name = typeof slug === "string" ? `'${shown(slug)}'` : "with no name";
    return {
      place: `${KIND_LABELS[kind]} ${name} ${match[3] ?? ""}`.trim(),
      code: problem.code,
    };
  });
}

/**
 * Warns, once in this process, of the problems in the Builder's definitions `entities` holds.
 * `unless-reloaded` holds the warning: a development start's reload reads the definition file and
 * warns of it itself, and `emitHeldBuilderWarning` says the held one where that reload does not
 * come. Never throws: a judgement or a logger that fails leaves the start as it was.
 */
export function warnOfBuilderProblemsAtStart(args: {
  entities: LoadedBuilderEntities;
  code: ConfigEntities;
  logger: { warn: (message: string) => void };
  when: "now" | "unless-reloaded";
}): void {
  if (state().said) return;
  let message: string | null;
  try {
    message = builderProblemsWarning(problemsOf(args.entities, args.code));
  } catch {
    // Without the error's own message, which may quote what a row holds.
    message =
      "[Nextly] The Schema Builder's definitions could not be checked at this start. The site serves them as they are.";
  }
  if (message === null) return;
  const line = message;
  const say = (): void => {
    if (state().said) return;
    state().said = true;
    try {
      args.logger.warn(line);
    } catch {
      // A logger that fails is not the start's to stop for.
    }
  };
  if (args.when === "unless-reloaded") state().held = say;
  else say();
}

/** Says the warning a start held (`warnOfBuilderProblemsAtStart`), where its reload did not come. */
export function emitHeldBuilderWarning(): void {
  const { held } = state();
  delete state().held;
  held?.();
}

/** Drops the warning a start held: its reload judged the definition file itself. */
export function dropHeldBuilderWarning(): void {
  delete state().held;
}
