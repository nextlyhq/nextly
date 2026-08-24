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
 * printed and a reader has no other way to learn the scope: the fixed list
 * of files in `CONVERTED` below, and nothing else. A file that was converted
 * onto the page's measure but is absent from that list is UNCHECKED, not clean —
 * this scan has no way to discover a form page on its own, so its silence
 * about a file it never opened is not evidence about that file. Extend the
 * list when a new page is converted; a passing suite does not do that for
 * you.
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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../../");

/**
 * The form components whose page now owns the measure.
 *
 * This is the scan's entire population. See the file header: absence from
 * this list means unchecked, never means clean.
 */
const CONVERTED = [
  "packages/plugin-form-builder/src/admin/FormBuilderView.tsx",
  "packages/plugin-form-builder/src/admin/components/builder/FormSettingsTab.tsx",
  "packages/plugin-form-builder/src/admin/components/builder/FormNotificationsTab.tsx",
  "packages/admin/src/components/features/api-keys/CreateApiKeyForm.tsx",
  "packages/admin/src/components/features/api-keys/EditApiKeyForm.tsx",
  "packages/admin/src/components/features/role-management/RoleForm.tsx",
  "packages/admin/src/components/features/settings/ImageSizeForm.tsx",
  "packages/admin/src/components/features/settings/EmailProviderForm/EmailProviderForm.tsx",
  "packages/admin/src/components/features/webhooks/WebhookForm.tsx",
];

/**
 * A JSX opening tag, attributes included, spanning any number of lines.
 *
 * Matching the whole tag rather than a single line is what makes a
 * multi-line `className` visible: JSX wraps one attribute per line once an
 * element has more than two, so a line-scoped pattern never sees a class
 * that sits on its own line inside a tag that started several lines above.
 */
const ELEMENT = /<[A-Za-z][^>]*?>/gs;

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
  return (source.match(ELEMENT) ?? []).filter(
    element => !EXEMPT_TAGS.has(tagNameOf(element)) && OWN_MEASURE.test(element)
  );
}

describe("converted form pages do not set their own measure", () => {
  it("reads every listed file", () => {
    // Asserts the POPULATION before the verdict: a scan that read nothing
    // satisfies "no violations" perfectly, and this is what keeps that from
    // passing silently. Every path resolving to non-empty content also
    // confirms the list above still matches the tree.
    for (const path of CONVERTED) {
      expect(readFileSync(resolve(ROOT, path), "utf8").length).toBeGreaterThan(
        0
      );
    }
  });

  it.each(CONVERTED)("%s sets no max-width of its own", path => {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    expect(offendersIn(source)).toEqual([]);
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
