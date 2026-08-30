/**
 * The block manifest: what blocks this app has, as data.
 *
 * A block's definition lives in a plugin and is registered into a per-boot
 * registry, so the only way to ask "what blocks exist here?" has been to boot
 * the app and inspect it. That is not available to the things that most need
 * the answer — an editor build, a docs page, an agent writing a page document —
 * so the manifest states it as a file instead.
 *
 * Emitted from what plugins DECLARED (`contributes.declarations`), never from
 * the runtime registry, which is what lets generation stay a pure read of the
 * config: no plugin boots, no database opens. A block registered imperatively
 * from `init` is deliberately absent — it is not knowable without running the
 * plugin, and a manifest that were sometimes complete would be worse than one
 * whose rule is stated.
 *
 * Pure — no IO. The CLI writes the returned string.
 *
 * @module plugins/codegen/block-manifest
 */

import { join, dirname, basename } from "node:path";

import { z } from "zod";

import { NextlyError } from "../../errors";
import { collectDeclarations } from "../declarations";
import type { PluginDefinition } from "../plugin-context";

/** Filename of the generated block manifest. */
export const BLOCK_MANIFEST_FILENAME = "blocks.manifest.json";

/**
 * The consumer key block declarations are addressed to. Stated here rather than
 * imported so core carries no dependency on the page builder; it is the same
 * string that plugin publishes.
 */
export const PAGE_BUILDER_PLUGIN = "@nextlyhq/plugin-page-builder";

/**
 * The manifest's own version, bumped when its SHAPE changes.
 *
 * Separate from any block's `version`, which describes one block's props. A
 * reader checks this to know whether it understands the file at all.
 */
export const BLOCK_MANIFEST_VERSION = 3;

/**
 * The namespaced form a block name takes, as the engine's registration gate requires it.
 *
 * Restated here rather than imported because importing a module-private constant is not
 * available; `__tests__/block-manifest-engine-parity.test.ts` bounds the copy by exercising BOTH
 * sides on the same inputs, which is a stronger check than comparing two patterns. Without it generation and
 * `--check` succeed for a configuration that cannot boot: the manifest would accept
 * `parent: ["shell"]` while `registerBlocks` rejects the same definition, which is the opposite of
 * what an artifact describing what a plugin declared is for.
 */
const NAME_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";

const BLOCK_NAME_RE = new RegExp(`^${NAME_SEGMENT}\\/${NAME_SEGMENT}$`);

/**
 * A block name, or a namespace wildcard like `core/*`, as a slot's `allow` list accepts them.
 *
 * A wildcard names a SET rather than a block, so it needs its own pattern — but not its own
 * GRAMMAR. Both are composed from `NAME_SEGMENT`, so the rule for what a segment may contain is
 * written once and neither pattern can drift from the other.
 *
 * A regex rather than a `.refine()`, because this schema is also emitted as JSON Schema for
 * outside readers and a refinement has no JSON Schema representation. A refined value emits as a
 * bare `{"type": "string"}`, which would leave the published contract quietly weaker than the one
 * enforced here — anyone validating a manifest against the artifact we hand them would accept an
 * `allow` entry this package refuses.
 */
const ALLOW_ENTRY_RE = new RegExp(
  `^${NAME_SEGMENT}\\/(?:${NAME_SEGMENT}|\\*)$`
);

/**
 * The highest version a declared block may carry.
 *
 * The same bound the block engine enforces at registration, restated rather
 * than imported: reading it from `@nextlyhq/blocks-engine` would make every
 * app that installs core carry the block engine so that code generation can
 * read one integer, and it points the dependency the wrong way — the plugin
 * layer builds on core, not the reverse.
 *
 * Restating a value is only safe if it cannot quietly diverge, so a test holds
 * this equal to the engine's own constant. The engine is a development
 * dependency here for that test alone; nothing imports it at runtime.
 */
export const MAX_DECLARED_BLOCK_VERSION = 1001;

