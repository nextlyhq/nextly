/**
 * One wording convention in every Builder dialog and panel.
 *
 * Each check reads the RENDERED page, not a list of strings, so a string added
 * to any surface below is covered without editing this file:
 *
 * - Button order: every dialog and sheet has a footer (the footer components
 *   of `@nextlyhq/ui`, marked below by wrapping them, so a footer is found by
 *   the component that draws it rather than by its classes), and in it a
 *   dismissing button (Cancel, Close) never comes after the confirming one.
 * - Sentence case: titles (headings, including dialog and sheet titles),
 *   labels (`<label>` elements and every `aria-label`) and button text. Each
 *   run of text is checked as its own sentence: first word capitalised, every
 *   other word lowercase unless it is a proper noun or acronym the product
 *   uses, or a name the fixtures supplied. Text shown in monospace (`code`,
 *   `kbd`, `.font-mono`) is a name or code and is skipped.
 * - Internal names: no rendered text, `aria-label`, `title` or placeholder
 *   holds a catalog type id that differs from its plain name (derived from
 *   the catalog), the words "component" or "array", or a table name (the
 *   `dc_` prefix and every table the fixtures name). Two places may: an
 *   element marked `data-builder-copy="database-name"` (a field's name in the
 *   database and API) that sits inside an element saying "name in the
 *   database and API", and an element marked
 *   `data-builder-copy="database-details"` (what the database reported) whose
 *   own text says it is the database's. No surface renders the second today;
 *   the check allows it so a details section can be added without editing
 *   this file.
 *
 * What these checks let through:
 * - Strings only shown after an interaction not performed here: a search
 *   with no match in the picker, a dropdown or popover opened, the hidden
 *   system fields row restored, a toast, the "Applying..." state.
 * - Text that is not a title, label or button (descriptions, help text,
 *   badges) is checked for internal names but not for sentence case.
 * - Text the server writes (a preview's warnings) is shown as it arrives; the
 *   fixtures here carry warnings in the server's shape.
 * - A field's database name that is not a type id or table name: a field
 *   name shown outside a labelled place is not detected.
 * - Words split across two elements are checked as two sentences, so a
 *   capital at the start of an inner element passes; a run opening with
 *   punctuation ("(data preserved)") is read as a continuation, so its first
 *   word is not required to be capitalised.
 */
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { cleanup, render, screen } from "@admin/__tests__/utils";
import type {
  SchemaPreviewChange,
  SchemaPreviewLeavingTranslation,
  SchemaPreviewRenameCandidate,
  InteractiveField,
  SchemaPreviewResponse,
} from "@admin/services/schemaApi";

import { BuilderFieldList } from "../BuilderFieldList";
import { BuilderSchemaChangeDialogs } from "../BuilderSchemaChangeDialogs";
import { BuilderSettingsModal } from "../BuilderSettingsModal";
import { BuilderToolbar } from "../BuilderToolbar";
import type { BuilderConfig, BuilderKind } from "../builder-config";
import { FieldEditorSheet } from "../FieldEditorSheet";
import { FieldPickerModal } from "../FieldPickerModal";
import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";
import type { BuilderField, SchemaChangeConfirmation } from "../types";

// The footers are marked by the component that draws them, so the order check
// finds a footer however its classes change.
vi.mock("@nextlyhq/ui", async importOriginal => {
  const ui = await importOriginal<typeof import("@nextlyhq/ui")>();
  return {
    ...ui,
    AlertDialogFooter: (props: ComponentProps<typeof ui.AlertDialogFooter>) => (
      <ui.AlertDialogFooter {...props} data-builder-footer="" />
    ),
    DialogFooter: (props: ComponentProps<typeof ui.DialogFooter>) => (
      <ui.DialogFooter {...props} data-builder-footer="" />
    ),
    SheetFooter: (props: ComponentProps<typeof ui.SheetFooter>) => (
      <ui.SheetFooter {...props} data-builder-footer="" />
    ),
  };
});

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({}),
}));

