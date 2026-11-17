/**
 * Compiling a document's stored styles into one stylesheet.
 *
 * A pure function of persisted data. It reads a document and a context the
 * caller loaded; it never reaches into storage, never calls a block's `render`,
 * and imports no framework. Styles are therefore never collected while
 * something renders, which is the failure mode this design exists to avoid: a
 * stylesheet assembled during a render is missing whatever did not render, and
 * the bug shows up as a block that looks right until the day it is the only
 * thing on the page.
 *
 * Everything is anchored to the page root and emitted at the same specificity,
 * so precedence comes from source order alone. That is why the tiers below are
 * emitted whole, one after another, rather than interleaved by breakpoint: a
 * node's own style beats its block type's default at every width, which is only
 * true if the whole of one tier precedes the whole of the next.
 *
 * ## The suppressions in this module's parts
 *
 * Four functions in its parts carry `fallow-ignore-next-line complexity`:
 * `envelopeRules` and `visibilityRules` in `compile-page-rules`, and
 * `breakpointContexts` and `unknownBreakpointWarnings` in
 * `compile-page-breakpoints`. `containedDrawsNothing` in `compile-page-nodes`
 * carries `fallow-ignore-next-line code-duplication`, for the guard it shares
 * with `visibility.ts`. They moved there unchanged, apart from an `export`, when
 * this module was split into parts, and their findings were inherited, so
 * ungated, while they sat here. The audit calls them new only because their
 * files are new, and the health baseline is generated from `main`, never from
 * a branch. Suppressed inline, one by one, as the engine's earlier splits do:
 * a new complex function added to any part still gets caught.
 *
 * @module style/compile-page
 */
