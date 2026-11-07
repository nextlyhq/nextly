/**
 * The `blocks` field type, contributed by the plugin that can deliver it.
 *
 * Core used to ship this as a built-in: a JSON column and a read-only summary,
 * with no editor unless this plugin was installed. It is declared here instead,
 * so a field type exists exactly where the code that makes it work does, and
 * core carries no dependency on the document engine.
 *
 * Every seam a built-in had is stated here rather than assumed:
 * value rules through `validate`, declaration rules through `validateOptions`,
 * the empty document through `emptyValue`, and the generated types through
 * `codegen`.
 *
 * @module fields/blocksField
 */

import {
  CONDITION_ISSUE_CODES,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  LIST_ISSUE_CODES,
  type BlockDocument,
  type BreakpointSet,
  type IssueCode,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldInstance,
  PluginFieldIssue,
  PluginFieldType,
  PluginFieldValidateArgs,
  PluginFieldValidationResult,
} from "@nextlyhq/plugin-sdk";

import {
  acceptedForms,
  lockTargetOf,
  openRemovalFor,
  type OpenRemovalReader,
} from "../breakpoint-removal/lock-acceptance";
import { formsChangedBy } from "../component-cycle-guard";
import { siteBreakpoints } from "../site-style";

import { storedFormsFor } from "./added-undefined-ids";
import { newBindingIssues } from "./binding-judgement";
import {
  compositionIssues,
  documentOf,
  type CompositionSetup,
} from "./blocks-composition";
import { emptyBlockDocument } from "./blocks-document";
import type { BlocksFieldOptions } from "./blocks-options";
import { blocksOptionsOf, DEFAULT_ACCEPTED_KINDS } from "./blocks-options";
import { validateBlocksValue } from "./blocks-validator";
import { newBreakpointIssues } from "./breakpoint-reference-judgement";
import { newClassReferenceIssues } from "./class-reference-judgement";
import {
  judgesLayersLocks,
  layersLockIssues,
  withLockIssues,
} from "./layers-lock-judgement";
import { newConditionIssues, newListQueryIssues } from "./list-query-judgement";
import { readStoredForms } from "./lock-baselines";
import { newTokenReferenceIssues } from "./token-reference-judgement";

/** The engine's issue for a child of a contentOnly slot changed besides content. */
const CONTENT_ONLY_BREAK: IssueCode = "locked-slot-content-only";

/**
 * The engine's placement-rule issues. A stored page may already hold one, and
 * a write that leaves it where it was must still save, so finding one reads
 * the stored page to tell an old break from a new one.
 */
const PLACEMENT_BREAKS: ReadonlySet<string> = new Set<IssueCode>([
  "wrong-parent",
  "not-allowed-in-slot",
  "restricted-at-root",
  "undeclared-slot",
  "holds-no-blocks",
  "phrasing-only",
  "content-model",
]);

/**
 * The engine's issues a stored value may already hold, so finding one reads
 * the stored forms to tell an old one, kept with a warning, from a new one: the
 * placement breaks, and two of a component's variants sharing a name from
 * before names had to differ.
 */
const STORED_MAY_HOLD: ReadonlySet<string> = new Set<string>([
  ...PLACEMENT_BREAKS,
  "variant-label-clash" satisfies IssueCode,
  // A collection list's query problems: a list stored before its bounds and
  // rows were judged keeps saving with a warning until it is edited.
  ...Object.keys(LIST_ISSUE_CODES),
  // A block's visibility condition problems, alike: a condition stored before
  // operators were judged keeps saving with a warning until it is edited.
  ...Object.keys(CONDITION_ISSUE_CODES),
]);

/** The field type id. Was a built-in token; now this plugin's to own. */
export const BLOCKS_TYPE = "blocks";

/**
 * The control the entry form renders for a blocks field: a summary of the
 * stored document, and the way in to the editor that changes it.
 */
export const BLOCKS_FIELD_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#BlocksField";

/** The policy a field declares, in the loosest shape worth reading. */
/**
 * `read`, asked at most once: every caller shares the first call's answer,
 * so the checks judging one write see one read. Nothing when there is no
 * `read`. Exported for the same checks made again inside the write's
 * transaction (`composition-rejudge`), which share their reads the same way.
 */
export function onceAsked<T>(read: () => Promise<T>): () => Promise<T>;
export function onceAsked<T>(
  read: (() => Promise<T>) | undefined
): (() => Promise<T>) | undefined;
export function onceAsked<T>(
  read: (() => Promise<T>) | undefined
): (() => Promise<T>) | undefined {
  if (read === undefined) return undefined;
  let answer: Promise<T> | undefined;
  return () => (answer ??= read());
}