/**
 * The longest block name a declaration may carry.
 *
 * The patterns below constrain the alphabet and not the length, so a name of
 * megabytes of otherwise-valid characters satisfies them, is scanned in full on
 * every generation, and is written into the manifest and its JSON Schema.
 *
 * Restated rather than imported for the reason {@link MAX_DECLARED_BLOCK_VERSION}
 * is, and held to the engine's value by the same parity test. Without it
 * `nextly generate` accepts a declaration that `registerBlocks` refuses at boot,
 * which is the divergence an artifact describing what a plugin declared exists
 * to prevent.
 */
export const MAX_DECLARED_BLOCK_NAME_LENGTH = 128;

/**
 * Names the engine keeps for itself. A document node of this type is a
 * component instance rather than a block, so a block answering to it would
 * shadow the one type the renderer resolves without the registry.
 */
export const RESERVED_BLOCK_NAMES: readonly string[] = [
  "nextly/component-instance",
];

/** Two slug segments joined by a slash: the namespace, then the block. */
const BLOCK_NAME_BODY = "[a-z0-9]+(?:-[a-z0-9]+)*\\/[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * The shape of a block name, the second segment naming the block and the first
 * the namespace that owns it.
 *
 * Namespacing is what keeps names collision-free across plugins nobody
 * coordinates, which is also why the registry treats them as global.
 *
 * Restated from the engine for the reason {@link MAX_DECLARED_BLOCK_VERSION}
 * is, and held to its behaviour by the same parity test.
 */
export const BLOCK_NAME_PATTERN = new RegExp(`^${BLOCK_NAME_BODY}$`);

/**
 * The same shape with the reserved names excluded, which is what the manifest
 * schema carries.
 *
 * Expressed as a pattern rather than as a `refine`, because a refinement is an
 * arbitrary function and `z.toJSONSchema` silently drops it: the zod schema
 * would refuse a reserved name while the JSON Schema published beside it
 * accepted one. A lookahead survives the translation, so both sides say the
 * same thing — the property `.strict()` exists to preserve on the object.
 *
 * Built from the list above rather than written out, so adding a reserved name
 * cannot leave the pattern behind.
 */
const DECLARABLE_BLOCK_NAME_PATTERN = new RegExp(
  `^(?!(?:${RESERVED_BLOCK_NAMES.map(escapeForPattern).join("|")})$)${BLOCK_NAME_BODY}$`
);

/** Render a literal harmless inside a pattern built by concatenation. */
function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * One block, as the manifest states it.
 *
 * Strict, and not optionally so: the JSON Schema derived from this object
 * carries `additionalProperties: false` whether or not `.strict()` is written
 * here. Without it the two sides disagree — an unknown key would be quietly
 * dropped by the emitter's own check and REJECTED by the schema handed to
 * outside readers, so a manifest Nextly wrote would fail the contract Nextly
 * published for it. Strict makes both refuse, which is also what makes a key
 * added to the emitter and not to the schema a decision someone made rather
 * than a diff nobody noticed.
 *
 * `props`, `supports` and `slots` stay open, because their contents belong to
 * the block rather than to the manifest: core has no vocabulary for them and
 * would only be guessing at what a plugin may put there.
 *
 * The per-field rules mirror what the block engine enforces at registration,
 * because a manifest generated for a configuration that cannot boot is worse
 * than no manifest — generation DELETES the previous file, so it would trade a
 * good artifact for a description of an app that does not start.
 *
 * Mirrored only where the rule is a shape rather than a value. The engine's
 * upper version bound and its block-name pattern are values it may move, and a
 * copy of them here that fell BEHIND would refuse a block the engine accepts,
 * blocking generation for a valid app. Those two stay the engine's to enforce.
 */