import {
  type BlockDocument,
  isBlockType,
  isPartName,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASSES,
} from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { appearPrelude } from "./appear";
import { childGapForms } from "./child-gap";
import {
  breakpointContexts,
  previewContainerName,
  scopeSelector,
} from "./compile-page-breakpoints";
import {
  type CompiledPageCss,
  readClassId,
  readClassSlug,
  type StyleCompileContext,
} from "./compile-page-context";
import {
  documentNodes,
  FLOW_CHILDREN,
  layoutModeRules,
} from "./compile-page-nodes";
import { envelopeRules, visibilityRules } from "./compile-page-rules";
import {
  PREVIEW_STATE_SELECTORS,
  STATE_SELECTORS,
  TYPOGRAPHIC_ELEMENTS,
} from "./compile-page-states";
import { contentWidthRules } from "./content-width";
import { escapeIdentifier } from "./css-value";
import {
  compileStyleValues,
  type Declaration,
  DEFAULT_TOKEN_PREFIX,
} from "./declarations";
import {
  classNameOf,
  isDefaultLook,
  isLook,
  isUsableNamedClass,
  MAX_NAMED_CLASS_NAME_LENGTH,
  NAMED_CLASS_SLUG_RE,
  type NamedClass,
  namedClassesRead,
  orderedNamedClasses,
  orderedNamedClassPositions,
  ownLooksRead,
  starredLooksOf,
  usableNamedClassPositions,
} from "./named-class";
import {
  blockPartClassName,
  blockTypeClassName,
  CHILD_GAP_CLASS,
  nodeClassNames,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./node-class";
import { OVERLAY_PREFIX, OVERLAY_RESET } from "./overlay";
import { partRouting } from "./part-routing";
import { type CssRule, serializeRules } from "./serialize";
import type { StyleTraceEntry } from "./style-trace";
import { newStyleIssueBudget } from "./validate-style-value";
import { newWarningAllowance, pushBoundedWarning } from "./warning-allowance";

export type {
  CompiledPageCss,
  StyleCompileContext,
} from "./compile-page-context";
export {
  previewStateClass,
  statePropagatesToAncestors,
} from "./compile-page-states";
// Exported by this module before its split, and kept so its exports stay the
// same; nothing in the repository imports it from here.
// fallow-ignore-next-line unused-type
export type { TypographicElement } from "./compile-page-states";
export {
  BASE_BREAKPOINT,
  MAX_PREVIEW_CONTAINER_LENGTH,
  MAX_SCANNED_KEYS,
  MAX_SCOPE_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  breakpointContexts,
  previewContainerFor,
  previewContainerName,
} from "./compile-page-breakpoints";
export type {
  BreakpointContext,
  BreakpointContextOptions,
} from "./compile-page-breakpoints";

export function compilePageCss(
  doc: BlockDocument,
  ctx: StyleCompileContext
): CompiledPageCss {
  const warnings: ValidationIssue[] = [];
  // One allowance for the whole compile. Per style map it would reset, and a
  // document with a long slot key and many bad values would answer with output
  // quadratic in its own size.
  const budget = newStyleIssueBudget();
  // Bounded separately from the budget above, so a settings record full of
  // stale ids — or a document full of malformed token names — costs its own
  // diagnostics and not the page's stylesheet.
  const warningAllowance = newWarningAllowance();
  /*
   * Normalised ONCE for the whole compile, so the contexts and the visibility
   * bands cannot disagree about it. Two readers of one raw field is how a
   * refused name would have reached one path and not the other, and the sheet
   * would then mix previewed styles with published bands.
   */
  const preview = previewContainerName(ctx.previewContainer);
  const contexts = breakpointContexts(ctx.breakpoints, {
    ...(preview === undefined ? {} : { previewContainer: preview }),
  });
  const tokenPrefix = ctx.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
  const mayFetchUrl = ctx.mayFetchUrl;
  const scope = scopeSelector(ctx.scope, warnings);
  // Read ONCE for the whole compile and handed to every tier. Every rule that
  // can match the previewed element has to honour the forced state — a node's
  // own hover, a class's, a block type's, the page's — so a tier that missed it
  // would show half the appearance the author is editing.
  const previewStates = ctx.previewStates === true;
  // The state selectors this compile writes, for the rules written outside
  // `envelopeRules` that still have to follow a state the way it does.
  const stateSelectorsOfCompile = previewStates
    ? PREVIEW_STATE_SELECTORS
    : STATE_SELECTORS;
  // What was WRITTEN, which is not always what was asked for: a scope this
  // compiler refuses is dropped and the sheet compiled global, and a caller that
  // recorded the request would store an artifact claiming an isolation its own
  // selectors do not carry.
  const effectiveScope = scope === "" ? undefined : ctx.scope;
  const pageRoot = `${PAGE_ROOT_SELECTOR}${scope}`;
  // The SINGLE page-root class, for the tiers that must not borrow the
  // doubling. `PAGE_ROOT_SELECTOR` repeats the class so an author's values
  // outrank host CSS; a default anchored to one class weighs `0-1-0`, which
  // clears a bare element reset and still yields to a host's own class rule.
  //
  // A scope CONSTRAINS this anchor without adding to it. Appended plainly the
  // pair weighs `0-2-0`, and a default that outranks a host's `.content h1`
  // (`0-1-1`) is no longer something the site can override — so a scoped
  // document would keep defaults precisely where an unscoped one yields, which
  // is the opposite of what scoping means. Inside `:where()` the class still
  // has to match and contributes nothing, so both documents weigh the same.
  const defaultsAnchor =
    scope === ""
      ? `.${PAGE_ROOT_CLASS}`
      : `.${PAGE_ROOT_CLASS}:where(${scope})`;
  // Which root properties block parts take from a wrapping root, read once
  // for the node and class tiers below.
  const routing = partRouting(ctx.blockParts);

  const nodes = documentNodes(
    doc,
    warnings,
    warningAllowance,
    ctx.limits,
    ctx.drawsNothing
  );
  const classes = nodeClassNames(nodes.map(entry => entry.node.id));
  // Two nodes sharing an id share a class, because a class is derived from the
  // id and the map this returns is keyed by it — there is no second class to
  // give the second node, and no way to tell a renderer about one. So their
  // styles are refused rather than emitted: written, both envelopes would land
  // on the one selector and the later would silently restyle BOTH elements, one
  // of which never asked for it. Refusing costs the styling of two nodes and
  // says so; writing corrupts a node the author did not touch.
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const { node } of nodes) {
    const id = node.id;
    if (typeof id !== "string") continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }

  const rules: CssRule[] = [];
  // A null-prototype record, because a node id is author data and `__proto__` is a legal one.
  // Assigning it on an ordinary object runs the inherited setter instead of creating an own
  // property, so the entry vanishes: `Object.keys` stays empty, the field is omitted as though the
  // page gated nothing, and a reader then treats a fresh artifact as one compiled before the split
  // and withholds the WHOLE sheet — every visible sibling losing its styling because one node was
  // named `__proto__`.
  const gated: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  // One array for the whole compile, appended to in emission order by every tier below.
  const trace: StyleTraceEntry[] | undefined =
    ctx.trace === true ? [] : undefined;

  // Page-scoped values, on the root every other selector is anchored to. First
  // because it is the outermost element: what it sets is what everything inside
  // inherits before any block has said anything.
  rules.push(
    ...envelopeRules(
      doc.settings?.styles,
      pageRoot,
      "/settings/styles",
      contexts,
      tokenPrefix,
      warnings,
      budget,
      warningAllowance,
      { origin: { kind: "page" }, trace, mayFetchUrl, previewStates }
    )
  );

  // Element defaults, below block defaults and above nothing. A tag reaches a
  // SELECTOR exactly as a block type does, so it is held to a closed list
  // rather than escaped: these are the elements the block library renders text
  // as, and a caller naming anything else is not describing this document's
  // typography. An allow-list rather than a grammar, because the set is small,
  // known, and has no reason to grow without someone deciding it should.
  const elements = ctx.elementBases ?? {};
  for (const tag of TYPOGRAPHIC_ELEMENTS) {
    if (!Object.hasOwn(elements, tag)) continue;
    rules.push(
      ...envelopeRules(
        elements[tag],
        tag,
        pointer("/elementBases", tag),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance,
        {
          origin: { kind: "element", tag },
          previewStates,
          trace,
          mayFetchUrl,
          weightlessAnchor: defaultsAnchor,
        }
      )
    );
  }

  // One rule per block type present, not per node using it.
  const usedTypes = new Set<string>();
  for (const { node } of nodes) {
    if (typeof node.type === "string") usedTypes.add(node.type);
  }
  const bases = ctx.blockBases ?? {};
  const partsByType = ctx.blockParts ?? {};
  for (const type of [...usedTypes].sort()) {
    // Own properties only, and for the same reason the caller narrowing these
    // records checks the same thing: a record reached through a polluted
    // prototype answers this lookup with an inherited value, which would emit a
    // rule against a selector built from a node type nobody declared.
    const hasBase = Object.hasOwn(bases, type);
    const hasParts = Object.hasOwn(partsByType, type);
    if (!hasBase && !hasParts) continue;
    // A node type reaches a SELECTOR, and this compiler reads persisted data
    // whether or not a caller validated it. Unchecked, `"evil/x, body"` emits
    // `.nx-pb-page .nx-bt-evil--x, body { … }` — a second selector of the
    // author's choosing, applying a block's defaults to every `body` on the
    // page, and more hostile spellings close the rule and open their own.
    //
    // Held to the same grammar the document model defines for a node type
    // rather than escaped into something safe: a type that is not a namespaced
    // slug is not a type this engine can style, and quietly renaming it would
    // emit a class no renderer will ever put on an element.
    if (!isBlockType(type)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer("/blockBases", type),
        code: "invalid-node-type",
        severity: "warning",
        message: `"${describeValue(type)}" is not a block type, so its default styles were not written.`,
        suggestion: 'Use a namespaced slug such as "core/section".',
      });
      continue;
    }
    // Escaped as well as refused above. The check is what makes this safe;
    // escaping is what keeps it safe if the check is ever loosened, and it
    // changes nothing for a type that passed, whose characters are all legal in
    // a class already. Built once because both tiers below anchor to it.
    const typeClass = `.${escapeIdentifier(blockTypeClassName(type))}`;
    if (hasBase)
      rules.push(
        ...envelopeRules(
          bases[type],
          typeClass,
          pointer("/blockBases", type),
          contexts,
          tokenPrefix,
          warnings,
          budget,
          warningAllowance,
          {
            origin: { kind: "blockType", type },
            previewStates,
            trace,
            mayFetchUrl,
            weightlessAnchor: defaultsAnchor,
          }
        )
      );
    if (!hasParts) continue;
    const parts = partsByType[type];
    // Registration refuses a malformed record, and registration is NOT the only
    // door: `createBlockResolver` stores definitions directly, so a JavaScript
    // caller reaches this with whatever it was given. Enumerating a `null` here
    // throws before a single block renders and takes the whole page with it —
    // so this answers for the value it is HANDED rather than for the value the
    // type promised, exactly as the node-type check above does.
    if (!isPlainRecord(parts)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer("/blockParts", type),
        code: "invalid-block-part",
        severity: "warning",
        message: `"${describeValue(parts)}" is not a set of parts, so no part of "${type}" was styled.`,
        suggestion: "Use a plain object keyed by part name.",
      });
      continue;
    }
    // Sorted so one document always serializes the same way, exactly as the
    // type loop above and `groupByDescendant` below both do.
    for (const name of Object.keys(parts).sort()) {
      // A part name is compiled INTO a class, so it reaches a selector, and a
      // block definition is code a plugin supplies. Refused rather than escaped
      // for the reason the block type above is: escaping produces a class no
      // renderer will ever write, which is a style silently missing rather than
      // a value reported.
      if (!isPartName(name)) {
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(pointer("/blockParts", type), name),
          code: "invalid-block-part",
          severity: "warning",
          message: `"${describeValue(name)}" is not a part name, so that part of "${type}" was not styled.`,
          suggestion: 'Use a lowercase slug such as "caption".',
        });
        continue;
      }
      rules.push(
        ...envelopeRules(
          parts[name]?.baseStyles,
          // The block type is encoded in the class rather than left as an
          // ancestor. `.nx-bt-core--form label` would also match labels a CHILD
          // block renders into one of the form's slots, so a container's
          // defaults would reach markup it does not own; a single class matches
          // only what the block itself marked.
          `.${escapeIdentifier(blockPartClassName(type, name))}`,
          pointer(pointer("/blockParts", type), name),
          contexts,
          tokenPrefix,
          warnings,
          budget,
          warningAllowance,
          {
            // The part travels with the origin so a provenance reader can say
            // WHICH element a declaration landed on. Without it two rules from
            // one block report the same source and differ only by property.
            origin: { kind: "blockType", type, part: name },
            previewStates,
            trace,
            mayFetchUrl,
            weightlessAnchor: defaultsAnchor,
          }
        )
      );
    }
  }

  // The space each container puts between its children. After every block
  // default rather than beside each one, so no child type's own margin reset —
  // which sorts after its container's type as often as before it — can cancel
  // the gap at equal weight; before the named classes and the nodes, so an
  // author's spacing on a child always wins.
  const flowGaps = new Map<string, readonly Declaration[]>();
  const gaps = ctx.childGaps ?? {};
  for (const type of [...usedTypes].sort()) {
    if (!Object.hasOwn(gaps, type)) continue;
    const path = pointer("/childGaps", type);
    // The same grammar the block-type tier holds a type to, for the same
    // reason: the type reaches a selector.
    if (!isBlockType(type)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path,
        code: "invalid-node-type",
        severity: "warning",
        message: `"${describeValue(type)}" is not a block type, so the space between its children was not written.`,
        suggestion: 'Use a namespaced slug such as "core/section".',
      });
      continue;
    }
    // Both forms or neither: a value only one of them takes would space the
    // children in one layout mode and lose the spacing in the other, so the
    // container is left unspaced and unmarked, and the refusal is reported.
    const forms = childGapForms(gaps[type]);
    const flow = compileStyleValues(
      forms.flow,
      path,
      tokenPrefix,
      budget,
      warningAllowance,
      { mayFetchUrl }
    );
    warnings.push(...flow.warnings);
    if (flow.declarations.length === 0) continue;
    const spaced = compileStyleValues(
      forms.spaced,
      path,
      tokenPrefix,
      budget,
      warningAllowance,
      { mayFetchUrl }
    );
    warnings.push(...spaced.warnings);
    if (spaced.declarations.length === 0) continue;
    const typeClass = `.${escapeIdentifier(blockTypeClassName(type))}`;
    // The type AND the marker, so the marker alone switches the gap off.
    const container = `${typeClass}.${CHILD_GAP_CLASS}`;
    flowGaps.set(type, flow.declarations);
    rules.push(
      {
        selector: `${defaultsAnchor} :where(${container} ${FLOW_CHILDREN})`,
        declarations: flow.declarations,
      },
      {
        selector: `${defaultsAnchor} :where(${typeClass})`,
        declarations: spaced.declarations,
      },
      // A block whose own default lays it out as flex or grid spaces its
      // children with `gap`, so the flow margin comes back off — decided the
      // same way a node's or a class's display decides it, and written after
      // the flow rule on the same selector so it wins.
      ...layoutModeRules(
        Object.hasOwn(bases, type) ? bases[type] : undefined,
        container,
        flow.declarations,
        contexts,
        defaultsAnchor,
        tokenPrefix,
        stateSelectorsOfCompile
      )
    );
  }

  // The container types each named class is actually worn by in this
  // document, so a class's layout rules follow the document rather than every
  // class times every container type. Read from the same bounded node walk
  // and the same per-node cap the class list on an element is built from.
  const classWearers = new Map<string, Set<string>>();
  for (const { node } of nodes) {
    if (!flowGaps.has(node.type) || !Array.isArray(node.classes)) continue;
    for (const id of node.classes.slice(0, MAX_CLASSES_PER_NODE)) {
      if (typeof id !== "string") continue;
      const wearers = classWearers.get(id) ?? new Set<string>();
      wearers.add(node.type);
      classWearers.set(id, wearers);
    }
  }

  // The named classes, in library order — the tier between a block's defaults and a node's own
  // values. At one specificity the cascade is source order, so being emitted here IS what makes
  // a class beat the block default and lose to a local value.
  //
  // `usableNamedClassPositions` decides which of them are written, and the class list handed
  // each node is built from that same call, so a class dropped here is dropped from both.
  //
  // Charged against an allowance of their own, one per class. A site's class library is one
  // document's configuration and every document's problem, so neither wider budget will do:
  // sharing the NODE budget lets a malformed library entry spend it before any node is reached,
  // and sharing one budget across the whole tier lets a single unreferenced entry spend it before
  // any later class is read. Either way one bad entry strips styling from a page that never
  // referenced it.
  // The library is one site-settings record read by every page compile, and it arrives whether or
  // not anything validated it. A non-array — `{}` from a corrupt row — reaches a spread inside
  // `orderedNamedClasses` and throws, which would take down rendering for every page on the site
  // rather than costing the styling of the classes nobody can read.
  const storedLibrary: unknown = ctx.namedClasses;
  // Bounded BEFORE anything copies, sorts or scans it. The library is site-level persisted data
  // read on every page render, and a corrupt settings row holding a very large array would be
  // allocated and sorted in full each time — the document walk is capped and the warnings are
  // capped, so this was the one unbounded read left on the path.
  const wholeLibrary: readonly NamedClass[] = Array.isArray(storedLibrary)
    ? (storedLibrary as readonly NamedClass[])
    : [];
  const library = namedClassesRead(wholeLibrary);
  if (library.length < wholeLibrary.length) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: "/classes",
      code: "invalid-class-library",
      severity: "warning",
      message: `The site's class library holds ${wholeLibrary.length} classes; only the first ${MAX_NAMED_CLASSES} were read.`,
      suggestion: "Remove the classes the site no longer uses.",
    });
  }
  if (storedLibrary !== undefined && !Array.isArray(storedLibrary)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: "/classes",
      code: "invalid-class-library",
      severity: "warning",
      message: `The site's class library is ${describeValue(storedLibrary)} rather than a list, so no named class was written.`,
      suggestion: "Store the class library as an array of classes.",
    });
  }
  // Which SLOTS were written, not which ids and not which entries. Two entries can carry one id,
  // and one object can be supplied in two slots: asking "was this id written" answers yes for the
  // entry that was dropped, and asking "was this ENTRY written" answers yes for the slot that was
  // dropped. Both go unreported, which is the exact case this reporting exists to explain.
  const writtenPositions = usableNamedClassPositions(library);
  const written = new Set<number>(writtenPositions);
  const usableClasses = writtenPositions.map(position => library[position]);
  // The ids the written classes claimed, so an entry dropped for sharing one can be told that
  // rather than being told its name collided.
  const usedIds = new Set(usableClasses.map(cls => cls.id));
  // Where each entry sits in the stored array, so a warning can point at the entry rather than at
  // a name derived from it. A pointer built from the id does not resolve — the id may be missing,
  // may not be a string, and is exactly what is unreliable about a malformed entry — so an editor
  // could not highlight the class it is describing.
  //
  // Walked as POSITIONS rather than entries, because the entries reported on here are the ones
  // the library could not use and those can be primitives: `[null, null]` is two entries needing
  // two separate repairs, and a lookup keyed by the entry answers with the first position for
  // both, sending an editor to a class it has already fixed.
  // The own looks the bases are laid from, one per block type: any other is reported below.
  const ownRead = new Set<NamedClass>(ownLooksRead(library));
  const orderedPositions = orderedNamedClassPositions(library);
  for (const position of orderedPositions) {
    const cls = library[position];
    if (written.has(position)) continue;
    // A block's own look is read as its type's base edits, never written as a class: not dropped.
    // A second one for the same type is never read, and is said so.
    if (isUsableNamedClass(cls) && isDefaultLook(cls)) {
      if (ownRead.has(cls)) {
        ownRead.delete(cls);
        continue;
      }
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer("/classes", String(position)),
        code: "duplicate-own-look",
        severity: "warning",
        message: `The class ${describeValue(cls.id)} is another own look for ${describeValue(cls.blockType)} blocks, so it was not read; the first one in the library's order is.`,
        suggestion: "Keep one own look per block type, and remove the other.",
      });
      continue;
    }
    // Reported once per entry the library could not use, naming which of the three reasons it
    // was. A usable record whose name is free is not reachable here, so the remaining case after
    // the two structural ones is a name another class already took.
    //
    // Read in this order because the reasons are not alternatives: an entry can be malformed AND
    // collide, and a name that cannot be written is the one an author can act on without first
    // being told the wrong thing. Collapsing the middle case into the collision — which the
    // presence of a valid slug alone would do — tells the author to rename a class whose name was
    // never the problem, and renaming it fixes nothing.
    const slug = readClassSlug(cls);
    const id = readClassId(cls);
    const named =
      typeof slug !== "string" ||
      // Length before the pattern, and read as a NAME problem. An oversized slug is refused by
      // `isUsableNamedClass`, so falling through to the structural branch told an author their id
      // or styles were missing when the name was the whole of it — and ran the pattern over the
      // corrupt string first to get there.
      slug.length > MAX_NAMED_CLASS_NAME_LENGTH ||
      !NAMED_CLASS_SLUG_RE.test(slug)
        ? {
            code: "invalid-class-name" as const,
            message: `A named class could not be written: ${describeValue(slug)} is not a class name.`,
            suggestion: 'Use a lowercase slug such as "card-featured".',
          }
        : !isUsableNamedClass(cls)
          ? {
              code: "invalid-class" as const,
              message: `The class named "${describeValue(slug)}" is missing its id or its styles, so it was not written.`,
              suggestion: "Give every class a string id and a styles record.",
            }
          : // A usable record that survived neither claim lost one of them. The id is checked
            // first because it is the one a document references: told only that the NAME
            // collided, an author renames a class and the reference still reaches the other one.
            typeof id === "string" && usedIds.has(id)
            ? {
                code: "duplicate-class-id" as const,
                message: `More than one class carries the id ${describeValue(id)}, so only the first was written.`,
                suggestion: "Give every class a distinct id.",
              }
            : {
                code: "duplicate-class-name" as const,
                message: `More than one class is named "${describeValue(slug)}", so only the first was written.`,
                suggestion: "Give every class a distinct name.",
              };
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer("/classes", String(position)),
      severity: "warning",
      ...named,
    });
  }
  // Each block type's ★ look, for its blocks wearing none of the type's looks: ahead of the
  // class tier, so a shared style a block wears still wins over it.
  rules.push(
    ...starredLookRules(usableClasses, {
      pageRoot,
      contexts,
      tokenPrefix,
      previewStates,
      trace,
      mayFetchUrl,
      routing,
      wearers: starredWearers(nodes, classes, duplicateIds),
      flowGaps,
      defaultsAnchor,
      stateSelectors: stateSelectorsOfCompile,
    })
  );
  for (const position of writtenPositions) {
    const cls = library[position];
    rules.push(
      ...envelopeRules(
        cls.styles,
        `${pageRoot} .${escapeIdentifier(classNameOf(cls))}`,
        // The envelope is stored under `styles`, so the pointer names it. Without that a warning
        // reads `/classes/0/base/base/bogus`, which resolves to nothing an editor can open.
        pointer(pointer("/classes", String(position)), "styles"),
        contexts,
        tokenPrefix,
        warnings,
        // One WRITE budget per class, not one for the tier. Shared, a single unreferenced entry
        // with enough invalid properties spends it and every later class is refused unread — so a node
        // referencing a perfectly good class receives its token and no declarations, styled by a
        // library entry it never mentions. The tier's total output stays bounded by the warning
        // allowance, which is shared and is what actually caps the reporting.
        newStyleIssueBudget(),
        warningAllowance,
        {
          origin: {
            kind: "class",
            id: cls.id,
            slug: cls.slug,
            // A look reaches only its own block type, so a reader of the
            // trace can refuse it on any other, as the compiler does.
            ...(isLook(cls) ? { blockType: cls.blockType } : {}),
          },
          previewStates,
          trace,
          mayFetchUrl,
          routing,
        }
      )
    );
    // A class that makes a container flex or grid swaps the flow margin for
    // `gap` on each container type that wears it here, exactly as a node's
    // own display does below.
    const classSelector = `.${escapeIdentifier(classNameOf(cls))}`;
    for (const type of [...(classWearers.get(cls.id) ?? [])].sort()) {
      const flow = flowGaps.get(type);
      if (flow === undefined) continue;
      rules.push(
        ...layoutModeRules(
          cls.styles,
          `.${escapeIdentifier(blockTypeClassName(type))}.${CHILD_GAP_CLASS}${classSelector}`,
          flow,
          contexts,
          defaultsAnchor,
          tokenPrefix,
          stateSelectorsOfCompile
        )
      );
    }
  }

  // Each node's own values, in document order so the stylesheet reads the way
  // the page does.
  const reportedDuplicates = new Set<string>();
  for (const { node, path, gated: nodeGated } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined) continue;
    if (duplicateIds.has(node.id)) {
      // Once per id rather than once per node carrying it: the second report
      // would name the same defect and the same fix.
      if (!reportedDuplicates.has(node.id)) {
        reportedDuplicates.add(node.id);
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(path, "id"),
          code: "duplicate-node-id",
          severity: "warning",
          message: `More than one node has the id "${describeValue(node.id)}", so they cannot be styled apart and none of their styles were written.`,
          suggestion: "Give every node a unique id.",
        });
      }
      continue;
    }
    const selector = `${pageRoot} .${className}`;
    const traceBeforeNode = trace?.length ?? 0;
    const nodeRules = [
      ...envelopeRules(
        node.styles,
        selector,
        pointer(path, "styles"),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance,
        {
          origin: { kind: "node", id: node.id },
          trace,
          mayFetchUrl,
          previewStates,
          routing,
        }
      ),
      // The container's own content width, which the site sheet's rule reads.
      ...contentWidthRules(node, {
        selector,
        path,
        tokenPrefix,
        warnings,
        warningAllowance,
      }),
      ...visibilityRules(
        node,
        selector,
        contexts,
        path,
        warnings,
        warningAllowance,
        preview
      ),
      ...layoutModeRules(
        node.styles,
        `.${className}.${CHILD_GAP_CLASS}`,
        flowGaps.get(node.type) ?? [],
        flowGaps.has(node.type) ? contexts : [],
        defaultsAnchor,
        tokenPrefix,
        stateSelectorsOfCompile
      ),
    ];
    // Held out of the sheet when the node can be pruned at read time. Serialized on its own, so
    // each entry carries whatever at-rules its own contexts opened and a reader can append it
    // without reading what came before. Appending is safe because every node carries its own
    // hashed class: two nodes' local rules never collide, and tier order is preserved inside
    // each entry.
    if (nodeGated) {
      gated[node.id] = serializeRules(nodeRules);
      // The trace has to describe the sheet that was RETURNED. `envelopeRules` appended this
      // node's declarations while building them, and they are now leaving `css` — so left in
      // place they would report declarations the browser never received, at an interleaved
      // position the appended entry does not occupy either. Rolled back to where this node
      // started rather than filtered afterwards, because the entries carry no marker saying
      // which node produced them.
      if (trace !== undefined) trace.length = traceBeforeNode;
      continue;
    }
    rules.push(...nodeRules);
  }

  // The classes a renderer puts on each node, which is not the same as the class this compiler
  // styles it by. A `.nx-c-*` rule reaches an element only if the element carries that token, so
  // returning the node class alone would emit the whole named-class tier and leave every rule in
  // it inert — styles written, referenced, and applying to nothing.
  //
  // Narrowed through `usableClasses` for the same reason resolution is: a class the stylesheet
  // dropped must not be put on an element, where it would match a rule some other class owns.
  const byId = new Map(usableClasses.map(cls => [cls.id, cls]));

  /**
   * Whether a stored reference could name a class at all.
   *
   * Length first, and before the value is hashed. A Set or a Map reads a string key in full to
   * hash it, so an unvalidated node holding a megabyte-long id would pay that on every render —
   * once to dedupe, once to look it up, once to apply it — for a value no class can carry, since
   * `isUsableNamedClass` caps an id at the same bound.
   */
  const couldNameAClass = (id: unknown): id is string =>
    typeof id === "string" && id.length <= MAX_NAMED_CLASS_NAME_LENGTH;
  const attributeClasses = new Map<string, string>();
  const reportedMissingClasses = new Map<string, Set<string>>();
  for (const { node, path } of nodes) {
    const own = classes.get(node.id);
    if (own === undefined) continue;
    // A container that spaces its children wears the marker its gap rules are
    // keyed on.
    const names = flowGaps.has(node.type) ? [own, CHILD_GAP_CLASS] : [own];
    // A stored `classes` that is not a list — `"c1"` rather than `["c1"]` — references nothing
    // this compiler can apply. Normalized away in silence it leaves an author with classes in the
    // document, none on the element, and no account of either.
    if (node.classes !== undefined && !Array.isArray(node.classes)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "invalid-classes",
        severity: "warning",
        message: `The classes on this node are ${describeValue(node.classes)} rather than a list, so none were applied.`,
        suggestion: "Store node classes as an array of class ids.",
      });
    }
    const stored: readonly unknown[] = Array.isArray(node.classes)
      ? node.classes
      : [];
    // Deduped once, bounded as it is read, and reused by both walks below. Each of them built its
    // own set straight from the stored array, so a node holding a very large `classes` list was
    // copied twice per render before either the warning allowance or the library lookup could cap
    // anything — and a document is unvalidated data, so that list is whatever was persisted.
    //
    // The bound counts entries READ rather than distinct ids kept: a list of a million copies of
    // one id allocates nothing either way, but only a read bound stops it being scanned.
    // Each entry keeps the position it was stored at, so a warning about one of them resolves to
    // the reference rather than to the whole array. Deduping by id alone loses that, and an
    // editor following the pointer can then neither highlight nor remove what it names.
    const applied: Array<{ id: unknown; index: number }> = [];
    const seenIds = new Set<unknown>();
    const readLimit = Math.min(stored.length, MAX_CLASSES_PER_NODE);
    for (let index = 0; index < readLimit; index += 1) {
      const id = stored[index];
      // A string too long to name a class is not deduped, because deduping is what reads it in
      // full. It is still kept, so it is still accounted for — reported once at each position it
      // was stored at, which the per-node entry cap already bounds.
      const tooLongToName =
        typeof id === "string" && id.length > MAX_NAMED_CLASS_NAME_LENGTH;
      if (!tooLongToName) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      applied.push({ id, index });
    }
    if (stored.length > MAX_CLASSES_PER_NODE) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "too-many-classes",
        severity: "warning",
        message: `This node lists ${stored.length} classes; only the first ${MAX_CLASSES_PER_NODE} were applied.`,
        suggestion:
          "Remove the references the node no longer needs, or combine them into one class.",
      });
    }
    for (const { id, index } of applied) {
      if (couldNameAClass(id) && byId.has(id)) continue;
      const entryPath = pointer(pointer(path, "classes"), index);
      // A value that is not a string is not a class id the library could ever define, so telling
      // an author to add it there sends them to fix something that cannot be fixed that way. The
      // same shape validation calls malformed, called malformed here too.
      if (!couldNameAClass(id)) {
        pushBoundedWarning(warningAllowance, warnings, {
          path: entryPath,
          code: "invalid-classes",
          severity: "warning",
          message: `This node lists ${describeValue(id)} as a class, which is not a class id, so it was not applied.`,
          suggestion: "Store node classes as an array of class-id strings.",
        });
        continue;
      }
      // A reference that reached nothing: reported, not dropped in silence, once per id, in words
      // for the author. The advice suits a deleted shared style or a block style whose block is
      // gone, and names no screen a host without a page builder lacks.
      // A set per stored node, because the pointer above names one reference and a reference is
      // per node. Deduped across the document, the first node to list a missing class takes the
      // only report, and an author who follows that pointer and repairs it hears nothing about
      // the others. Nested rather than keyed on a joined string, so no separator has to be a
      // character an id cannot contain.
      //
      // Keyed by the node's PATH, not its id. A forgiving compile reads a document whose ids may
      // repeat, and two nodes sharing one would then share a set — collapsing exactly the reports
      // this split apart. A path is the position in the document, so it is one per stored node
      // however corrupt the ids are.
      //
      // On the RAW id, because `describeValue` truncates and would collapse two distinct
      // references into one report. The message still uses the described form: an unvalidated
      // document can carry an enormous id, and the allowance charges paths rather than message
      // text, so interpolating the raw one returns a diagnostic its size.
      const reportedHere =
        reportedMissingClasses.get(path) ?? new Set<string>();
      reportedMissingClasses.set(path, reportedHere);
      if (reportedHere.has(id)) continue;
      reportedHere.add(id);
      pushBoundedWarning(warningAllowance, warnings, {
        path: entryPath,
        code: "unknown-class",
        severity: "warning",
        message: `This block uses a style this site doesn't have ("${describeValue(id)}"), so the page doesn't show it.`,
        suggestion:
          "Remove the style from this block, or choose one this site has.",
      });
    }
    // Two nodes sharing an id share one entry in this map, so a named class recorded here would
    // either be lost by whichever node is written second or applied to both. Refused for the
    // same reason their rules are: a class the author put on one node must not silently restyle
    // another node that never referenced it.
    if (!duplicateIds.has(node.id)) {
      // Library order, not the order the node lists them in, so the value is stable for a caching
      // renderer and reads the way the stylesheet does.
      for (const cls of orderedNamedClasses(
        applied
          // A stored reference that is not a string names nothing the library can hold, and was
          // already reported above as malformed.
          .map(entry =>
            couldNameAClass(entry.id) ? byId.get(entry.id) : undefined
          )
          .filter((cls): cls is NamedClass => cls !== undefined)
      )) {
        // A look is bound to one block type: on any other block it is not applied, and said
        // so, as a class the library does not define is.
        if (isLook(cls) && cls.blockType !== node.type) {
          pushBoundedWarning(warningAllowance, warnings, {
            path: pointer(path, "classes"),
            code: "look-for-another-block",
            severity: "warning",
            message: `This node lists the look ${describeValue(cls.id)}, which belongs to ${describeValue(cls.blockType)} blocks, so it was not applied.`,
            suggestion: "Pick one of this block's own looks instead.",
          });
          continue;
        }
        names.push(classNameOf(cls));
      }
    }
    attributeClasses.set(node.id, names.join(" "));
  }

  return {
    ...(effectiveScope === undefined ? {} : { scope: effectiveScope }),
    // The NORMALISED name, so a refused one leaves this absent and the artifact
    // reads as the published sheet it actually is.
    ...(preview === undefined ? {} : { previewContainer: preview }),
    css: withPreludes(rules, gated),
    warnings,
    classes: attributeClasses,
    // Omitted rather than empty when nobody asked, so a caller cannot mistake "not requested"
    // for "nothing was written".
    ...(trace === undefined ? {} : { trace }),
    // Omitted when the document gates nothing, so a page without conditions compiles to exactly
    // the shape it did before this field existed.
    ...(Object.keys(gated).length === 0 ? {} : { gated }),
  };
}