function policyOf(field: PluginFieldInstance): BlocksFieldOptions {
  // Delegated rather than repeated. The admin editor asks the same question of
  // the same declaration, and a field validated under one reading and edited
  // under another is how an editor seeds a document its own field rejects.
  return blocksOptionsOf(field);
}

/**
 * A blocks value judged by the document's own rules: the engine's structure
 * and placement rules, the field's policy, and the composed page.
 *
 * A placement or `contentOnly` break, or a variant name clash, the stored
 * document already held is kept with a warning rather than refused, so the
 * stored forms are read only once such a break is found.
 */
function judgedByRules(
  value: unknown,
  args: PluginFieldValidateArgs,
  breakpoints: BreakpointSet | undefined,
  composition: (() => CompositionSetup | undefined) | undefined
): PluginFieldValidationResult | Promise<PluginFieldValidationResult> {
  const judge = (stored?: readonly BlockDocument[]) =>
    validateBlocksValue(
      value,
      args.path,
      typeof args.field.label === "string" ? args.field.label : args.path,
      policyOf(args.field),
      // The set this factory was built with; the empty set otherwise,
      // which the engine treats permissively (a breakpoint reference warns).
      breakpoints ?? siteBreakpoints(),
      stored
    );
  // Composed only once the document is well formed: the composition walks
  // the tree the rules above vouched for, and a malformed one would report
  // the shape problem a second time in the composition's words.
  //
  // Answered synchronously wherever there is nothing to compose — no store
  // installed, or no entry write to read the library through — so a caller
  // judging a value on its own gets the answer it always got.
  const composed = () => {
    const setup = composition?.();
    if (setup === undefined || args.write === undefined) return true;
    return compositionIssues(value, args, setup).then(found =>
      found.length === 0 ? true : found
    );
  };
  const issues = judge();
  if (issues.length === 0) return composed();
  // A contentOnly slot may keep what the document's stored version already
  // holds, so a part a block's changed defaults left behind is not refused
  // with nobody having changed it; and a placement break the stored page
  // already held is kept with a warning rather than refused. Read only once
  // such a break is found.
  if (
    !issues.some(
      issue =>
        issue.code === CONTENT_ONLY_BREAK || STORED_MAY_HOLD.has(issue.code)
    )
  ) {
    return issues;
  }
  const status = (args.data as { status?: unknown } | undefined)?.status;
  return readStoredForms(
    args.write,
    args.path,
    formsChangedBy(typeof status === "string" ? status : undefined),
    (args.field as { localized?: unknown }).localized === true
  ).then(async stored => {
    const again = await judgedAgainstStored(
      judge,
      issues,
      stored.forms,
      args.write,
      args.path,
      composition?.()?.openBreakpointRemoval
    );
    // A stored value this cannot read may already hold every placement
    // break or name clash found, so none is refused; the server log says what
    // was kept until the page can be judged against it.
    const kept = stored.readable
      ? again
      : again.filter(issue => !STORED_MAY_HOLD.has(issue.code));
    if (kept.length < again.length) {
      composition?.()?.onPlacementUnjudged?.({
        field: args.path,
        ...documentOf(args.write),
        breaks: again.length - kept.length,
      });
    }
    return kept.length > 0 ? kept : composed();
  });
}

/**
 * The issues judged again against the stored forms, which a `contentOnly`
 * slot lets a document keep. While a breakpoint removal is open, a
 * `contentOnly` break that remains is judged once more with the stored forms
 * stripped of the removed breakpoints' values as well, so the removal's own
 * strip is kept and nothing beyond it is; while its undo is open, with what
 * the removal kept put back (`breakpoint-removal/lock-acceptance`).
 */
async function judgedAgainstStored<T extends { readonly code?: string }>(
  judge: (stored?: readonly BlockDocument[]) => T[],
  issues: T[],
  stored: readonly BlockDocument[],
  write: PluginFieldValidateArgs["write"],
  path: string,
  openRemoval: OpenRemovalReader | undefined
): Promise<T[]> {
  if (stored.length === 0) return issues;
  const again = judge(stored);
  if (!again.some(issue => issue.code === CONTENT_ONLY_BREAK)) return again;
  const work = await openRemovalFor(openRemoval, write);
  if (work === null || write === undefined) return again;
  const accepted = await acceptedForms(stored, work, lockTargetOf(write, path));
  return accepted.length === 0 ? again : judge([...stored, ...accepted]);
}

/**
 * Build the field type against the site's breakpoints.
 *
 * A factory rather than only a constant, because the breakpoint set is the
 * host's configuration: the plugin factory knows it, and the validator has no
 * other road to it — a field type's `validate` receives the value, the
 * request and the field instance, none of which carry site configuration.
 * Handing the set in here is what lets a write be judged against the same
 * breakpoints the canvas draws with.
 */
