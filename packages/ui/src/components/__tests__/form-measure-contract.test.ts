/**
 * A form component must not set its own measure.
 *
 * The PAGE owns width and padding — `PageContainer` renders `PageShell` when a
 * page asks for a measure — so the form components below cannot answer the
 * "how wide is a form" question several different ways again. The scan reads whole ELEMENTS rather than lines:
 * JSX puts one attribute per line once an element carries more than two, so
 * a line-scoped search reports a multi-line element as conforming while it
 * carries the very class being looked for.
 *
 * WHAT THIS COVERS, stated here because a green run is read where it is
 * printed and a reader has no other way to learn the scope: every `.tsx` under
 * the admin and the two plugin packages that renders a part of the form-layout
 * kit, plus the short `UNMARKED` list of form bodies that render none of it.
 *
 * The population is DERIVED rather than listed, and that is the point. A fixed
 * list has to be edited in the same commit that converts a form, which is
 * exactly the edit that gets forgotten — leaving a green run that means "never
 * looked at" while reading as "clean". Two files converted by this change were
 * missing from the list that preceded this, and a competing wrapper in either
 * would have gone unseen.
 *
 * Two blind spots, both named rather than left to be found.
 *
 * `UNMARKED` is the first: a form body that renders no part of the kit cannot
 * be discovered, so it is listed. That list is checked against the derivation,
 * so it cannot quietly hold files that no longer need naming.
 *
 * The second is a measured PAGE that renders no part of the kit itself — one
 * that renders `<WebhookForm>` and nothing else, where the element carrying a
 * competing width would be the page's own wrapper. Marking such a page by its
 * `<PageContainer width=` widens the population from form bodies to whole
 * files, which then meets every toolbar and portalled dialog in them: measured,
 * that produces six legitimate `max-w-*` uses across four settings pages, and
 * keeping it green needs an exemption list that grows. The precise form of the
 * check is the DIRECT CHILDREN of the measured container, and it belongs with
 * the change that converts the remaining form pages, where there are real
 * measured hosts to write it against.
 *
 * The negative-control block below exists because the check's own pattern
 * has a shape that could over-report: the shared field-half width utility in
 * `field-shell.tsx`, spelled as the CSS-variable token form of a max-width
 * (an `--nx-field-half` custom property with a 380px fallback), also matches
 * the text `max-w-`, and that call site is legitimate — it is the layout's
 * OWN width token, not a page re-declaring one. `OWN_MEASURE` excludes that
 * CSS-variable token spelling for exactly that reason, and the control below
 * exercises it against the real file rather than trusting the regex by
 * inspection.
 *
 * Two more spellings are excluded, and both are earned by running the scan
 * against the real tree rather than assumed: `max-w-full` and `max-w-none`
 * are relative to the parent, so neither sets an absolute width a page
 * container could compete over — "no wider than my container" is true
 * whatever the container's own measure is. `TabsList`'s horizontal-scroll
 * strip in `FormBuilderView.tsx` carries `max-w-full` for exactly that
 * reason and is not a page re-declaring anything. And `SheetContent` /
 * text-flow tags (`p`, `span`) are excluded by name: a `Sheet` mounts into a
 * portal and its width governs a slide-out panel, not the page the shell
 * measures — `FormNotificationsTab.tsx`'s notification editor is a fixed
 * 560px panel by design — and a paragraph's `max-w-*` caps a reading line
 * length, a typography concern the page measure has never owned.
 *
 * BLIND SPOT, same shape as the file list above: an element on the
 * `EXEMPT_TAGS` list that was, despite its name, actually acting as the
 * page's own wrapper would go unseen, as would a competing measure spelled
 * `max-w-full`/`max-w-none` (neither can express a real page measure, so
 * this is not expected to occur). Nothing in the nine files does this today;
 * if one starts, narrow the exemption rather than trusting it forever.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../../");

/**
 * Where a form body can live. Both trees are walked in full.
 */
const ROOTS = [
  "packages/admin/src",
  "packages/plugin-form-builder/src",
  "packages/plugin-page-builder/src",
];

/**
 * What marks a file as a form body: it renders one of the form-layout kit's
 * parts. A file that renders any of these is content inside a page whose
 * container declares the measure, so it must not declare one itself.
 */
const FORM_BODY = /<(FormSection|FormActions|FieldShell)\b/;

/**
 * Form bodies that carry NO marker, listed because nothing can discover them.
 *
 * A tab body of plain elements renders no part of the kit, so the scan cannot
 * find it the way it finds the rest. Each entry is here because it is a form
 * body, not because it once was: check that before adding one.
 */
const UNMARKED = [
  "packages/plugin-form-builder/src/admin/components/builder/FormSettingsTab.tsx",
];