/**
 * The page's rules, preceded by what a rule in them reads from the page: the
 * entrance animation's prelude, and the overlay's reset, so a section's
 * overlay stops at its own image rather than reaching nested ones.
 */
function withPreludes(
  rules: readonly CssRule[],
  gated: Readonly<Record<string, string>>
): string {
  const css = serializeRules(rules);
  // A gated node's rules are kept apart, and appended for a reader who sees
  // it: each prelude stays in the sheet, so the page put back together is the
  // one an ungated compile writes.
  const fragments = Object.values(gated);
  const preludes = [
    appearPrelude([css, ...fragments]),
    readsOverlay(rules, fragments) ? OVERLAY_RESET : undefined,
  ].filter((prelude): prelude is string => prelude !== undefined);
  // Joined only to what is there: a sheet whose every rule is gated is its
  // preludes alone, so the page put back together has no blank line in it.
  return [...preludes, ...(css === "" ? [] : [css])].join("\n");
}

/** Whether any rule, kept in the sheet or apart, reads the overlay. */
function readsOverlay(
  rules: readonly CssRule[],
  fragments: readonly string[]
): boolean {
  // Any of the overlay's properties read: the image's layer, or a longhand's
  // entry lined up with it.
  const reading = `var(${OVERLAY_PREFIX}`;
  return (
    rules.some(rule =>
      rule.declarations.some(declaration => declaration.value.includes(reading))
    ) || fragments.some(fragment => fragment.includes(reading))
  );
}