// The type editors list the entities a field can point at; a fixed list keeps
// them out of the network and their labels in the fixtures.
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollections: () => ({
    data: { items: [{ name: "posts", label: "Posts" }] },
    isLoading: false,
  }),
  useSingles: () => ({
    data: { items: [{ slug: "homepage", label: "Homepage" }] },
    isLoading: false,
  }),
  useFieldGroups: () => ({
    data: { items: [{ slug: "hero", label: "Hero" }] },
    isLoading: false,
  }),
}));

// ---------------------------------------------------------------------------
// What the checks allow
// ---------------------------------------------------------------------------

/** Proper nouns and acronyms that keep their capitals mid-sentence. */
const KEPT_CAPITALS = new Set([
  "Single",
  "Singles",
  "JSON",
  "URL",
  "API",
  "ID",
  "SQL",
  "Nextly",
]);

/** Names the fixtures below supply, which keep the case a person gave them. */
const FIXTURE_NAMES = new Set([
  "Post",
  "Posts",
  "Excerpt",
  "Homepage",
  "Hero",
  "Users",
  "Draft",
]);

/** Type ids that are not already their own plain name, read from the catalog. */
const INTERNAL_TYPE_IDS: readonly string[] = FIELD_TYPES_CATALOG.filter(
  entry => entry.type.toLowerCase() !== entry.label.toLowerCase()
).map(entry => entry.type);

/** The tables the fixtures name; every one is an internal name. */
const FIXTURE_TABLES = ["dc_posts", "dc_posts_locales"];

const INTERNAL_WORDS: readonly RegExp[] = [
  ...INTERNAL_TYPE_IDS.map(id => new RegExp(`\\b${id}\\b`)),
  // The field group type's migrated spelling, which stored data may carry
  // and the catalog does not list.
  /\bfieldGroups?\b/,
  /\bcomponents?\b/i,
  /\barrays?\b/i,
  /\bdc_\w+/,
  ...FIXTURE_TABLES.map(table => new RegExp(`\\b${table}\\b`)),
];

const DISMISSING = /^(cancel|close)$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const none = (): SchemaPreviewChange => ({
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
});

/** A confirmation on screen for one preview; nothing it is asked to do runs. */
function confirmation(
  preview: Partial<SchemaPreviewResponse>
): SchemaChangeConfirmation {
  return {
    preview: {
      hasChanges: true,
      hasDestructiveChanges: false,
      classification: "safe",
      changes: none(),
      warnings: [],
      interactiveFields: [],
      ddlPreview: [],
      schemaVersion: 1,
      renamed: [],
      ...preview,
    },
    previewId: 1,
    isOpen: true,
    isApplying: false,
    request: () => {},
    setOpen: () => {},
    settle: () => {},
    beginApply: () => {},
    endApply: () => {},
  };
}

const addedRichText: SchemaPreviewChange["added"][number] = {
  name: "summary",
  type: "richText",
  required: false,
  hasDefault: false,
  classification: "safe",
};

const removedUpload: SchemaPreviewChange["removed"][number] = {
  name: "cover",
  type: "upload",
  rowCount: 12,
  classification: "destructive",
};

const typeChange: SchemaPreviewChange["changed"][number] = {
  name: "body",
  from: "textarea",
  to: "richText",
  rowCount: 40,
  classification: "destructive",
  reason: "type_changed",
};

const prompts: InteractiveField[] = [
  {
    name: "meta_title",
    reason: "new_required_no_default",
    tableRowCount: 8,
    options: ["provide_default", "mark_nullable", "cancel"],
  },
  {
    name: "subtitle",
    reason: "nullable_to_not_null_with_nulls",
    tableRowCount: 8,
    nullCount: 2,
    options: ["provide_default", "mark_nullable", "cancel"],
  },
];

const renames: SchemaPreviewRenameCandidate[] = [
  {
    table: "dc_posts_locales",
    from: "heading",
    to: "title2",
    fromType: "varchar(255)",
    toType: "varchar(255)",
    typesCompatible: true,
    preservesValues: true,
    defaultSuggestion: "rename",
  },
  {
    table: "dc_posts",
    from: "price",
    to: "amount",
    fromType: "varchar(255)",
    toType: "numeric",
    typesCompatible: true,
    preservesValues: false,
    valueChangeReason: "Values are rounded to the nearest binary float.",
    defaultSuggestion: "rename",
  },
];