export function blocksFieldType(
  breakpoints?: BreakpointSet,
  /**
   * How the composed document is judged: where components live, the caps, and
   * how a component's hosts are found. A getter, because the plugin knows its
   * store only once it is installed; absent, only the document's own rules run.
   */
  composition?: () => CompositionSetup | undefined
): PluginFieldType {
  return {
    type: BLOCKS_TYPE,
    storage: "json",
    component: BLOCKS_FIELD_COMPONENT,
    label: "Blocks",
    description: "Page built from blocks",
    category: "Structured",
    icon: "LayoutGrid",

    // An emptied field is judged too: setting it to `null` or "" drops every
    // block it holds, a locked one included, so the Layers lock is asked of
    // that write as of any other, on the data every `before*` hook has left.
    validateEmpty: true,

    /**
     * The document's own rules, run on every write.
     *
     * The engine owns every structural rule — ids, depth, node and byte caps,
     * slot legality, the kind enum — so this adapts its result rather than
     * restating any of it. Issues are addressed to the field, because the admin
     * renders a blocks field as a single control and the position inside the
     * document travels in the message.
     */
    validate: (value, args) => {
      // An empty value has no document to judge by the rules, only the locks
      // of the one it would replace.
      const emptied = value === null || value === undefined || value === "";
      const verdict = emptied
        ? true
        : judgedByRules(value, args, breakpoints, composition);
      const label =
        typeof args.field.label === "string" ? args.field.label : args.path;
      // The classes a write adds, and the breakpoints it brings styles or
      // hides under, must be ones the site defines, judged whatever the rules
      // above answered, so one round fixes both. A value judged on its own,
      // or an emptied field, references none.
      const definitions = onceAsked(composition?.()?.siteDefinitions);
      // And against one read of the page as stored, so no reference is let
      // through by a snapshot the other checks did not see.
      const storedForms = onceAsked(async () => storedFormsFor(args));
      // And the fields each collection list names, against the schema and
      // what visitors may read, on any write the server can read them for.
      const listFields = composition?.()?.listFields;
      // And what its bindings read, against each source's declared fields.
      const bindingShapes = composition?.()?.bindingShapes;
      const lists = async (): Promise<readonly PluginFieldIssue[]> => {
        if (emptied || args.write === undefined) return [];
        const maxNodes = composition?.()?.limits.maxNodes;
        const bound =
          bindingShapes === undefined
            ? []
            : await newBindingIssues(value, args, label, {
                shapesOf: bindingShapes,
                storedForms,
                ...(maxNodes === undefined ? {} : { maxNodes }),
                onUnjudged: bindings =>
                  composition?.()?.onBindingsUnjudged?.({
                    field: args.path,
                    ...documentOf(args.write),
                    bindings,
                  }),
              });
        if (listFields === undefined) return bound;
        const namedQueries = composition?.()?.namedQueries;
        // Where templates are stored, so a template's lists are judged
        // against the collection it draws.
        const templates = composition?.()?.templates;
        const site = {
          fieldsOf: listFields,
          storedForms,
          maxNodes,
          ...(namedQueries === undefined ? {} : { namedQueries }),
          ...(templates === undefined ? {} : { templates }),
        };
        // And the fields its blocks' visibility conditions check, judged the
        // same way, since a condition the page could not check hides its block.
        return [
          ...(await newListQueryIssues(value, args, label, site)),
          ...(await newConditionIssues(value, args, label, site)),
          ...bound,
        ];
      };
      const classes = async (): Promise<readonly PluginFieldIssue[]> => {
        const listed = await lists();
        if (emptied || definitions === undefined) return listed;
        const limits = composition?.()?.limits;
        return [
          ...listed,
          ...(await newClassReferenceIssues(value, args, label, {
            classIds: async () => (await definitions()).classIds,
            limits,
            storedForms,
          })),
          ...(await newBreakpointIssues(value, args, label, {
            breakpointIds: async () => (await definitions()).breakpointIds,
            limits,
            storedForms,
          })),
          // And the variables it adds, which fences a variable's removal.
          ...(await newTokenReferenceIssues(value, args, label, {
            tokenIds: async () => (await definitions()).tokenIds,
            limits,
            storedForms,
          })),
        ];
      };
      // A value judged on its own, or a create, has no stored document to
      // hold a lock, and keeps the answer it always got, synchronously where
      // the rules gave one and nothing else is asked.
      if (!judgesLayersLocks(args)) {
        if (
          args.write === undefined ||
          emptied ||
          (definitions === undefined &&
            listFields === undefined &&
            bindingShapes === undefined)
        ) {
          return verdict;
        }
        return Promise.resolve(verdict).then(answered =>
          classes().then(found => withLockIssues(answered, found, args.path))
        );
      }
      // And the Layers locks, judged against the stored document on every
      // update, whatever the rules above answered: a write that breaks a lock
      // and also breaks a rule is told about both, so one round fixes both.
      return Promise.resolve(verdict).then(answered =>
        layersLockIssues(
          emptied ? null : value,
          args,
          label,
          composition?.()?.onLayersLockUnjudged,
          composition?.()?.openBreakpointRemoval
        ).then(locks =>
          classes().then(found =>
            withLockIssues(
              withLockIssues(answered, locks, args.path),
              found,
              args.path
            )
          )
        )
      );
    },

    /**
     * The declaration's own rules, run when a schema is registered.
     *
     * A policy that is the wrong shape, or one whose settings contradict each
     * other, is a defect in the schema rather than in any value: reporting it
     * per write would tell the writer, who cannot fix it, and would fail every
     * write until whoever declared the field noticed.
     */
    validateOptions: field => {
      const declared = (field as { blocks?: unknown }).blocks;
      if (declared === undefined) return true;

      if (
        typeof declared !== "object" ||
        declared === null ||
        Array.isArray(declared)
      ) {
        return "blocks must be an object declaring allow and/or kinds.";
      }

      const { allow, kinds } = declared as { allow?: unknown; kinds?: unknown };

      if (allow !== undefined) {
        if (!Array.isArray(allow) || allow.some(e => typeof e !== "string")) {
          return [
            {
              path: "blocks.allow",
              message: "blocks.allow must be an array of block name strings.",
            },
          ];
        }
      }

      if (kinds !== undefined) {
        if (!Array.isArray(kinds)) {
          return [
            {
              path: "blocks.kinds",
              message: "blocks.kinds must be an array of document kinds.",
            },
          ];
        }
        // An empty list accepts no document at all, so nothing could ever be
        // stored — including the empty document a required field is seeded with.
        // The contradiction is in the declaration, not in any value.
        if (kinds.length === 0) {
          return [
            {
              path: "blocks.kinds",
              message:
                "blocks.kinds cannot be empty: the field would accept no document at all. Omit it to accept a page.",
            },
          ];
        }

        // The kind set is closed. A declaration is the only place an unknown one
        // can be refused outright: the engine validates documents in forgiving
        // mode, where an unrecognised kind is a warning, and the policy check
        // then compares against the same bad value — so the field would accept
        // documents nothing else in the system understands, and seed and generate
        // for them too.
        const unknown = kinds.filter(
          kind => !(DOCUMENT_KINDS as readonly unknown[]).includes(kind)
        );
        if (unknown.length > 0) {
          return [
            {
              path: "blocks.kinds",
              message: `blocks.kinds contains unknown document kinds: ${unknown
                .map(String)
                .join(", ")}. Accepted: ${DOCUMENT_KINDS.join(", ")}.`,
            },
          ];
        }
      }

      return true;
    },

    /**
     * What the field holds before anything is written to it.
     *
     * The kind is read from the field's own policy: seeding a page into a field
     * that only accepts templates would store a value the same field rejects.
     */
    emptyValue: field => emptyBlockDocument(policyOf(field).kinds),

    codegen: {
      // Imported from this package rather than the engine directly: an app
      // depends on the plugin, and the engine is only a transitive dependency it
      // has no guarantee of being able to resolve by name.
      tsImports: [
        { names: ["BlockDocument"], from: "@nextlyhq/plugin-page-builder" },
      ],
      tsType: () => "BlockDocument",

      /**
       * The envelope, pinned to the format version the engine supports and to
       * the kinds this field accepts, so a value the generated schema admits is
       * one the server admits too. Accepting any numeric version would let an app
       * validate a document the write path then rejects. The node tree is checked
       * in depth by the engine on write rather than restated here.
       */
      zodSchema: field => {
        const kinds = policyOf(field).kinds;
        // The default from its one statement, which the validator reads too.
        const accepted = kinds ?? DEFAULT_ACCEPTED_KINDS;
        const kindSchema = `z.enum([${accepted
          .map(kind => `"${String(kind).replace(/["\\]/g, "\\$&")}"`)
          .join(", ")}])`;
        return `z.object({ formatVersion: z.literal(${DOCUMENT_FORMAT_VERSION}), kind: ${kindSchema}, nodes: z.array(z.unknown()) }).passthrough()`;
      },
    },
  };
}

/**
 * The field type with no site breakpoints attached.
 *
 * Kept as a constant because it is public API and because a registry needs a
 * stable identity to compare against; the plugin factory registers the
 * breakpoint-aware instance instead.
 */
export const BLOCKS_FIELD_TYPE: PluginFieldType = blocksFieldType();