/** What the ★ tier is written with: the compile's own reading of each. */
interface StarredLookCompile {
  readonly pageRoot: string;
  readonly contexts: ReturnType<typeof breakpointContexts>;
  readonly tokenPrefix: string;
  readonly previewStates: boolean;
  readonly trace: StyleTraceEntry[] | undefined;
  readonly mayFetchUrl: StyleCompileContext["mayFetchUrl"];
  readonly routing: ReturnType<typeof partRouting>;
  /** Each block's own class, type and the classes it lists, in document order. */
  readonly wearers: readonly StarredWearer[];
  /** The flow margins each container type in the document writes, by type. */
  readonly flowGaps: ReadonlyMap<string, readonly Declaration[]>;
  readonly defaultsAnchor: string;
  readonly stateSelectors: Parameters<typeof layoutModeRules>[6];
}

/** One block the ★ tier may reach: its own class, its type and what it lists. */
interface StarredWearer {
  readonly className: string;
  readonly type: string;
  readonly classes: readonly unknown[];
}

/**
 * The document's blocks as the ★ tier reads them: each with the class the
 * compiler gave it, and the class references the engine reads per node. A
 * block sharing its id with another is left out, as its own rules are.
 */
function starredWearers(
  nodes: ReturnType<typeof documentNodes>,
  classes: ReadonlyMap<string, string>,
  duplicateIds: ReadonlySet<string>
): StarredWearer[] {
  const wearers: StarredWearer[] = [];
  for (const { node } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined || duplicateIds.has(node.id)) continue;
    if (typeof node.type !== "string") continue;
    wearers.push({
      className,
      type: node.type,
      classes: Array.isArray(node.classes)
        ? node.classes.slice(0, MAX_CLASSES_PER_NODE)
        : [],
    });
  }
  return wearers;
}