/** Every `.tsx` under `dir`, recursively, as repo-relative paths. */
function tsxFilesIn(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(resolve(ROOT, dir), {
    withFileTypes: true,
  })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...tsxFilesIn(path));
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test."))
      found.push(path);
  }

  return found;
}

/**
 * The scan's population, DERIVED rather than listed.
 *
 * A fixed list is a list that drifts: this change converted nine components
 * off `FormLayout` and a hand-maintained population would have to be edited in
 * the same commit, which is exactly the edit that gets forgotten — leaving a
 * green run that means "not looked at" while reading as "clean". Deriving it
 * means a form added tomorrow is covered the day it is written.
 *
 * `UNMARKED` is the residue the derivation cannot reach, and the test below
 * fails if an entry there becomes discoverable, so the list cannot quietly
 * accumulate files that no longer need naming.
 */
function formBodies(): string[] {
  const derived = ROOTS.flatMap(tsxFilesIn).filter(path =>
    FORM_BODY.test(readFileSync(resolve(ROOT, path), "utf8"))
  );

  return [...new Set([...derived, ...UNMARKED])].sort();
}

/**
 * Every JSX opening tag in `source`, attributes included, spanning any number
 * of lines.
 *
 * Reading the whole tag rather than a single line is what makes a multi-line
 * `className` visible: JSX wraps one attribute per line once an element has
 * more than two, so a line-scoped pattern never sees a class that sits on its
 * own line inside a tag that started several lines above.
 *
 * Scanned character by character rather than matched with `<[A-Za-z][^>]*?>`,
 * because that pattern ends the tag at the FIRST `>` — including the one in an
 * arrow callback. `onSubmit={e => ...}` before `className` truncates the tag
 * mid-attribute, and every class after it becomes invisible while the scan
 * still reports a whole element. Brace depth and quote state are what separate
 * a `>` that closes the tag from one that is part of an expression.
 */
/**
 * The index just past the string literal starting at `at`, or `at` itself when
 * nothing starts there.
 *
 * Pulled out so the tag scan below reads as one question per branch. A `>`
 * inside an attribute string is not the tag's end, and treating it as one is
 * half of what makes later attributes invisible.
 */
function skipString(source: string, at: number): number {
  const quote = source[at];
  if (quote !== '"' && quote !== "'" && quote !== "`") return at;

  // Walked rather than found with `indexOf`, because an ESCAPED quote is not
  // the string's end. `alert('Don\'t')` inside a callback would otherwise
  // close the string early, leaving the rest of the tag read as code — and a
  // `>` in the remaining text ends the element mid-attribute. An apostrophe is
  // common enough in a message that this is not an edge case.
  for (let i = at + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === quote) return i + 1;
  }

  return source.length;
}

/**
 * The index of the `>` that closes the tag opened at `open`, or -1 when the
 * text runs out or another tag starts first.
 *
 * Brace depth is the other half. A `>` inside `{e => f(e)}` is part of an
 * expression, and a scan that stops there truncates the element mid-attribute.
 *
 * Template-literal interpolation is not tracked, which is a real limit rather
 * than an oversight: an attribute value written as a template with a `>` inside
 * `${...}` would end the tag early. No file in the scanned population does
 * that, and a JSX parser is a heavy dependency for a check this size — so the
 * limit is written down here instead of being discovered later.
 */
function tagEnd(source: string, open: number): number {
  let depth = 0;

  for (let i = open + 1; i < source.length; i++) {
    const past = skipString(source, i);
    if (past !== i) {
      i = past - 1;
      continue;
    }

    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth > 0) continue;
    else if (c === ">") return i;
    else if (c === "<") return -1;
  }

  return -1;
}

function openingTags(source: string): string[] {
  const tags: string[] = [];

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "<") continue;
    if (!/[A-Za-z]/.test(source[i + 1] ?? "")) continue;

    const end = tagEnd(source, i);
    if (end === -1) continue;

    tags.push(source.slice(i, end + 1));
    i = end;
  }

  return tags;
}

/**
 * A `max-w-*` utility that could actually compete with the page's measure.
 *
 * Excludes the CSS-variable token form (the shared measure itself, written
 * as a max-width driven by a `var(...)` custom property) and
 * `max-w-full`/`max-w-none`, neither of which can ever express an absolute
 * width: both are defined relative to the parent, so they cap nothing a page
 * container could be competing over.
 */
