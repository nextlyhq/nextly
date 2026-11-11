/**
 * What `nextly plugins add` registers for a package, and with which options.
 *
 * A package says how it is registered in its package.json, under
 * `nextly.plugin`:
 *
 * ```json
 * "nextly": {
 *   "plugin": {
 *     "export": "seoPlugin",
 *     "call": true,
 *     "options": {
 *       "siteUrl": { "description": "The site's production address", "format": "url" }
 *     }
 *   }
 * }
 * ```
 *
 * `export` is the export the plugin is (`default` for a default export);
 * `call` says it is a function that makes the plugin, called with the options
 * as one object; `options` are the values the install asks for, each given as
 * `--option <name>=<value>` or answered at a prompt, and written into the
 * config as literals. The declaration is read from the manifest, so it is
 * there before any of the package's code runs.
 *
 * A package that declares nothing is registered by the one plugin definition
 * its entry exports, as it is (`plugins: [formBuilderPlugin]`). A function is
 * never called to find out whether it makes one: what it would need, and what
 * calling it would do, are the package's to say.
 *
 * @module cli/commands/plugins-add/registration
 */
import { z } from "zod";

import {
  pluginDeclarationInvalid,
  pluginOptionInvalid,
  pluginOptionMissing,
  pluginRegistrationUnknown,
} from "../../errors/areas/plugins";
import { isPluginDefinition } from "../plugin-definition-shape";

/** A JavaScript name an import can bind and an object literal can key. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const OPTION = z
  .object({
    description: z.string().trim().min(1),
    format: z.enum(["text", "url"]).optional(),
  })
  .strict();

const DECLARATION = z
  .object({
    export: z
      .string()
      .regex(IDENTIFIER, "`export` must be a JavaScript name, or `default`"),
    call: z.boolean().optional(),
    options: z
      .record(
        z.string().regex(IDENTIFIER, "each option must be a JavaScript name"),
        OPTION
      )
      .optional(),
  })
  .strict()
  .refine(
    declared =>
      declared.call === true ||
      Object.keys(declared.options ?? {}).length === 0,
    "`options` are given to a call, so they need `call: true`"
  );

/** An option the install asks for. */
export type InstallOption = z.infer<typeof OPTION>;

/** What goes into the config for a package: which export, bound to what, and how it is called. */
export interface Registration {
  /** The export the plugin is, `default` for a default export. */
  exportName: string;
  /** The name a new import binds it to. */
  localName: string;
  /** Whether the export is called to make the plugin. */
  call: boolean;
  /** The options the call is given, which the install asks for. */
  options: Record<string, InstallOption>;
}

/**
 * The name a default export is bound to: `@acme/nextly-plugin-forms` is
 * `forms`, and one that would not start with a letter gets `plugin` in front.
 */
function localNameFor(pkg: string): string {
  const last = pkg.split("/").pop() ?? pkg;
  const camel = last
    .replace(/^nextly-plugin-/, "")
    .replace(/^plugin-/, "")
    .replace(/[-_.]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  return /^[a-z]/i.test(camel) ? camel : `plugin${camel}`;
}

/** The registration for `exportName` of `pkg`. */
function registrationOf(
  pkg: string,
  exportName: string,
  call: boolean,
  options: Record<string, InstallOption>
): Registration {
  return {
    exportName,
    localName: exportName === "default" ? localNameFor(pkg) : exportName,
    call,
    options,
  };
}

/** The `nextly.plugin` declaration in a package's manifest: absent, read, or why it cannot be. */
export function readDeclaration(manifest: {
  name?: unknown;
  nextly?: unknown;
}):
  | { kind: "none" }
  | { kind: "declared"; registration: Registration }
  | { kind: "invalid"; problem: string } {
  const nextly = manifest.nextly;
  const declared =
    typeof nextly === "object" && nextly !== null
      ? (nextly as { plugin?: unknown }).plugin
      : undefined;
  if (declared === undefined) return { kind: "none" };
  const parsed = DECLARATION.safeParse(declared);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      issue =>
        `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`
    );
    return {
      kind: "invalid",
      problem: `Its \`nextly.plugin\` does not parse: ${issues.join("; ")}`,
    };
  }
  const name = typeof manifest.name === "string" ? manifest.name : "";
  return {
    kind: "declared",
    registration: registrationOf(
      name,
      parsed.data.export,
      parsed.data.call === true,
      parsed.data.options ?? {}
    ),
  };
}

/** A plugin definition, as far as the command reads one: its name, which the install takes. */
export interface PluginShape {
  name: string;
  version: string;
}

/**
 * The registration of a package that declares nothing: the one plugin
 * definition its entry exports, under its own name where it has one besides
 * `default`. None, or several, is refused.
 */
export function registrationFromExports(
  pkg: string,
  exports: Record<string, unknown>
): Registration {
  const namesOf = new Map<unknown, string[]>();
  for (const [name, value] of Object.entries(exports)) {
    if (!isPluginDefinition(value)) continue;
    namesOf.set(value, [...(namesOf.get(value) ?? []), name]);
  }
  const found = [...namesOf.values()];
  if (found.length === 1) {
    const names = found[0] ?? [];
    const exportName = names.find(name => name !== "default") ?? "default";
    return registrationOf(pkg, exportName, false, {});
  }
  if (found.length === 0) {
    throw pluginRegistrationUnknown(
      pkg,
      "It has no `nextly.plugin` declaration, and its entry exports no plugin definition as it is; a function that makes one is not called to find out"
    );
  }
  throw pluginRegistrationUnknown(
    pkg,
    `It has no \`nextly.plugin\` declaration, and its entry exports ${found.length} plugin definitions (${found.map(names => names[0]).join(", ")})`
  );
}