/**
 * Each block type's ★ look, written again for the document's blocks of its
 * type that wear none of the type's looks, under the page root as a worn
 * look is, in type order. Named by each block's own class rather than by the
 * type's, which an image's picture or a list's entry wrappers carry too, so
 * the look lands on the blocks alone. Nothing while no look is starred, so a
 * site that never moved ★ compiles as it did.
 *
 * Its value problems were reported once already, by the look's own rule, so
 * they are not reported twice.
 */
function starredLookRules(
  written: readonly NamedClass[],
  about: StarredLookCompile
): CssRule[] {
  const starred = starredLooksOf(written);
  const rules: CssRule[] = [];
  for (const type of [...starred.keys()].sort()) {
    const look = starred.get(type) as NamedClass;
    const typeLooks = written.filter(
      cls => isLook(cls) && !isDefaultLook(cls) && cls.blockType === type
    );
    const lookIds = new Set(typeLooks.map(cls => cls.id));
    const reached = about.wearers
      .filter(
        wearer =>
          wearer.type === type &&
          !wearer.classes.some(id => typeof id === "string" && lookIds.has(id))
      )
      .map(wearer => `.${escapeIdentifier(wearer.className)}`);
    if (reached.length === 0) continue;
    // `:is()` weighs its heaviest member, one class, so the rule weighs what
    // a worn look's does and a state appended to it applies to every block.
    const selector = `:is(${reached.join(", ")})`;
    rules.push(
      ...envelopeRules(
        look.styles,
        `${about.pageRoot} ${selector}`,
        pointer("/classes", look.id),
        about.contexts,
        about.tokenPrefix,
        // Silent, with an allowance of its own: what it finds is said by the
        // look's own rule, which must still have the page's allowance to say it.
        [],
        newStyleIssueBudget(),
        newWarningAllowance(),
        {
          // Which looks leave a block out, so a reader of the trace answers
          // which blocks this rule reaches as its selector does.
          origin: {
            kind: "class",
            id: look.id,
            slug: look.slug,
            blockType: type,
            unlessWearing: [...lookIds],
          },
          previewStates: about.previewStates,
          trace: about.trace,
          mayFetchUrl: about.mayFetchUrl,
          routing: about.routing,
        }
      ),
      ...starredLayoutRules(look, type, selector, about)
    );
  }
  return rules;
}

/**
 * A ★ look that makes a container flex or grid swaps the flow margin for
 * `gap` on the container type's blocks it reaches, as a worn look's class
 * does on the containers wearing it: those blocks wear no class of its, so
 * only the ★ selector can say which they are.
 */
function starredLayoutRules(
  look: NamedClass,
  type: string,
  selector: string,
  about: StarredLookCompile
): CssRule[] {
  const flow = about.flowGaps.get(type);
  if (flow === undefined) return [];
  return layoutModeRules(
    look.styles,
    `${selector}.${CHILD_GAP_CLASS}`,
    flow,
    about.contexts,
    about.defaultsAnchor,
    about.tokenPrefix,
    about.stateSelectors
  );
}