const OWN_MEASURE = /\bmax-w-(?!\[var\(|full\b|none\b)/;

/**
 * Tags whose own `max-w-*` is never the PAGE's measure, so this scan does
 * not read them at all. See the file header for why each is here.
 */
const EXEMPT_TAGS = new Set(["SheetContent", "p", "span"]);

/** The tag name an opening tag string starts with, `""` if unreadable. */
function tagNameOf(element: string): string {
  return /^<([A-Za-z][\w.]*)/.exec(element)?.[1] ?? "";
}

/** The opening tags in `source` that carry their own `max-w-*` utility. */
function offendersIn(source: string): string[] {
  return openingTags(source).filter(
    element => !EXEMPT_TAGS.has(tagNameOf(element)) && OWN_MEASURE.test(element)
  );
}

describe("converted form pages do not set their own measure", () => {
  it("reads past an arrow callback to the classes after it", () => {
    // The separating case for the scanner. A regex ending the tag at the first
    // `>` stops inside `onSubmit={e => ...}`, so everything after it — the
    // className this file exists to find — is never examined, and the scan
    // reports a clean whole element.
    const fixture = `
      <form
        onSubmit={e => handle(e)}
        className="mx-auto max-w-[56rem]"
      >
        <span>body</span>
      </form>
    `;

    expect(offendersIn(fixture)).toHaveLength(1);
  });

  it("reads through an escaped quote inside a callback", () => {
    // An apostrophe in a message closes the string early for any scan that
    // finds the next quote rather than walking past escapes. The rest of the
    // tag is then read as code, the `>` in it ends the element, and the class
    // after it is never examined — the contract silently stops applying to
    // that element.
    const fixture = `<button onClick={() => alert('Don\\'t > go')} className="max-w-sm">x</button>`;

    expect(openingTags(fixture)).toHaveLength(1);
    expect(offendersIn(fixture)).toHaveLength(1);
  });

  it("does not mistake a `>` inside a string or a nested brace for the tag end", () => {
    // The control for the control: a scanner that tracked neither quotes nor
    // brace depth would end these tags early too, and pass the case above for
    // the wrong reason.
    const inString = `<p title="a > b" className="max-w-[40rem]">x</p>`;
    const inBraces = `<div style={{ content: ">" }} className="max-w-[40rem]">x</div>`;

    // `p` is exempt by tag name, so it is the TAG PARSE being checked here.
    expect(openingTags(inString)).toHaveLength(1);
    expect(offendersIn(inBraces)).toHaveLength(1);
  });

  it("finds the form bodies, including the ones this change converted", () => {
    // Two named explicitly because they were the derivation's own evidence:
    // both lost their `FormLayout` here and neither appeared in the fixed list
    // this replaced, so a competing wrapper in either would have gone unseen.
    const population = formBodies();

    expect(population.length).toBeGreaterThan(8);
    for (const path of [
      "packages/admin/src/components/features/settings/UserFieldForm/UserFieldForm.tsx",
      "packages/admin/src/pages/dashboard/settings/index.tsx",
      "packages/admin/src/components/features/webhooks/WebhookForm.tsx",
      "packages/plugin-form-builder/src/admin/FormBuilderView.tsx",
    ]) {
      expect(population, `${path} is not in the population`).toContain(path);
    }
  });

  it("reads every file it names", () => {
    // Every assertion below is about file CONTENT, and an unreadable path
    // yields no content and therefore no offenders. A moved file has to fail
    // here rather than pass by silence.
    for (const path of formBodies()) {
      expect(
        readFileSync(resolve(ROOT, path), "utf8").length,
        `${path} is empty or unreadable`
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the unmarked list to what cannot be discovered", () => {
    // An entry here that the derivation already finds is dead weight, and dead
    // weight in a hand-maintained list is how the list stops being read.
    const derived = new Set(
      ROOTS.flatMap(tsxFilesIn).filter(path =>
        FORM_BODY.test(readFileSync(resolve(ROOT, path), "utf8"))
      )
    );

    expect(UNMARKED.filter(path => derived.has(path))).toEqual([]);
  });

  it("sets no max-width of its own, in any form body", () => {
    const offenders = formBodies().flatMap(path =>
      offendersIn(readFileSync(resolve(ROOT, path), "utf8")).map(
        element => `${path}: ${element.replace(/\s+/g, " ").slice(0, 120)}`
      )
    );

    expect(
      offenders,
      `A form body caps its own width. The page owns the measure — ` +
        `PageContainer declares it — and a second cap inside sits within the ` +
        `page's inset and adds to it:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

describe("the shared width token is not mistaken for one", () => {
  const FIELD_SHELL = "packages/ui/src/components/field-shell.tsx";

  it("reads field-shell.tsx and finds the token form in it", () => {
    // Silence from a file that was never opened is not evidence, so this
    // proves the read actually landed on content carrying the token form
    // rather than on an empty or unrelated file.
    const source = readFileSync(resolve(ROOT, FIELD_SHELL), "utf8");
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("max-w-[var(--nx-field-half");
  });

  it("does not report the css-variable form as an own measure", () => {
    const source = readFileSync(resolve(ROOT, FIELD_SHELL), "utf8");
    expect(offendersIn(source)).toEqual([]);
  });
});