export const blockManifestEntrySchema = z
  .object({
    /**
     * Carries the whole naming rule — shape and reserved names — so the
     * published JSON Schema states it too, rather than leaving an outside
     * reader to discover it by having a manifest rejected somewhere else.
     */
    name: z
      .string()
      .max(MAX_DECLARED_BLOCK_NAME_LENGTH)
      .regex(DECLARABLE_BLOCK_NAME_PATTERN),
    /**
     * The block's own schema version, stamped onto every node of its type.
     *
     * A whole number from 1 to {@link MAX_DECLARED_BLOCK_VERSION}: the engine
     * counts migration steps between versions, so a fraction has no step to
     * chain, a value below 1 has nothing to migrate from, and one above the
     * bound could never chain back to its oldest stored nodes. `.int()` also
     * excludes `NaN` and `Infinity`, which `typeof` reads as numbers and
     * `JSON.stringify` writes as `null` — a manifest that parses as JSON and
     * is wrong.
     */
    version: z.number().int().positive().max(MAX_DECLARED_BLOCK_VERSION),
    /**
     * Required to be non-blank rather than merely non-empty: the engine trims
     * before checking, and a description of spaces renders as an empty palette
     * entry, which is the thing requiring one was meant to prevent.
     */
    description: z.string().regex(/\S/),
    /** The plugin that declared it, so a reader knows what to install. */
    source: z.string().min(1),
    /**
     * A worked instance, for previews and few-shot prompting.
     *
     * Required, because both the declaration pass and the engine require one:
     * making it optional here would accept a hand-edited or externally produced
     * manifest the app itself would refuse, and hand every consumer an absence
     * to handle that the emitter can never produce.
     *
     * Its `props` are a key/value map because that is what a stored node's
     * props are; an array-shaped example could never become a valid node.
     */
    example: z.object({ props: z.record(z.string(), z.unknown()) }).loose(),
    /** Prop schemas keyed by prop name. */
    props: z.record(z.string(), z.unknown()).optional(),
    /** Style capabilities the block opts into. */
    supports: z.record(z.string(), z.unknown()).optional(),
    /**
     * Why this block needs JavaScript in the browser.
     *
     * The reason is REQUIRED and non-blank, matching what registration accepts,
     * because the two gates answering differently is how a manifest generates
     * cleanly for a block the engine then refuses at boot. `\S` rather than a
     * length check for the same reason the description above uses it: a reason
     * of spaces is a reason nobody can read.
     */
    island: z.object({ reason: z.string().regex(/\S/) }).optional(),
    /**
     * Named child regions, for container blocks.
     *
     * The SPEC is constrained where `props` and `supports` are not, and the line between them is
     * who owns the contents. Those two carry whatever a plugin puts there and core has no
     * vocabulary for them. A slot's `allow` is the opposite: the engine defines it, refuses a
     * malformed one at registration, and every nesting decision reads it as STRUCTURE. Left open
     * here, generation and `--check` succeed for a configuration that cannot boot — and because
     * generation DELETES the previous file, that trades a good artifact for a description of an
     * app that does not start.
     *
     * Keys other than `allow` stay open for the same reason `props` does: they belong to whatever
     * declares the slot, and core would only be guessing at them.
     */
    slots: z
      .record(
        z.string(),
        z
          .object({
            allow: z
              .array(
                z
                  .string()
                  .max(MAX_DECLARED_BLOCK_NAME_LENGTH)
                  .regex(ALLOW_ENTRY_RE)
              )
              .optional(),
          })
          .loose()
      )
      .optional(),
    /**
     * The block names this block may be a DIRECT child of; absent means anywhere.
     *
     * Typed as an array of strings rather than left open, unlike the fields above: those carry
     * whatever a plugin puts in them, while this one is consumed as STRUCTURE — a reader deciding
     * where a block may be placed. A malformed value here does not degrade, it forbids, so the
     * shape is pinned at the boundary rather than trusted from whoever wrote the file.
     */
    parent: z
      .array(
        z.string().max(MAX_DECLARED_BLOCK_NAME_LENGTH).regex(BLOCK_NAME_RE)
      )
      .min(1)
      .optional(),
  })
  .strict();

/** The emitted document. */
export const blockManifestSchema = z
  .object({
    /**
     * Pinned to the one version this schema describes, not to any version.
     * The field exists so a reader can tell whether it understands the file at
     * all; a schema accepting a version it was not written for answers that
     * question wrong, and a consumer trusting it would process a future format
     * as though it were this one.
     */
    manifestVersion: z.literal(BLOCK_MANIFEST_VERSION),
    blocks: z.array(blockManifestEntrySchema),
  })
  .strict();

