// The shapes the tab-indicator rule (lint/tab-indicator) must tell apart, run
// through oxlint's own rule tester, and the CSS questions it asks answered
// directly where a call site cannot isolate them. Which files the rule reaches
// is lint-config.test.mjs's question.
//
// Each table entry is a shape an earlier version of this check got wrong, in
// one direction or the other, so the reason it is here is written beside it.
import { join } from "node:path";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import guards from "../lint/guards.mjs";
import {
  excludeEachOther,
  ownedCssProperties,
} from "../lint/tab-indicator/appearance.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const REPO = join(import.meta.dirname, "..");
const tester = new RuleTester();
const rule = guards.rules["tab-indicator"];

/** Every probe imports the way a real call site does, so its tags resolve. */
const IMPORT = `import * as UI from "@nextlyhq/ui";
import { TabsList, TabsTrigger } from "@nextlyhq/ui";\n`;

/** A probe at the repository root, where only package imports resolve. */
const PROBE = join(REPO, "probe.tsx");

/** [what it is, the element] for each shape that must be reported, once. */
const CATCHES = [
  // `??` yields its left operand when that is certainly present, so a
  // literal class there is the one applied.
  [
    "a class a nullish fallback never replaces",
    '<TabsTrigger className={"border-b-0" ?? fallback} />',
  ],
  // The shapes a pattern-based scan returned clean on. Each removes the
  // underline or the corner outright.
  ["a zero border shorthand", '<TabsTrigger className="border-0" />'],
  ["an axis border shorthand", '<TabsTrigger className="border-y-0" />'],
  ["an arbitrary border width", '<TabsTrigger className="border-[0px]" />'],
  ["a bare border-b", '<TabsTrigger className="border-b" />'],
  ["a bare rounded", '<TabsList className="rounded" />'],
  ["an explicit border-b-0", '<TabsTrigger className="border-b-0" />'],
  ["a corner", '<TabsList className="rounded-md" />'],
  // Important variants. tailwind-merge keeps these beside the primitive's
  // unimportant declaration, so they survive the merge and win in CSS.
  [
    "an important focus ring",
    '<TabsTrigger className="focus-visible:!ring-0" />',
  ],
  [
    "an important state ink",
    '<TabsTrigger className="data-[state=active]:!text-destructive" />',
  ],
  // Categories the primitive declares.
  [
    "a state ink override",
    '<TabsTrigger className="data-[state=active]:text-destructive" />',
  ],
  ["a hover override", '<TabsTrigger className="hover:text-foreground" />'],
  ["a disabled override", '<TabsTrigger className="disabled:opacity-100" />'],
  // Shapes the grammar hides from a pattern.
  [
    "a forbidden class after an arrow-function prop",
    '<TabsTrigger onClick={() => {}} className="border-b-0">x</TabsTrigger>',
  ],
  [
    "a forbidden class inside a template literal",
    "<TabsTrigger className={`shrink-0 ${x} border-b-4`} />",
  ],
  [
    "a forbidden class in one branch of a conditional",
    '<TabsTrigger className={on ? "border-b-2 border-primary" : "x"} />',
  ],
  // State-qualified overrides. tailwind-merge keys by variant as well as by
  // property, so these survive beside the primitive's unconditional
  // declaration and then win in CSS for the state they name.
  [
    "a state-qualified zero border",
    '<TabsTrigger className="data-[state=active]:border-b-0" />',
  ],
  [
    "an important state-qualified zero border",
    '<TabsTrigger className="data-[state=active]:!border-b-0" />',
  ],
  [
    "a state-qualified corner",
    '<TabsList className="data-[state=inactive]:rounded-md" />',
  ],
  // Inline styles, including the shorthands that expand onto the bottom edge
  // and the quoted-key spelling.
  [
    "an inline underline colour",
    "<TabsTrigger style={{ borderBottomColor: c }} />",
  ],
  ["an inline border shorthand", '<TabsTrigger style={{ border: "none" }} />'],
  ["an inline border width", "<TabsTrigger style={{ borderWidth: 0 }} />"],
  ["an inline axis border", '<TabsTrigger style={{ borderY: "0" }} />'],
  [
    "an inline logical bottom border",
    '<TabsTrigger style={{ borderBlockEnd: "none" }} />',
  ],
  ["an inline corner", "<TabsList style={{ borderRadius: 8 }} />"],
  [
    "an inline box-shadow, which erases the focus ring",
    '<TabsTrigger style={{ boxShadow: "none" }} />',
  ],
  [
    "an inline outline, which the primitive removes for focus-visible",
    '<TabsTrigger style={{ outline: "1px solid red" }} />',
  ],
  [
    "an inline opacity, which the disabled state sets",
    "<TabsTrigger style={{ opacity: 1 }} />",
  ],
  [
    "an unqualified important utility beating a variant-qualified owned one",
    '<TabsTrigger className="!opacity-100" />',
  ],
  ["an unqualified important ring", '<TabsTrigger className="!ring-0" />'],
  // Same property, different tailwind-merge group. Width and style are
  // separate groups, so a merge test reported no conflict while the underline
  // went from solid to dashed.
  [
    "a border style on the active state",
    '<TabsTrigger className="data-[state=active]:border-dashed" />',
  ],
  // Radix sets the native attribute and its `data-` twin together, so these
  // select the same tab at equal specificity.
  [
    "a state spelled as its data- equivalent",
    '<TabsTrigger className="data-[disabled]:opacity-100" />',
  ],
  // Arbitrary properties: a declaration wearing a class's clothes.
  // tailwind-merge deliberately does not reconcile these with predefined
  // utilities, so both survive and Tailwind emits the arbitrary rule later.
  [
    "an arbitrary bottom-border width",
    '<TabsTrigger className="[border-bottom-width:0]" />',
  ],
  ["an arbitrary corner", '<TabsList className="[border-radius:8px]" />'],
  [
    "an arbitrary assignment to the ring's own custom property",
    '<TabsTrigger className="focus-visible:![--tw-ring-color:red]" />',
  ],
  [
    "an arbitrary box-shadow qualified the way the ring is",
    '<TabsTrigger className="focus-visible:[box-shadow:none]" />',
  ],
  [
    "a quoted inline underline colour",
    '<TabsTrigger style={{ "borderBottomColor": c }} />',
  ],
  [
    "an inline style built away from the element",
    "const s = { borderBottomColor: c };\n<TabsTrigger style={s} />",
  ],
  [
    "a shorthand inline property",
    "const borderBottomColor = c;\n<TabsTrigger style={{ borderBottomColor }} />",
  ],
  // Bindings.
  [
    "a violation on a locally aliased tag",
    'const Trigger = TabsTrigger;\n<Trigger className="border-b-0" />',
  ],
  // Variables the primitive's own appearance is built out of. Tailwind draws
  // the focus ring through `var(--tw-ring-inset,)`, so assigning that variable
  // moves the ring inside the trigger without ever naming `box-shadow`.
  [
    "an arbitrary assignment to a ring variable the primitive reads",
    '<TabsTrigger className="focus-visible:![--tw-ring-inset:inset]" />',
  ],
  // A style prop that picks between shapes still renders the shape it picks.
  [
    "an inline declaration in the true branch of a conditional",
    "<TabsTrigger style={active ? { borderBottomColor: c } : undefined} />",
  ],
  [
    "an inline declaration in the false branch of a conditional",
    "<TabsTrigger style={active ? undefined : { borderBottomColor: c }} />",
  ],
  [
    "an inline declaration behind a logical guard",
    "<TabsTrigger style={active && { borderBottomColor: c }} />",
  ],
  // The controls for the three exclusions above. Each is one property away
  // from a case that must stay clean, so together they pin a boundary rather
  // than a blanket "borders and inline styles are ignored now".
  [
    "an IMPORTANT caller against an important owned colour",
    '<TabsTrigger className="data-[state=active]:!border-b-destructive" />',
  ],
  [
    "a bottom-border WIDTH, which the primitive does draw",
    '<TabsTrigger className="border-b-4" />',
  ],
  [
    "an inline property whose value is a variable rather than nothing",
    "<TabsTrigger style={{ borderBottomColor: c }} />",
  ],
  // The controls for the child variants above: the same utilities aimed at
  // the tab itself are still reported, so the exclusion is about WHERE the
  // declaration lands rather than about which utility was written.
  [
    "the same border utility aimed at the tab rather than its children",
    '<TabsTrigger className="border-b-0" />',
  ],
  [
    "the same corner utility aimed at the tab rather than its descendants",
    '<TabsTrigger className="rounded-md" />',
  ],
  // A computed key is a different node kind with identical meaning.
  [
    "an inline property written as a computed constant key",
    'const c = "red";\n<TabsTrigger style={{ ["borderBottomColor"]: c }} />',
  ],
  // `&+&` puts a combinator after an `&`, but the element receiving the
  // declarations is the RIGHT-hand one, which is the tab itself.
  [
    "a sibling rule whose subject is the tab",
    '<TabsTrigger className="[&+&]:border-b-0" />',
  ],
  // Shares no variant with the focus ring, and beats it anyway: every Radix
  // trigger carries `aria-controls`, the selectors are equally specific, and
  // Tailwind emits this one last.
  [
    "an equally specific variant emitted after the focus ring",
    '<TabsTrigger className="aria-[controls]:ring-0" />',
  ],
  // A selector LIST has several subjects, and the first one here is the tab.
  [
    "a selector list whose first branch is the tab itself",
    '<TabsTrigger className="[&,&>span]:border-b-0" />',
  ],
  // A custom property assigned on the tab applies to the tab unconditionally,
  // so it changes every owned rule that reads it whatever their variants say.
  [
    "an unqualified write to a ring variable the primitive reads",
    '<TabsTrigger className="[--tw-ring-inset:inset]" />',
  ],
  [
    "a theme token the primitive draws its ink and underline from",
    '<TabsTrigger className="[--nx-primary:red]" />',
  ],
  // The control that makes the clear-after-spread case above mean something:
  // a spread whose owned property is NOT cleared must still be reported, or
  // that one passes because spread contents are never read at all.
  [
    "a spread whose owned property survives",
    'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited }} />',
  ],
  // `all` names no property and resets every one of them.
  [
    "the CSS-wide shorthand as an arbitrary class",
    '<TabsTrigger className="[all:unset]" />',
  ],
  [
    "the CSS-wide shorthand as an inline style",
    '<TabsTrigger style={{ all: "unset" }} />',
  ],
  // Two separately covered forms composed: a namespace import, then an alias
  // of one of its members.
  [
    "an alias of a namespace member",
    'const Trigger = UI.TabsTrigger;\n<Trigger className="border-b-0" />',
  ],
  // A shorthand's value lives in its binding, and a spread branch that emits
  // is a violation even when a sibling branch clears the same property.
  [
    "an owned property emitted by one branch of a conditional spread",
    'const inherited = active ? { borderBottomColor: "red" } : { borderBottomColor: undefined };\n<TabsTrigger style={{ ...inherited }} />',
  ],
  [
    "the same conditional spread with its branches reversed",
    'const inherited = active ? { borderBottomColor: undefined } : { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited }} />',
  ],
  // Equal specificity, emitted later, and a shorthand that replaces the
  // longhand the primitive sets.
  // One source spread twice, with a clear between: the last occurrence wins.
  [
    "a repeated spread source whose second occurrence restores the value",
    'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited, borderBottomColor: undefined, ...inherited }} />',
  ],
  // React reads the property and emits whatever the getter returns.
  [
    "an owned property declared through a getter",
    '<TabsTrigger style={{ get borderBottomColor() { return "red"; } }} />',
  ],
  // A constant-computed key names the property exactly as the literal
  // spelling does, and React emits the same declaration — so the two must be
  // treated identically. The distinguishing property is that the key is
  // decidable without running the code, not how it is spelled.
  [
    "an owned property behind a computed key bound to a constant",
    'const key = "borderBottomColor";\n<TabsTrigger style={{ [key]: "red" }} />',
  ],
  [
    "the same constant behind a type assertion",
    'const key = "borderBottomColor" as const;\n<TabsTrigger style={{ [key as string]: "red" }} />',
  ],
  [
    "a getter whose name is a computed constant",
    'const key = "borderBottomColor";\n<TabsTrigger style={{ get [key]() { return "red"; } }} />',
  ],
  [
    "a shorthand that replaces an owned longhand",
    '<TabsTrigger className="aria-[controls]:[outline:2px_solid_red]" />',
  ],
  // A border image paints over the border the primitive draws, on every tab
  // including the inactive ones whose colour it owns. It names no edge and no
  // aspect, so it reaches the underline without mentioning it.
  [
    "a border image painted over the underline",
    '<TabsTrigger className="[border-image:linear-gradient(red,red)_1]" />',
  ],
  [
    "the same border image set inline",
    '<TabsTrigger style={{ borderImage: "linear-gradient(red,red) 1" }} />',
  ],
  // The one longhand that can put an image there. It is what keeps the
  // narrowing below honest: the other four are reported by nothing, so
  // without a case on `-source` a mapping that owned no border image at all
  // would pass.
  [
    "a border image supplied by the source longhand",
    '<TabsTrigger style={{ borderImageSource: "linear-gradient(red,red)" }} />',
  ],
  [
    "a destructured namespace member",
    'const { TabsTrigger: Trigger } = UI;\n<Trigger className="border-b-0" />',
  ],
  // A reassignable binding is not its declaration initializer. Reading it as
  // one concludes the element paints nothing while it paints — a false
  // NEGATIVE, which is the direction that lets a real violation ship, and the
  // one an immutable-binding control cannot see.
  [
    "a reassigned binding that held nothing at its declaration",
    'let c: string | undefined = undefined;\nc = "red";\n<TabsTrigger style={{ borderBottomColor: c }} />',
  ],
  [
    "the same reassigned binding behind an assertion",
    'let c: string | undefined = undefined;\nc = "red";\n<TabsTrigger style={{ borderBottomColor: c as string | undefined }} />',
  ],
  // An alias resolved in the WRONG scope. `key` means what `sourceKey` meant
  // where the alias was written; resolving it beside the element picks up an
  // inner `sourceKey` the alias never saw.
  [
    "a computed key aliasing a constant shadowed near the element",
    'const sourceKey = "borderBottomColor";\nconst key = sourceKey;\nfunction Row() {\n  const sourceKey = "width";\n  return <TabsTrigger style={{ [key]: "red" }} />;\n}',
  ],
  // An alias chain CROSSING a shadowed name. Two distinct bindings spelled
  // `key`, so a cycle guard keyed on the spelling stops at the second one and
  // never reaches the owned property the chain names.
  [
    "a computed key aliased through a second binding of the same name",
    'const key = "borderBottomColor";\nfunction Row() {\n  const alias = key;\n  {\n    const key = alias;\n    return <TabsTrigger style={{ [key]: "red" }} />;\n  }\n}',
  ],
  // A second copy of an owned appearance, declared with the same value under
  // a different variant. Nothing is displaced and nothing conflicts today,
  // which is exactly why no comparison saw it — and the day the primitive
  // changes its outline, this rule keeps suppressing it.
  [
    "an owned declaration restated under a different variant",
    '<TabsTrigger className="aria-[controls]:outline-none" />',
  ],
  // Pseudo-class TEXT inside an attribute value is data. This rule really can
  // apply beside the primitive's disabled one.
  [
    "a rule whose attribute value merely spells a state",
    '<TabsTrigger className="data-[foo=:enabled]:opacity-100" />',
  ],
  // A `break` above the reset can carry control out of the `do` body before
  // it runs, so the owned value is still one the element can render.
  [
    "an owned property a do-body reset behind a break does not clear",
    'let style: Record<string, string> = { borderBottomColor: "red" };\ndo {\n  if (Math.random() > 0) break;\n  style = {};\n} while (false);\n<TabsTrigger style={style} />',
  ],
  // The CommonJS spelling of a namespace import.
  [
    "a class on a namespace member behind a CommonJS require",
    'const UI = require("@nextlyhq/ui");\n<UI.TabsTrigger className="border-b-0" />',
  ],
  // A spread of a NAME. The outer object does clear the property, so nothing
  // is repainted today — but knowing that requires reading what the name
  // holds, and `const` does not settle it: an object is mutable in place
  // whatever the binding says. Reported for being unreadable, which is the
  // honest answer rather than a guess in either direction.
  [
    "a spread of a name the scan cannot read",
    'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited, borderBottomColor: undefined }} />',
  ],
  // The shapes that used to be traced. Each is now reported for what it is —
  // an inline style whose value this scan does not read — rather than
  // analysed by a flow model. One per kind, because they all reach the same
  // branch and a longer list would only restate it.
  [
    "an inline style held in a mutable binding",
    'let style = { borderBottomColor: "red" };\n<TabsTrigger style={style} />',
  ],
  ["an inline style built by a call", "<TabsTrigger style={buildStyle()} />"],
  [
    "an inline style read from a member access",
    "<TabsTrigger style={theme.tab} />",
  ],
  // A JSX spread carries whatever the object holds, including the two props
  // this contract owns. Skipping spreads left both halves bypassable by one
  // idiom.
  [
    "an owned property spread in as a literal style prop",
    'const props = { style: { borderBottomColor: "red" } };\n<TabsTrigger {...{ style: { borderBottomColor: "red" } }} />',
  ],
  [
    "a displacing class spread in as a literal className",
    '<TabsTrigger {...{ className: "border-b-0" }} />',
  ],
  // And a spread whose contents cannot be read at all, which may carry
  // either of them.
  [
    "a spread of props the scan cannot read",
    'const props = { className: "border-b-0" };\n<TabsTrigger {...props} />',
  ],
  // The CommonJS spelling of a NAMED import: one export selected off the
  // require call, bound under a plain name rather than a namespace.
  [
    "a class on a component required as a member",
    'const TabsTrigger = require("@nextlyhq/ui").TabsTrigger;\n<TabsTrigger className="border-b-0" />',
  ],
  // A later attribute only replaces the prop it NAMES. `className` leaves the
  // spread's `style` exactly where it was.
  [
    "a spread style a later className does not replace",
    '<TabsTrigger {...{ style: { borderBottomColor: "red" } }} className="w-full" />',
  ],
  // An unreadable spread may carry either owned prop, so writing one of them
  // again afterwards leaves the other still coming from the spread.
  [
    "an unreadable spread with only one owned prop written after it",
    '<TabsTrigger {...rest} className="w-full" />',
  ],
  // The objects a conditional spread chooses between are ALTERNATIVES: one
  // of them renders, so a safe value in one branch does not excuse a
  // forbidden value in the other.
  [
    "a class in one branch of a conditional spread",
    '<TabsTrigger {...(flag ? { className: "border-b-0" } : { className: "w-full" })} />',
  ],
  // Only a spread every alternative supplies replaces what came before; a
  // branch that omits the prop renders the earlier value.
  [
    "a class a spread replaces in only one of its branches",
    '<TabsTrigger className="border-b-0" {...(flag ? { style: {} } : { className: "w-full" })} />',
  ],
  // `cn({ rounded })` is `{ rounded: rounded }` to clsx, so the key names
  // the class exactly as the written-out form does.
  [
    "an owned class named by a class-map shorthand",
    "const rounded = true;\n<TabsList className={cn({ rounded })} />",
  ],
  // One class at runtime, whichever way it is spelled in the source.
  [
    "an owned class written as a concatenation",
    '<TabsTrigger className={"border-b-" + "0"} />',
  ],
  // clsx reads a computed literal key as the class it spells, exactly as the
  // written-out key beside it.
  [
    "an owned class named by a computed key in a class map",
    '<TabsTrigger className={cn({ ["border-b-0"]: true })} />',
  ],
  // The branch that supplies no object still renders, and on it the value
  // set before the spread survives.
  [
    "an owned property a conditional spread clears in only one branch",
    '<TabsTrigger style={{ borderBottomColor: "red", ...(flag ? { borderBottomColor: undefined } : undefined) }} />',
  ],
];