const refusedLeaving: SchemaPreviewLeavingTranslation[] = [
  {
    name: "heading",
    column: "heading",
    byLocale: { en: 3, fr: 2 },
    total: 5,
    entriesWithoutDefault: 0,
    defaultLocale: "en",
    restoreCommand: "nextly i18n:restore --collection posts --field heading",
    refusal: {
      reason: "A required field can't stop being translated in one change.",
      steps: ["Make it optional", "Turn translation off", "Make it required"],
    },
  },
];

const field = (over: Partial<BuilderField>): BuilderField => ({
  id: `f-${over.type ?? "text"}`,
  name: "excerpt",
  label: "Excerpt",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
  ...over,
});

const configFor = (kind: BuilderKind): BuilderConfig => ({
  kind,
  basicsFields:
    kind === "single"
      ? ["singularName", "slug", "description", "icon"]
      : ["singularName", "pluralName", "slug", "description", "icon"],
  advancedFields:
    kind === "field-group"
      ? ["category", "i18n", "showSystemFields"]
      : ["status", "i18n", "versions", "showSystemFields"],
  toolbar: { previewSchemaChange: kind === "collection" },
  picker: {},
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

type User = ReturnType<typeof userEvent.setup>;

interface Surface {
  name: string;
  ui: ReactElement;
  /** Brings the surface to the state checked, after it renders. */
  then?: (user: User) => Promise<void>;
}

const review = (
  name: string,
  preview: Parameters<typeof confirmation>[0],
  kind: BuilderKind = "collection"
): Surface => ({
  name,
  ui: (
    <BuilderSchemaChangeDialogs
      confirmation={confirmation(preview)}
      kind={kind}
      entityName="posts"
      onConfirm={() => {}}
    />
  ),
});

const sheet = (
  name: string,
  props: Partial<ComponentProps<typeof FieldEditorSheet>> & {
    field: BuilderField;
  },
  then?: Surface["then"]
): Surface => ({
  name,
  ui: (
    <FieldEditorSheet
      open
      mode="edit"
      kind="collection"
      siblingFields={[]}
      onCancel={() => {}}
      onApply={() => {}}
      onDelete={() => {}}
      {...props}
    />
  ),
  then,
});

const tab = (label: string) => async (user: User) => {
  await user.click(screen.getByRole("tab", { name: label }));
};

const settings = (
  name: string,
  kind: BuilderKind,
  mode: "create" | "edit",
  then?: Surface["then"]
): Surface => ({
  name,
  ui: (
    <BuilderSettingsModal
      open
      mode={mode}
      config={configFor(kind)}
      initialValues={
        mode === "edit"
          ? { singularName: "Post", slug: "posts", icon: "FileText" }
          : null
      }
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  ),
  then,
});

const SURFACES: readonly Surface[] = [
  // The save review, in each of its states.
  review("safe save", { changes: { ...none(), added: [addedRichText] } }),
  review(
    "safe save on a Single",
    {
      changes: { ...none(), added: [addedRichText] },
    },
    "single"
  ),
  review("removed field", {
    hasDestructiveChanges: true,
    classification: "destructive",
    changes: { ...none(), removed: [removedUpload] },
    warnings: ["Removing field 'cover' will drop 12 rows of data."],
  }),
  review("type change", {
    hasDestructiveChanges: true,
    classification: "destructive",
    changes: { ...none(), changed: [typeChange] },
  }),
  review("needs an answer", {
    hasDestructiveChanges: true,
    classification: "interactive",
    interactiveFields: prompts,
  }),
  review("rename with nothing deleted", { renamed: [renames[0]] }),
  review("rename", {
    hasDestructiveChanges: true,
    classification: "destructive",
    renamed: renames,
  }),
  review("refused change", {
    hasDestructiveChanges: true,
    classification: "destructive",
    leavingTranslation: refusedLeaving,
  }),
  review(
    "save of a field group",
    {
      hasDestructiveChanges: true,
      classification: "destructive",
      changes: { ...none(), changed: [typeChange] },
    },
    "field-group"
  ),

  // The field sheet: each tab, each type editor, the delete confirm.
  sheet("field sheet, general", { field: field({}) }),
  sheet("field sheet, validation", { field: field({}) }, tab("Validation")),
  sheet("field sheet, display", { field: field({}) }, tab("Display")),
  sheet("field sheet, advanced", { field: field({}) }, tab("Advanced")),
  sheet("field sheet, new field", { field: field({}), mode: "create" }),
  sheet("field sheet, read-only", { field: field({}), readOnly: true }),
  sheet("field sheet, select options", {
    field: field({
      type: "select",
      options: [{ id: "o1", label: "Draft", value: "draft" }],
    }),
  }),
  sheet("field sheet, link to entries", {
    field: field({ type: "relationship", relationTo: "posts" }),
  }),
  sheet("field sheet, image or file", { field: field({ type: "upload" }) }),
  sheet("field sheet, repeating rows", {
    field: field({ type: "repeater", fields: [] }),
  }),
  sheet("field sheet, group", { field: field({ type: "group", fields: [] }) }),
  sheet("field sheet, field group", {
    field: field({ type: "component", component: "hero" }),
  }),
  sheet("field sheet, field group (migrated type)", {
    field: field({ type: "fieldGroup", component: "hero" }),
  }),
  sheet("field sheet, rich text", { field: field({ type: "richText" }) }),
  sheet("field sheet, delete confirm", { field: field({}) }, async user => {
    await user.click(screen.getByRole("button", { name: /delete field/i }));
  }),

  // The settings modal: each tab, create and edit, each kind.
  ...(["collection", "single", "field-group"] as const).flatMap(kind => [
    settings(`settings, new ${kind}`, kind, "create"),
    settings(`settings, ${kind} advanced`, kind, "create", tab("Advanced")),
    settings(`settings, edit ${kind}`, kind, "edit"),
    settings(`settings, edit ${kind} advanced`, kind, "edit", tab("Advanced")),
  ]),

  // The field picker.
  {
    name: "field picker",
    ui: (
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={() => {}}
        onSelect={() => {}}
      />
    ),
  },

  // The toolbar and the field outline, for each kind.
  ...(["collection", "single", "field-group"] as const).flatMap(kind => [
    {
      name: `toolbar, ${kind}`,
      ui: (
        <BuilderToolbar
          config={configFor(kind)}
          name="Posts"
          unsavedCount={1}
          onOpenSettings={() => {}}
          onSave={() => {}}
        />
      ),
    },
    {
      name: `field outline, ${kind}`,
      ui: (
        <DndContext>
          <BuilderFieldList
            kind={kind}
            fields={[
              field({
                id: "system_title",
                name: "title",
                label: "Title",
                isSystem: true,
              }),
              field({ id: "u1", type: "richText" }),
              field({
                id: "u2",
                type: "upload",
                name: "cover",
                label: "Cover",
              }),
            ]}
            onAddAt={() => {}}
            onEditField={() => {}}
            onDeleteField={() => {}}
            onDuplicateField={() => {}}
            onReorder={() => {}}
            onAddInsideParent={() => {}}
          />
        </DndContext>
      ),
    },
  ]),
];

/** Render each surface in turn and gather what `check` finds in it. */
async function violations(check: () => string[]): Promise<string[]> {
  const found: string[] = [];
  for (const surface of SURFACES) {
    const user = userEvent.setup();
    render(surface.ui);
    await surface.then?.(user);
    found.push(...check().map(problem => `${surface.name}: ${problem}`));
    cleanup();
  }
  return found;
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

const MONOSPACE = "code, kbd, .font-mono";

/**
 * The element's text as the sentences it holds: text nodes are grouped by the
 * element that holds them (so an interpolated name stays in its sentence),
 * monospace text is left out, and each group is split at sentence ends.
 */
function sentences(element: Element): string[] {
  const groups = new Map<Element, string>();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(MONOSPACE)) continue;
    groups.set(parent, (groups.get(parent) ?? "") + (node.textContent ?? ""));
  }
  const fromAttribute = element.getAttribute("aria-label");
  const texts = fromAttribute !== null ? [fromAttribute] : [...groups.values()];
  return texts
    .flatMap(text => text.split(/[.!?:]\s+|[.!?:]$/))
    .map(text => text.trim())
    .filter(text => /[A-Za-z]/.test(text));
}

/** What is wrong with one sentence's case, or null when nothing is. */
function caseProblem(sentence: string): string | null {
  const words = sentence.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? [];
  const [first, ...rest] = words;
  // A run that opens with punctuation, "(data preserved)", continues the
  // sentence before it, so its first word is not a sentence start.
  const continues = /^[^A-Za-z0-9]/.test(sentence);
  if (
    first &&
    !continues &&
    /^[a-z]/.test(first) &&
    !FIXTURE_NAMES.has(first)
  ) {
    return `"${sentence}" starts in lowercase`;
  }
  const capitalised = rest.find(
    word =>
      /[A-Z]/.test(word) && !KEPT_CAPITALS.has(word) && !FIXTURE_NAMES.has(word)
  );
  return capitalised ? `"${sentence}" capitalises "${capitalised}"` : null;
}

/** Every title, label and button on the page, with the kind of string it is. */
function titlesLabelsButtons(): Array<{ kind: string; element: Element }> {
  const pick = (kind: string, selector: string) =>
    [...document.body.querySelectorAll(selector)].map(element => ({
      kind,
      element,
    }));
  return [
    ...pick("title", "h1, h2, h3, h4, h5, h6, [role='heading']"),
    ...pick("label", "label"),
    ...pick("label", "[aria-label]:not(svg)"),
    ...pick("button", "button"),
  ];
}

/** The page's text with the two places allowed to hold internal names left out. */
function visibleText(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  for (const marked of copy.querySelectorAll("[data-builder-copy]")) {
    const place = marked.getAttribute("data-builder-copy");
    const labelled =
      place === "database-name"
        ? /name in the database and API/i.test(
            marked.parentElement?.textContent ?? ""
          )
        : place === "database-details" &&
          /database/i.test(marked.textContent ?? "");
    if (labelled) marked.remove();
  }
  const attributes = [...copy.querySelectorAll("*")].flatMap(element =>
    ["aria-label", "title", "placeholder"]
      .map(name => element.getAttribute(name))
      .filter((value): value is string => value !== null)
  );
  // Text node by text node: `textContent` runs neighbouring elements together
  // ("summaryrichText"), and a word boundary is then never found.
  const texts: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node.textContent ?? "");
  }
  return [...texts, ...attributes].join("\n");
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