/**
 * The types are DERIVED from the schema rather than declared beside it, so the
 * shape a TypeScript consumer sees and the shape a JSON consumer validates
 * against cannot describe different files.
 */
export type BlockManifestEntry = z.infer<typeof blockManifestEntrySchema>;
export type BlockManifest = z.infer<typeof blockManifestSchema>;

/**
 * The manifest's contract as plain JSON Schema, for a reader that has the
 * package but not zod, and no interest in either.
 *
 * A manifest is consumed by things that are not the app — an editor build, a
 * docs page, a generator handed the file — and a TypeScript interface gives a
 * JSON consumer nothing to check against. This does, in a form any JSON Schema
 * validator understands.
 *
 * Re-exported from the package root, because a contract reachable only through
 * an internal module is not published: the export map admits no deep import.
 * Something holding the file with no package installed is still unserved; that
 * wants a hosted copy, which is a docs concern rather than an emitter one.
 *
 * Derived from the schema above, so publishing it cannot drift from what the
 * emitter actually writes.
 */
export function blockManifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(blockManifestSchema);
}

/**
 * A block as the emitter assembles it, before the schema judges it.
 *
 * Only `name` is narrowed, because sorting and the duplicate check read it and
 * the per-declaration pass has already established it is a non-empty string.
 * Everything else stays exactly as declared: coercing it here would mean
 * deciding what is acceptable in two places, and the schema is the one whose
 * answer is published.
 */
interface BlockManifestDraft {
  name: string;
  [key: string]: unknown;
}

/**
 * Build the manifest from what plugins declared.
 *
 * Blocks are sorted by name so the emitted file is stable: an artifact that
 * reordered itself when plugins were reordered would show a diff on every
 * unrelated config edit, and a drift test could not tell a real change from a
 * shuffle.
 */
export function buildBlockManifest(
  plugins: readonly PluginDefinition[]
): BlockManifest {
  const blocks: BlockManifestDraft[] = [];
  // Nothing can register when the consumer is absent or disabled: a disabled
  // plugin runs no `init` and contributes no services, so the registry these
  // declarations would fill never exists. Listing them anyway would tell
  // tooling the app has blocks it cannot render.
  if (!isConsumerActive(plugins, PAGE_BUILDER_PLUGIN)) {
    return { manifestVersion: BLOCK_MANIFEST_VERSION, blocks: [] };
  }
  // Where each name came from, so a collision names both plugins rather than
  // just the one that lost.
  const declaredBy = new Map<string, string>();
  for (const declaration of collectDeclarations(plugins, PAGE_BUILDER_PLUGIN)) {
    for (const block of declaredBlocks(declaration.value, declaration.source)) {
      const entry = toEntry(block, declaration.source);
      const firstSource = declaredBy.get(entry.name);
      if (firstSource !== undefined) {
        throw invalidDeclaration(
          `Block "${entry.name}" is declared by both "${firstSource}" and "${declaration.source}". Block names are global, so one of them has to change.`
        );
      }
      declaredBy.set(entry.name, declaration.source);
      blocks.push(entry);
    }
  }
  blocks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return assertMatchesSchema({
    manifestVersion: BLOCK_MANIFEST_VERSION,
    blocks,
  });
}

/**
 * Hold the assembled document to the contract the manifest publishes.
 *
 * The per-block checks above read a DECLARATION, addressing whoever wrote it.
 * This reads the DOCUMENT, and its audience is whoever changed the emitter: it
 * is what stops a manifest being written that the schema shipped alongside it
 * would reject, which is the one failure a reader has no way to recover from.
 *
 * Refusing rather than warning, for the reason the whole module refuses: this
 * runs on a path that DELETES the previous manifest when it finds no blocks, so
 * an emitter defect must stop generation rather than be written over the last
 * good file.
 */