/** [what it is, the element] for each shape that must stay clean. */
const CLEAN = [
  // The other side of the same operator: a present left operand means the
  // right one is never applied.
  [
    "an owned class behind a nullish fallback that is never taken",
    '<TabsTrigger className={"w-full" ?? "border-b-0"} />',
  ],
  [
    "a JSX example inside a docblock",
    '/**\n * <TabsTrigger className="border-b-0" />\n */\nexport const x = 1;',
  ],
  [
    "a JSX example inside a line comment",
    '// <TabsList className="rounded-md" />\nexport const x = 1;',
  ],
  [
    "layout classes a surface legitimately owns",
    '<TabsList className="justify-start gap-0 overflow-x-auto h-8" />',
  ],
  [
    "sizing and padding on a trigger",
    '<TabsTrigger className="w-full px-0 shrink-0 whitespace-nowrap" />',
  ],
  [
    "a per-state surface tint, which the surface owns",
    '<TabsTrigger className="w-full data-[state=active]:bg-background/50" />',
  ],
  [
    "a hairline offset on the strip, which owns no bottom margin",
    '<TabsList className="-mb-px" />',
  ],
  ["an unrelated inline style on a tab", "<TabsList style={{ width: 320 }} />"],
  [
    "an inline edge the indicator does not use",
    '<TabsList style={{ borderTop: "1px solid red", marginTop: 4 }} />',
  ],
  [
    "a state-qualified utility that touches nothing owned",
    '<TabsTrigger className="data-[state=active]:shadow-sm" />',
  ],
  [
    "an unqualified plain utility a variant out-specifies",
    '<TabsTrigger className="opacity-100" />',
  ],
  [
    "an arbitrary property the primitive does not set",
    '<TabsTrigger className="[width:20rem]" />',
  ],
  // Aimed elsewhere. A pseudo-element and a descendant are different boxes,
  // so neither can repaint the host's underline however it is qualified.
  [
    "a rule on generated content before the tab",
    '<TabsTrigger className="before:border-b-0" />',
  ],
  [
    "a rule on generated content after the tab",
    '<TabsTrigger className="after:rounded-md" />',
  ],
  [
    "a descendant selector carrying a colon of its own",
    '<TabsTrigger className="[&>span:hover]:border-b-0" />',
  ],
  // Side-aware: the primitive owns one edge, not four.
  [
    "a border on an edge the indicator does not use",
    '<TabsTrigger className="border-t-2 border-t-primary" />',
  ],
  [
    "a rule aimed at a child of the trigger",
    '<TabsTrigger className="[&>span]:border-b-0" />',
  ],
  [
    "a descendant rule written with Tailwind's space",
    '<TabsTrigger className="[&_p]:rounded-md" />',
  ],
  [
    "a shadow on the strip, which draws no ring",
    '<TabsList style={{ boxShadow: "0 1px 2px black" }} />',
  ],
  [
    // The ring is declared under `focus-visible`, so an unqualified rule
    // loses to it on specificity and the ring still draws when focused. The
    // INLINE form of the same declaration does win, and is reported — the
    // two are not interchangeable, and this pins the difference.
    "an unqualified arbitrary box-shadow a variant out-specifies",
    '<TabsTrigger className="[box-shadow:none]" />',
  ],
  [
    "an unrelated element carrying a corner",
    '<div className="rounded-md" />;\n<TabsList />',
  ],
  // Typography is not ink. `text-*` covers font-size, alignment and wrapping
  // as well as colour, and only the colour half is the primitive's.
  [
    "a state-qualified type size, which sets no colour",
    '<TabsTrigger className="data-[state=active]:text-xs" />',
  ],
  ["a type size on hover", '<TabsTrigger className="hover:text-sm" />'],
  ["text alignment", '<TabsTrigger className="text-center" />'],
  // `border-b-2` is a WIDTH utility. Expanding it into every bottom longhand
  // made it claim the colour too, and an unqualified colour then read as
  // displacing a width it never touches.
  [
    "a bottom-border colour against the width the primitive draws",
    '<TabsTrigger className="border-b-destructive" />',
  ],
  // React emits nothing for these, so there is no declaration to beat a class.
  [
    "an inline property explicitly left unset",
    "<TabsTrigger style={{ borderBottomColor: undefined }} />",
  ],
  [
    "an inline property set to null",
    "<TabsTrigger style={{ borderBottomColor: null }} />",
  ],
  // Erased before the code runs, so React receives exactly `undefined` and
  // emits no declaration. `undefined as string | undefined` is the ORDINARY
  // way to write an optional style in a typed codebase, so reporting it
  // rejected the idiomatic spelling of the thing this check exists to permit.
  [
    "an inline property widened with an `as` assertion",
    "<TabsTrigger style={{ borderBottomColor: undefined as string | undefined }} />",
  ],
  [
    "an inline property widened with `satisfies`",
    "<TabsTrigger style={{ borderBottomColor: undefined satisfies string | undefined }} />",
  ],
  [
    "an inline property wrapped in parentheses",
    "<TabsTrigger style={{ borderBottomColor: (undefined) }} />",
  ],
  [
    "the same assertion around a parenthesised nothing",
    "<TabsTrigger style={{ borderBottomColor: (undefined) as string | undefined }} />",
  ],
  // The non-null branch. `!` asserts to the COMPILER that a value is present
  // and erases entirely at runtime, so `undefined!` still reaches React as
  // `undefined` and still emits nothing. Without this case, deleting
  // `ts.isNonNullExpression` from the unwrapper leaves the suite green.
  [
    "an inline property with a non-null assertion on nothing",
    "<TabsTrigger style={{ borderBottomColor: undefined! }} />",
  ],
  // The unwrapping in front of the BINDING lookup, which is a second path
  // through the same helper. A wrapper around an identifier has to be peeled
  // before the resolver is asked, or the lookup never happens and the value
  // is reported on the strength of its wrapper alone.
  [
    "a bound nothing behind an assertion",
    "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty as string | undefined }} />",
  ],
  [
    "a bound nothing behind a non-null assertion",
    "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty! }} />",
  ],
  // Tailwind's own child variants. `*` compiles to `:is(& > *)` and `**` to
  // `:is(& *)`, so both land on children and neither can repaint the tab.
  [
    "a child variant removing a border from the tab's children",
    '<TabsTrigger className="*:border-b-0" />',
  ],
  [
    "a descendant variant rounding the tab's descendants",
    '<TabsTrigger className="**:rounded-md" />',
  ],
  // `divide-*` draws BETWEEN children: its bottom border is emitted inside
  // `:where(& > :not(:last-child))` and never applies to the host.
  [
    "a divide utility, whose border belongs to the children",
    '<TabsTrigger className="divide-y-0" />',
  ],
  // `:where()` contributes no specificity however complex its argument, so
  // this cannot out-rank the primitive's own focus rule.
  [
    "a zero-specificity variant that cannot outrank the focus ring",
    '<TabsTrigger className="[&:where(:focus-visible)]:ring-0" />',
  ],
  // An object is built in source order: the later key clears the spread.
  // Disjoint states: the caller's rule is never in the cascade beside the
  // owned one, so ranking them says nothing.
  [
    "a variant that cannot apply at the same time as the owned rule",
    '<TabsTrigger className="[&:not(:focus-visible)]:ring-0" />',
  ],
  // A selector that contradicts itself can never apply, so it cannot displace
  // anything however its variants compare.
  [
    "a variant contradicted by one it includes",
    '<TabsTrigger className="focus-visible:[&:not(:focus-visible)]:ring-0" />',
  ],
  // React emits nothing for a shorthand whose binding holds nothing.
  [
    "an identifier bound to undefined in a property assignment",
    "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty }} />",
  ],
  [
    "a shorthand bound to undefined",
    "const borderBottomColor = undefined;\n<TabsTrigger style={{ borderBottomColor }} />",
  ],
  // `cn` never receives the second string.
  [
    "a class literal behind a statically false guard",
    '<TabsTrigger className={cn("w-full", false && "border-b-0")} />',
  ],
  // A PARAMETER shadowing an outer constant. The name is the parameter, whose
  // value the caller supplies, so the property is undecidable — not the outer
  // constant's. Walking past the parameter named an owned property for an
  // element that renders whatever it is passed.
  [
    "a computed key bound to a parameter shadowing an outer constant",
    'const key = "borderBottomColor";\nfunction Row(key = "width") {\n  return <TabsTrigger style={{ [key]: "red" }} />;\n}',
  ],
  // The border-image longhands that cannot draw. With `border-image-source`
  // at its initial `none` there is no image, so these change nothing on
  // screen and the primitive's own bottom border renders as it did.
  [
    "border-image longhands with no source to draw",
    '<TabsTrigger style={{ borderImageRepeat: "round", borderImageSlice: "30", borderImageWidth: "4px", borderImageOutset: "2px" }} />',
  ],
  // React emits no declaration for an empty string, verified with
  // `renderToStaticMarkup`: `{ borderBottomColor: "" }` renders no `style`
  // attribute at all. Clearing a style with `""` is an ordinary conditional
  // spelling, so reporting it rejects the idiom the check exists to permit.
  [
    "an owned property cleared with an empty string",
    '<TabsTrigger style={{ borderBottomColor: "" }} />',
  ],
  // A branch the condition can never take. The class half already resolves
  // literal conditions, so reading both branches of a style prop held the two
  // halves of one contract to different standards.
  [
    "an owned property in a statically unreachable branch",
    '<TabsTrigger style={true ? {} : { borderBottomColor: "red" }} />',
  ],
  // A rule that can never apply beside the owned one it matches. `disabled:`
  // and `not-disabled:` select complementary states, so neither can restate
  // or override the other however the cascade ranks them.
  [
    "an equal declaration under a negated form of the owned qualifier",
    '<TabsTrigger className="not-disabled:opacity-50" />',
  ],
  // React emits no declaration for a boolean, the same as for an empty
  // string: both render an element carrying no `style` attribute at all.
  [
    "an owned property set to a boolean",
    "<TabsTrigger style={{ borderBottomColor: false }} />",
  ],
  // One element cannot be both enabled and disabled, so these rules never
  // apply together however the cascade ranks them.
  [
    "a rule qualified by the complement of an owned state",
    '<TabsTrigger className="enabled:opacity-50" />',
  ],
  // `none` is the initial value of `border-image-source`: it supplies no
  // image, so the primitive's ordinary bottom border renders unchanged.
  [
    "a border image explicitly set to none",
    '<TabsTrigger style={{ borderImageSource: "none" }} />',
  ],
  // A constant holding `none` draws no border image, as the literal does.
  [
    "a border image whose none is written as a constant",
    'const noImage = "none";\n<TabsTrigger style={{ borderImageSource: noImage }} />',
  ],
  // Guards that are not spelled as booleans are still statically decided.
  [
    "a class literal behind a statically falsy non-boolean guard",
    '<TabsTrigger className={cn(0 && "border-b-0")} />',
  ],
  // A local component may reuse an imported name and is entitled to its own
  // appearance; the tag refers to the local binding, not the import.
  [
    "a class on a local component shadowing an imported name",
    'function Row() {\n  const TabsTrigger = (p: Record<string, unknown>) => <div {...p} />;\n  return <TabsTrigger className="border-b-0" />;\n}',
  ],
  // A local object may shadow a namespace import exactly as a local component
  // may shadow a named one; the tag refers to the local binding.
  [
    "a class on a namespace member shadowing an imported namespace",
    'function Row() {\n  const UI = { TabsTrigger: (p: Record<string, unknown>) => <div {...p} /> };\n  return <UI.TabsTrigger className="border-b-0" />;\n}',
  ],
  // In an object map the KEY is the class and the VALUE is the condition, so
  // a key switched off applies nothing.
  [
    "a class map entry switched off by its value",
    '<TabsTrigger className={cn({ "border-b-0": false })} />',
  ],
  // A `#` inside an attribute VALUE is data, not an id selector.
  [
    "an attribute value that merely contains a hash",
    '<TabsTrigger className="not-data-[foo=#bar]:opacity-100" />',
  ],
  // `undefined` is a VALUE React receives as no style, not a name that has
  // to be traced, so there is nothing here the scan failed to read.
  ["a style prop written as undefined", "<TabsTrigger style={undefined} />"],
  // Props are one object built left to right, so both later attributes
  // replace what the spread carried and neither spread value is rendered.
  [
    "a spread whose owned props are both written again after it",
    '<TabsTrigger {...{ className: "border-b-0", style: { borderBottomColor: "red" } }} className="w-full" style={{ width: 2 }} />',
  ],
  // The same rule reaches an unreadable spread: once both owned props are
  // written after it, nothing it could have carried survives.
  [
    "an unreadable spread with both owned props written after it",
    '<TabsTrigger {...rest} className="w-full" style={{ width: 2 }} />',
  ],
  // A shorthand names its key, and a key that is not an owned prop cannot
  // carry one. `{...{ value }}` is the ordinary way to pass Radix's `value`.
  [
    "a spread carrying an unrelated prop as a shorthand",
    'const value = "a";\n<TabsTrigger {...{ value }} />',
  ],
  [
    "a spread carrying an unrelated prop written out",
    '<TabsTrigger {...{ role: "tab" }} />',
  ],
  // Ownership follows the BINDING, not the spelling. A local component that
  // shadows the import is a different component, and so is an alias of it.
  [
    "an alias of a name that shadows the import",
    'function Row() {\n  const TabsTrigger = Other;\n  const Local = TabsTrigger;\n  return <Local className="border-b-0" />;\n}',
  ],
  // Ownership follows the BINDING for a namespace exactly as it does for a
  // plain alias: a local object that shadows `import * as UI` is not it.
  [
    "a member of an object that shadows a namespace import",
    'function Row() {\n  const UI = { TabsTrigger: Other };\n  const Trigger = UI.TabsTrigger;\n  return <Trigger className="border-b-0" />;\n}',
  ],
  // A computed key that is statically a string names its prop as plainly as
  // an identifier does.
  [
    "a spread carrying an unrelated prop under a computed key",
    '<TabsTrigger {...{ ["value"]: "a" }} />',
  ],
  // The base state, not a copy of the disabled treatment: the owned variant
  // rule is more specific and keeps winning while disabled.
  [
    "an unqualified class restating a state-qualified owned rule",
    '<TabsTrigger className="opacity-50" />',
  ],
  // CSS defines `initial` for this property AS `none`, so it draws nothing.
  [
    "a border image source reset to initial",
    '<TabsTrigger style={{ borderImageSource: "initial" }} />',
  ],
  // clsx omits a key whose condition is falsy, and `undefined` is the
  // ordinary spelling of an optional one. It is an IDENTIFIER rather than a
  // keyword, so a test on node kind walks past it.
  [
    "a class map whose condition is undefined",
    '<TabsTrigger className={cn({ "border-b-0": undefined })} />',
  ],
  // `unset` on a NON-inherited property is its initial value, which for
  // `border-image-source` is `none`, so it covers nothing.
  [
    "a border image source reset to unset",
    '<TabsTrigger style={{ borderImageSource: "unset" }} />',
  ],
];