describe("the Builder's wording convention", () => {
  it("every Builder dialog puts the confirming action last", async () => {
    const found = await violations(() => {
      const problems: string[] = [];
      const dialogs = document.body.querySelectorAll(
        "[role='dialog'], [role='alertdialog']"
      );
      for (const dialog of dialogs) {
        const footer = dialog.querySelector("[data-builder-footer]");
        if (!footer) {
          problems.push("a dialog with no footer component");
          continue;
        }
        const labels = [...footer.querySelectorAll("button")].map(
          button => button.textContent?.trim() ?? ""
        );
        const lastConfirming = labels.findLastIndex(l => !DISMISSING.test(l));
        const lastDismissing = labels.findLastIndex(l => DISMISSING.test(l));
        if (lastConfirming !== -1 && lastDismissing > lastConfirming) {
          problems.push(`footer reads [${labels.join("] [")}]`);
        }
      }
      return problems;
    });
    expect(found).toEqual([]);
  }, 60_000);

  it("every Builder title, label and button is in sentence case", async () => {
    const found = await violations(() =>
      titlesLabelsButtons().flatMap(({ kind, element }) =>
        sentences(element)
          .map(caseProblem)
          .filter((problem): problem is string => problem !== null)
          .map(problem => `${kind} ${problem}`)
      )
    );
    expect([...new Set(found)]).toEqual([]);
  }, 60_000);

  it("no internal type id or table name in the Builder's strings", async () => {
    const found = await violations(() => {
      const text = visibleText();
      return INTERNAL_WORDS.filter(word => word.test(text)).map(
        word =>
          `shows ${word.source}: "${text
            .split("\n")
            .find(line => word.test(line))
            ?.trim()
            .slice(0, 120)}"`
      );
    });
    expect(found).toEqual([]);
  }, 60_000);
});