function assertMatchesSchema(manifest: unknown): BlockManifest {
  const parsed = blockManifestSchema.safeParse(manifest);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const at = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  throw NextlyError.validation({
    errors: [
      {
        path: `${BLOCK_MANIFEST_FILENAME}.${at}`,
        code: "MANIFEST_SCHEMA_MISMATCH",
        message: `The block manifest does not satisfy the schema published for it: ${issue.message}`,
      },
    ],
  });
}

/**
 * Decide whether to emit a manifest and where. Returns `null` when no plugin
 * declared a block, so the caller writes no file rather than an empty one — an
 * empty manifest and an absent one mean the same thing, and only one of them
 * leaves a stale artifact behind when the last block plugin is removed.
 *
 * Placed beside the generated types so it ships with the app. Returning `null`
 * means "this app has no manifest", which the caller must express by REMOVING
 * any previous file: writing nothing would leave the last run's manifest on
 * disk advertising blocks the app no longer has.
 */
export function assertManifestPathIsFree(typesOutputPath: string): void {
  // The manifest sits beside the generated types, so a types file named
  // `blocks.manifest.json` resolves to the same path. With blocks declared the
  // manifest is written and then overwritten by the types; with none, the
  // cleanup deletes the types output the user asked for. Both are silent, and
  // one destroys work, so the collision is refused before either happens.
  //
  // Compared without regard to case, because on macOS and Windows the default
  // filesystem is case-insensitive: `BLOCKS.MANIFEST.JSON` is the same file
  // there, and a case-sensitive comparison would protect Linux alone while the
  // delete still landed everywhere else. On a case-sensitive filesystem this
  // refuses a name that would in fact have been distinct, which costs a user
  // nothing beyond picking a less confusing one.
  if (basename(typesOutputPath).toLowerCase() === BLOCK_MANIFEST_FILENAME) {
    throw NextlyError.validation({
      errors: [
        {
          path: "typescript.outputFile",
          code: "OUTPUT_PATH_COLLISION",
          message: `The generated types output cannot be named "${BLOCK_MANIFEST_FILENAME}": the block manifest is written to that name in the same directory, and one would overwrite or delete the other.`,
        },
      ],
    });
  }
}

export function buildBlockManifestArtifact(
  plugins: readonly PluginDefinition[],
  typesOutputPath: string
): { path: string; code: string } | null {
  const manifest = buildBlockManifest(plugins);
  if (manifest.blocks.length === 0) return null;
  return {
    path: join(dirname(typesOutputPath), BLOCK_MANIFEST_FILENAME),
    code: serialize(manifest),
  };
}

/**
 * Render the manifest as the text that will be written.
 *
 * `props`, `supports`, `slots` and an example's props carry whatever a plugin
 * put there, and not every JavaScript value survives the trip into a JSON file.
 * Two things can go wrong, and they fail differently:
 *
 * A `bigint` or a cycle makes `JSON.stringify` throw, and a raw `TypeError`
 * leaving this package tells whoever ran generation nothing about which
 * declaration to go and fix.
 *
 * A function, a symbol or an `undefined` is dropped instead — silently, and by
 * design: the manifest already drops `render` and `resolve` for the same
 * reason. What must not survive that is a FILE that no longer satisfies the
 * schema published for it, so the rendered text is parsed back and judged
 * again. The check is on the artifact rather than on the object it came from,
 * because the artifact is what anyone else will read.
 */