/** [what it is, the whole file] for components this primitive does not own. */
const UNCLAIMED = [
  [
    "a same-named component from another library",
    'import { TabsList } from "some-other-library";\n<TabsList className="rounded-md border-b-0" />',
  ],
  [
    "a same-named component from a non-relative tabs path",
    'import { TabsList } from "some-other-library/tabs";\n<TabsList className="rounded-md" />',
  ],
  [
    "a locally declared component of the same name",
    'function TabsList() { return null; }\n<TabsList className="rounded-md" />',
  ],
];

/** The same body as an element relative imports must resolve for. */
const ACTIVE_INK =
  '<TabsTrigger className="data-[state=active]:text-primary" />';

tester.run("tab-indicator", rule, {
  valid: [
    // A layout class, a legitimate style, an element aimed elsewhere: the
    // complement of every shape below, and the reason this is a contract
    // rather than a ban. A check that flags these gets switched off.
    ...CLEAN.map(([, body]) => ({ code: IMPORT + body, filename: PROBE })),
    // Ownership follows the import, not the spelling.
    ...UNCLAIMED.map(([, code]) => ({ code, filename: PROBE })),
    // The value never reaches a tab: a divider elsewhere on the page.
    {
      code: `${IMPORT}const dividerStyle = { borderBottomColor: c };\n<div style={dividerStyle} />;\n<TabsList />`,
      filename: PROBE,
    },
    // `plugin-page-builder/src/render/blocks` holds a second `tabs.tsx`; a
    // sibling importing `./tabs` there renders a different component.
    {
      code: `import { TabsTrigger } from "./tabs";\n${ACTIVE_INK}`,
      filename: join(
        REPO,
        "packages/plugin-page-builder/src/render/blocks/probe.tsx"
      ),
    },
    // The same `../tabs` from `components/` lands on a path holding no tabs:
    // the importer's directory decides, not the specifier's spelling.
    {
      code: `import { TabsTrigger } from "../tabs";\n${ACTIVE_INK}`,
      filename: join(REPO, "packages/ui/src/components/probe.tsx"),
    },
    // A module whose name merely ENDS in `tabs` is a different file.
    {
      code: `import { TabsTrigger } from "../other-tabs.js";\n${ACTIVE_INK}`,
      filename: join(REPO, "packages/ui/src/components/probe/probe.tsx"),
    },
  ],
  invalid: [
    // Each a shape an earlier version returned clean on, or a category it
    // never read. Without these, a check that can never report passes.
    // Two bodies are listed twice, once as a shape and once as the control for
    // an exclusion; the tester refuses an identical case, and one run of it
    // answers both reasons.
    ...[...new Set(CATCHES.map(([, body]) => body))].map(body => ({
      code: IMPORT + body,
      filename: PROBE,
      errors: 1,
    })),
    {
      code: `${IMPORT}<TabsTrigger className="data-[state=active]:border-b-destructive" />`,
      filename: PROBE,
      errors: [
        { message: /^displaces data-\[state=active\]:border-b-primary/ },
      ],
    },
    // From `components/probe/`, `../tabs` IS the primitive.
    {
      code: `import { TabsTrigger } from "../tabs";\n${ACTIVE_INK}`,
      filename: join(REPO, "packages/ui/src/components/probe/probe.tsx"),
      errors: 1,
    },
    // A `.js` specifier resolves to the adjacent TypeScript source under
    // NodeNext, so `../tabs.js` IS `tabs.tsx`.
    {
      code: `import { TabsTrigger } from "../tabs.js";\n${ACTIVE_INK}`,
      filename: join(REPO, "packages/ui/src/components/probe/probe.tsx"),
      errors: 1,
    },
    {
      code: 'import { TabsTrigger as Trigger } from "@nextlyhq/ui";\n<Trigger className="rounded-md" />',
      filename: PROBE,
      errors: 1,
    },
    {
      code: 'import * as UI from "@nextlyhq/ui";\n<UI.TabsTrigger className="border-b-0" />',
      filename: PROBE,
      errors: 1,
    },
    // `@nextlyhq/admin` re-exports the primitive verbatim.
    {
      code: 'import { TabsTrigger } from "@nextlyhq/admin";\n<TabsTrigger className="border-b-0" />',
      filename: PROBE,
      errors: 1,
    },
    // A style held under a name is reported for being unreadable, whatever
    // the name holds: both elements, not only the one that paints.
    {
      code: `${IMPORT}function a() { const s = { borderBottomColor: c }; return <TabsTrigger style={s} />; }\nfunction b() { const s = { width: 2 }; return <TabsTrigger style={s} />; }`,
      filename: PROBE,
      errors: [
        { message: /^sets an inline style this scan cannot read/ },
        { message: /^sets an inline style this scan cannot read/ },
      ],
    },
    // A CommonJS consumer reaches the primitive exactly as an ESM one does.
    // JavaScript files, `.js` included, are read: lint-config.test.mjs probes
    // one through the CLI, which parses JSX in `.js` where this tester does not.
    {
      code: 'const { TabsTrigger } = require("@nextlyhq/ui");\n<TabsTrigger className="border-b-0" />',
      filename: join(REPO, "probe-require.jsx"),
      errors: 1,
    },
    {
      code: 'import { TabsTrigger } from "@nextlyhq/ui";\n<TabsTrigger className="border-b-0" />',
      filename: join(REPO, "probe.jsx"),
      errors: 1,
    },
  ],
});