/** Whether `value` is an address a site is reached at. */
function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Why `value` is not a valid `option`, or nothing when it is. */
function invalidValue(
  name: string,
  option: InstallOption,
  value: string
): string | undefined {
  if (value.trim() === "") return `${name} is empty`;
  if (option.format === "url" && !isWebAddress(value)) {
    return `${name} must be a full web address, such as https://example.com, and "${value}" is not one`;
  }
  return undefined;
}

/** Asks for one option's value at the terminal. */
export type AskOption = (
  name: string,
  option: InstallOption
) => Promise<string>;

/** The values given as `--option <name>=<value>`, each checked against the declaration. */
function givenOptions(
  pkg: string,
  declared: Record<string, InstallOption>,
  given: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const flag of given) {
    const at = flag.indexOf("=");
    if (at <= 0) {
      throw pluginOptionInvalid(
        pkg,
        `"--option ${flag}" gives no value: write it as <name>=<value>`
      );
    }
    const name = flag.slice(0, at).trim();
    const value = flag.slice(at + 1).trim();
    const option = declared[name];
    if (option === undefined) throw unknownOption(pkg, declared, name);
    if (name in values) {
      throw pluginOptionInvalid(pkg, `${name} was given more than once`);
    }
    const problem = invalidValue(name, option, value);
    if (problem !== undefined) throw pluginOptionInvalid(pkg, problem);
    values[name] = value;
  }
  return values;
}

/** The refusal of an option the plugin does not ask for. */
function unknownOption(
  pkg: string,
  declared: Record<string, InstallOption>,
  name: string
) {
  const asked = Object.keys(declared);
  return pluginOptionInvalid(
    pkg,
    asked.length === 0
      ? `It asks for no options, and was given ${name}`
      : `It asks for ${asked.join(", ")}, not ${name}`
  );
}

/**
 * The value of each option the declaration asks for: from `--option
 * <name>=<value>`, else asked for through `ask` when someone can answer. An
 * option the plugin does not ask for, one given twice or without a value, or
 * a value of the wrong format is refused, and so is a run that leaves one out
 * with no one to ask.
 */
export async function settleOptions(
  pkg: string,
  declared: Record<string, InstallOption>,
  given: readonly string[],
  ask?: AskOption
): Promise<Record<string, string>> {
  const values = givenOptions(pkg, declared, given);
  const missing = Object.entries(declared).filter(
    ([name]) => !(name in values)
  );
  if (missing.length === 0) return values;
  if (ask === undefined) {
    throw pluginOptionMissing(
      pkg,
      missing.map(([name, option]) => ({
        name,
        description: option.description,
      }))
    );
  }
  for (const [name, option] of missing) {
    const value = (await ask(name, option)).trim();
    const problem = invalidValue(name, option, value);
    if (problem !== undefined) throw pluginOptionInvalid(pkg, problem);
    values[name] = value;
  }
  return values;
}

/** Whether a given value is fine for `option`, for a prompt to check as it is typed. */
export function optionProblem(
  name: string,
  option: InstallOption,
  value: string
): string | undefined {
  return invalidValue(name, option, value.trim());
}

/** The options as an object literal, in the order the declaration lists them. */
function optionsLiteral(
  registration: Registration,
  values: Record<string, string>
): string {
  const entries = Object.keys(registration.options)
    .filter(name => name in values)
    .map(name => `${name}: ${JSON.stringify(values[name])}`);
  return entries.length === 0 ? "" : `{ ${entries.join(", ")} }`;
}

/** The entry `plugins` gets: the export as it is, or called with its options. */
export function entryText(
  registration: Registration,
  local: string,
  values: Record<string, string>
): string {
  return registration.call
    ? `${local}(${optionsLiteral(registration, values)})`
    : local;
}

/**
 * The plugin the registration makes from the package's exports: the export
 * itself, or what calling it with the options returns. Made before the config
 * is touched, so a declaration that names the wrong export, or a plugin that
 * refuses its options, leaves the file as it was.
 */
export async function pluginFrom(
  pkg: string,
  exports: Record<string, unknown>,
  registration: Registration,
  values: Record<string, string>
): Promise<PluginShape> {
  const exported = exports[registration.exportName];
  if (exported === undefined) {
    throw pluginDeclarationInvalid(
      pkg,
      `It names the export ${registration.exportName}, which its entry does not have`
    );
  }
  let made: unknown = exported;
  if (registration.call) {
    if (typeof exported !== "function") {
      throw pluginDeclarationInvalid(
        pkg,
        `It says ${registration.exportName} is called, and it is not a function`
      );
    }
    const options = Object.keys(registration.options).length > 0;
    try {
      made = await (exported as (options?: unknown) => unknown)(
        ...(options ? [values] : [])
      );
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      throw pluginOptionInvalid(
        pkg,
        `The plugin refused the options it was given: ${said}`
      );
    }
  }
  if (!isPluginDefinition(made)) {
    throw pluginDeclarationInvalid(
      pkg,
      registration.call
        ? `calling ${registration.exportName} does not return a plugin definition`
        : `${registration.exportName} is not a plugin definition`
    );
  }
  return made;
}