function serialize(manifest: BlockManifest): string {
  let code: string;
  try {
    // Trailing newline so the file is well-formed for line-based tooling and
    // does not show a no-newline marker in every diff.
    code = `${JSON.stringify(manifest, null, 2)}\n`;
  } catch (error) {
    throw invalidDeclaration(
      `A declared block holds a value JSON cannot represent, so the manifest cannot be written: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  assertMatchesSchema(JSON.parse(code));
  return code;
}

/**
 * A generation-time refusal, addressed at the declaration that caused it.
 *
 * Generation must not be more permissive than boot. Anything the page builder
 * would reject when it registers has to fail here too, or `generate:types`
 * reports success -- and may delete the previous manifest -- for a
 * configuration that cannot start.
 */
function invalidDeclaration(message: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: `contributes.declarations.${PAGE_BUILDER_PLUGIN}.blocks`,
        code: "INVALID_BLOCK_DECLARATION",
        message,
      },
    ],
  });
}

/** Whether the plugin these declarations are addressed to will actually run. */
export function isPageBuilderActive(
  plugins: readonly PluginDefinition[]
): boolean {
  return isConsumerActive(plugins, PAGE_BUILDER_PLUGIN);
}

function isConsumerActive(
  plugins: readonly PluginDefinition[],
  consumer: string
): boolean {
  const found = plugins.find(plugin => plugin.name === consumer);
  return found !== undefined && found.enabled !== false;
}

/**
 * The block list inside one declaration.
 *
 * A `blocks` value that is present but not an array is refused rather than read
 * as empty. The runtime refuses it too, so treating it as "no blocks" here
 * would emit — or delete — a manifest describing a configuration that cannot
 * boot, and the first sign of trouble would be a failing start rather than a
 * failing generate.
 *
 * A declaration carrying no `blocks` key at all is not an error: another
 * version of the page builder may read keys this one does not.
 */
interface DeclaredBlock {
  /** Checked here, so the caller need not re-establish it to sort or dedupe. */
  name: string;
  [key: string]: unknown;
}

function declaredBlocks(value: unknown, source: string): DeclaredBlock[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const blocks = (value as { blocks?: unknown }).blocks;
  if (blocks === undefined) return [];
  if (!Array.isArray(blocks)) {
    throw invalidDeclaration(
      `Plugin "${source}" declared blocks for the page builder as ${typeof blocks}; it must be an array of block definitions.`
    );
  }
  return blocks.map((block, index) => {
    // Filtering a bad element would drop a block the author meant to ship and
    // leave the manifest quietly short; the engine rejects the same element at
    // registration, so it fails here instead.
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block at index ${index} that is ${describeKind(block)}; each entry must be a block definition.`
      );
    }
    const definition = block as Record<string, unknown>;
    if (typeof definition.name !== "string" || definition.name.length === 0) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block at index ${index} with no name.`
      );
    }
    if (
      definition.name.length > MAX_DECLARED_BLOCK_NAME_LENGTH ||
      !BLOCK_NAME_PATTERN.test(definition.name)
    ) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block named "${definition.name}" at index ${index}; a block name is a namespaced slug like "core/heading", at most ${MAX_DECLARED_BLOCK_NAME_LENGTH} characters.`
      );
    }
    if (RESERVED_BLOCK_NAMES.includes(definition.name)) {
      throw invalidDeclaration(
        `Plugin "${source}" declared a block named "${definition.name}", which the engine reserves and no block may answer to.`
      );
    }
    if (typeof definition.version !== "number") {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no numeric version.`
      );
    }
    const gaps = missingMigrationSteps(definition.version, definition.migrate);
    if (gaps.length > 0) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" is at version ${definition.version} but has no migration from version${gaps.length > 1 ? "s" : ""} ${gaps.join(", ")}. Add the missing step(s) so stored blocks can be upgraded.`
      );
    }
    if (
      typeof definition.description !== "string" ||
      definition.description.length === 0
    ) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no description. Every block needs one, for the palette, the docs and the manifest.`
      );
    }
    // A worked instance is what makes a block usable by something that has
    // never seen it: a preview renders it, and a generator few-shots from it.
    // The block API requires one, so a declaration without it describes a block
    // that could not have been built with `defineBlock`.
    if (
      typeof definition.example !== "object" ||
      definition.example === null ||
      Array.isArray(definition.example)
    ) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" has no example. Every block needs a worked instance, for previews and for generating content.`
      );
    }
    // The last two the engine requires that the manifest never carries: a
    // node's props are a key/value map, so defaults shaped otherwise could not
    // seed one, and a block with nothing to draw with cannot render a page.
    // Both are judged from the declaration or not at all — one is a function,
    // and the other is dropped along with everything else JSON cannot hold.
    if (
      definition.defaultProps !== undefined &&
      !isRecord(definition.defaultProps)
    ) {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" declares defaultProps that are not a plain object.`
      );
    }
    if (typeof definition.render !== "function") {
      throw invalidDeclaration(
        `Block "${definition.name}" from "${source}" declares no render function.`
      );
    }
    // Rebuilt with the name spelled out so the checked type carries what was
    // just proved about it; returning `definition` would hand the caller a
    // record whose `name` is `unknown` again, and it sorts and dedupes on it.
    return { ...definition, name: definition.name };
  });
}