describe("the CSS the tab primitive owns", () => {
  it("keeps each component's properties apart", () => {
    // The trigger's focus ring uses `box-shadow`, so a union of the two slots
    // would forbid a shadow on the LIST, a different element that cannot
    // replace that ring. The trigger draws more than the strip does.
    const owned = ownedCssProperties();
    expect(owned.TabsTrigger.size).toBeGreaterThan(owned.TabsList.size);
    expect(owned.TabsTrigger.has("box-shadow")).toBe(true);
    expect(owned.TabsList.has("box-shadow")).toBe(false);
  });

  it("treats complementary states as unable to apply together", () => {
    // Asked of the coexistence test directly, because through a call site it
    // cannot be isolated: every disjoint pair in this vocabulary also meets a
    // rule it genuinely does coexist with, so the call site is reported
    // either way. Both spellings are what Tailwind compiles:
    //   `not-disabled:` -> `&:not(*:disabled)` against `&:disabled`
    //   `data-[state=active]:` -> `&[data-state="active"]`
    expect(excludeEachOther("&:not(*:disabled)", "&:disabled")).toBe(true);
    expect(
      excludeEachOther('&[data-state="active"]', '&[data-state="inactive"]')
    ).toBe(true);
    // An ancestor's qualifier is not the subject's: `group-not-disabled:`
    // compiles the negation into a descendant group.
    expect(
      excludeEachOther("&:is(:where(.group):not(*:disabled) *)", "&:disabled")
    ).toBe(false);
    // The positive controls: a test answering `true` to everything would pass
    // both cases above and skip every comparison in the contract.
    expect(excludeEachOther("&:hover", '&[data-state="active"]')).toBe(false);
    expect(
      excludeEachOther('&[data-state="active"]', '&[data-state="active"]')
    ).toBe(false);
  });
});