/**
 * One declared block as a manifest entry.
 *
 * `render` and `resolve` are functions and are deliberately dropped: they
 * cannot be serialized, and a manifest is a description of what a block accepts
 * rather than of how it draws. Everything kept is data the declaration already
 * holds, copied rather than reshaped, so the file and the definition cannot
 * drift into different vocabularies.
 */
function toEntry(block: DeclaredBlock, source: string): BlockManifestDraft {
  const entry: BlockManifestDraft = {
    name: block.name,
    version: block.version,
    description: block.description,
    source,
    // Unconditional: the declaration pass has already refused a block without
    // an example, so a guard here would be a branch that never runs and a
    // manifest entry the schema now requires it to have.
    example: block.example,
  };
  if (isRecord(block.props)) entry.props = block.props;
  if (isRecord(block.supports)) entry.supports = block.supports;
  // Passed through whatever its shape, so the SCHEMA judges it — the same reason `parent` below is.
  // An `isRecord` guard here DROPS a malformed `slots` instead, and a dropped field is an absent
  // one: the manifest then validates cleanly while `registerBlocks` refuses the same definition at
  // boot, which is generation succeeding for a configuration that cannot run.
  if (block.slots !== undefined) entry.slots = block.slots;
  // Carried because the manifest is what an editor build, the docs and an agent
  // read to tell an interactive block from an inert one WITHOUT importing it.
  // Omitted, every reader of this file believes no block on the page needs
  // JavaScript, which is the one thing this field exists to say.
  //
  // Passed through whatever its shape, so the SCHEMA judges it — the same
  // reason `slots` above is. Guarding here would DROP a malformed value, and a
  // dropped field is an absent one: the manifest would validate cleanly while
  // `registerBlocks` refuses the same definition at boot, which is generation
  // succeeding for a configuration that cannot run.
  if (block.island !== undefined) entry.island = block.island;
  // Carried because the manifest is read to decide where a block may LEGALLY sit — by editor
  // builds and by agents generating documents. Omitting it does not make the restriction lenient;
  // it makes every reader of this file believe there is none, so they generate placements the
  // write validator then refuses, with nothing in the manifest explaining why.
  // Passed through whatever its shape, so the SCHEMA judges it. Filtering a malformed value here
  // would emit a manifest that validates cleanly while the engine refuses the same definition at
  // boot — generation succeeding for a configuration that cannot run, which is the one outcome
  // this artifact must not produce.
  if (block.parent !== undefined) {
    entry.parent = Array.isArray(block.parent)
      ? [...block.parent]
      : block.parent;
  }
  return entry;
}

/**
 * The versions between 1 and this block's own that no migration step covers.
 *
 * A version above 1 says stored nodes exist at older versions, so every step
 * between has to be there or those nodes could never be upgraded. Registration
 * refuses a declaration with a gap, and the map is functions — which never
 * reach the manifest — so this is judged from the declaration or not at all.
 *
 * Only for a version already in range. An out-of-range one is refused by the
 * schema a moment later, and walking up to it first would mean counting to
 * whatever number was declared.
 */
function missingMigrationSteps(version: number, map: unknown): number[] {
  if (
    !Number.isInteger(version) ||
    version <= 1 ||
    version > MAX_DECLARED_BLOCK_VERSION
  ) {
    return [];
  }
  const steps = isRecord(map) ? map : undefined;
  const gaps: number[] = [];
  for (let step = 1; step < version; step++) {
    if (typeof steps?.[String(step)] !== "function") gaps.push(step);
  }
  return gaps;
}

/** A short, safe description of a bad value, for an error a human reads. */
function describeKind(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
