/**
 * The entry's other fields, drawn for a surface that covers the form.
 *
 * A takeover field — the page builder is the one that ships — fills the window,
 * so every other field on the document becomes unreachable without leaving the
 * editor and losing its undo history. This is what that surface offers back.
 *
 * It draws through `EntryFormContent`, the same component the form body uses,
 * rather than laying fields out itself. How a field is rendered is the entry
 * form's contract, and a second renderer here would be a copy that drifts —
 * silently, because both would look correct.
 *
 * The two groups are LABELLED rather than concatenated. A document's identity
 * and the fields a collection happens to declare answer to different things,
 * and the surveyed editors agree on presenting them apart: Webflow's page
 * settings open on name and slug before SEO and custom code, and the block
 * editor's document sidebar keeps status and permalink above the taxonomies.
 * Run together, a slug lands between two relations in an order the author has
 * no way to anticipate.
 *
 * @module components/entries/EntryForm/EntryFieldsPanel
 */

import { FormSection } from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import type * as React from "react";

import { computeFieldsBeside } from "@admin/lib/builder/takeoverLayout";

import { effectiveFieldGate } from "../fields/field-admin-gates";

import { DocumentAddressChip } from "./DocumentAddressChip";
import { useEntryDetails, type EntryDetailsTarget } from "./entry-details-read";
import { EntryFormContent } from "./EntryFormContent";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";

/**
 * How the entry's fields are framed: as the form's own sections, in a panel,
 * or flat, for a dialog that frames them itself and where the slug reads as
 * the page's address. The fields and their rules are the same either way.
 */
export type EntryFieldsPresentation = "panel" | "dialog";

/**
 * Which of the entry's fields to draw: its identity (`"page"`: the title, and
 * the slug as its address), or everything else (`"content"`).
 */
export type EntryFieldsGroup = "page" | "content";

/**
 * What a surface asks of the entry's fields: how they are framed, which group,
 * and which top-level fields to leave out because the surface draws them its
 * own way (another editor of the same kind, say). A left-out field keeps its
 * value in the form, so Save still stores it.
 */
export interface EntryFieldsOptions {
  /** How the fields are framed. Defaults to the panel's sections. */
  presentation?: EntryFieldsPresentation;
  /** One group alone; both, in their order, where left out. */
  group?: EntryFieldsGroup;
  /** Top-level field names drawn nowhere here. */
  leaveOut?: readonly string[];
}

/**
 * What the dialog's address needs to be drawn as the entry header draws it:
 * the site's address and the entry's path, with copy and edit. Read from the
 * entry's details only while it is drawn.
 */
export interface EntryAddressFacts {
  /** The entry whose details hold its address. */
  detailsOf: EntryDetailsTarget;
  /** Whether the entry is live, so its address may be opened. */
  published: boolean;
}

export interface EntryFieldsPanelProps {
  /** The document's identity — title, slug. */
  page: FieldConfig[];
  /** Everything else the collection declares. */
  content: FieldConfig[];
  /** Whether the surrounding form is mid-submit. */
  disabled?: boolean;
  /**
   * Whether the fields render uneditable but focusable: the document is
   * someone else's, or a refused publish's recovery is running.
   */
  readOnly?: boolean;
  /** Form mode, which write-only fields adjust their affordances for. */
  mode?: "create" | "edit";
  /**
   * The slug field's name, when this panel is offering one and the document
   * has a public address. Absent means no warning is warranted.
   */
  slugName?: string;
  /** How the fields are framed. Defaults to the panel's sections. */
  presentation?: EntryFieldsPresentation;
  /**
   * For the dialog: the slug drawn as the entry's full address, as the entry
   * header draws it, rather than as a plain field. Absent, it is a field
   * labelled "Address".
   */
  address?: EntryAddressFacts | undefined;
  /**
   * For the dialog: whether one group is drawn alone, so it has no heading of
   * its own (the surface around it names it).
   */
  alone?: boolean | undefined;
}

/**
 * Stop a keystroke in this panel from submitting the form behind it.
 *
 * These inputs are mounted inside the entry's own `<form>`, so pressing Enter
 * in a single-line field is an implicit submission. A takeover surface holds
 * its work privately and writes it back on the way out — the page builder says
 * so in as many words — and nothing in the form's contract lets it be asked to
 * flush first. An implicit submit therefore saves the value the field held
 * BEFORE the editor opened, and in create mode the navigation that follows
 * unmounts the editor and takes the unwritten work with it.
 *
 * Refusing the keystroke rather than teaching the form to flush, deliberately:
 * a flush-before-submit contract is a real change to how every surface commits
 * and is not something to introduce from a settings panel. This closes the way
 * IN that this panel opened; the wider gap is unchanged and still applies to
 * any save started from a button or a palette.
 *
 * Scoped to what actually submits implicitly. A textarea takes Enter as a
 * newline, and a control that has opened a listbox or a menu is using Enter to
 * choose — intercepting either would break the field to protect the form.
 *
 * MODIFIERS ARE NOT AN EXEMPTION. An earlier version let Shift+Enter through on
 * the assumption that a modified Enter means something other than submit; it
 * does not. Measured in a browser: Shift+Enter in a single-line input submits
 * the enclosing form exactly as a bare Enter does, so exempting it left the
 * whole of this hole open through one extra keystroke.
 *
 * A COMPOSING keystroke is exempt, and that one is real. An author using an IME
 * presses Enter to accept the candidate they are part-way through typing, and
 * that keystroke reaches here with `isComposing` set. Refusing it would not
 * protect anything — the browser does not submit on it — while making the title
 * and slug fields unusable in Japanese, Chinese and Korean.
 */
function blockImplicitSubmit(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Enter") return;
  // Read from the native event: React's synthetic keyboard event does not
  // carry `isComposing`, and `keyCode === 229` is how the same state reaches
  // engines that report the composition rather than the flag.
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.tagName !== "INPUT") return;
  if (target.getAttribute("aria-expanded") === "true") return;
  event.preventDefault();
}

/**
 * Draws whichever groups have fields, and nothing for a group that has none.
 *
 * An EMPTY group is omitted rather than drawn with a heading over blank space:
 * a labelled region containing nothing reads as a control that has failed,
 * which is the same thing the panel as a whole is withheld to avoid. Whether
 * to offer the panel at all is decided before this renders — see
 * `fieldsBesidePanel` below — so this component is never asked to draw two
 * empty groups.
 */
export function EntryFieldsPanel({
  page,
  content,
  disabled,
  readOnly,
  mode,
  slugName,
  presentation = "panel",
  address,
  alone,
}: EntryFieldsPanelProps): React.JSX.Element {
  if (presentation === "dialog") {
    return (
      <FlatEntryFields
        page={page}
        content={content}
        disabled={disabled}
        readOnly={readOnly}
        mode={mode}
        slugName={slugName}
        address={address}
        alone={alone}
      />
    );
  }
  return (
    <div className="space-y-4 p-4" onKeyDown={blockImplicitSubmit}>
      {page.length === 0 ? null : (
        <FormSection
          label="Page"
          description="How this document is identified and addressed."
        >
          <EntryFormContent
            fields={page}
            disabled={disabled}
            readOnly={readOnly}
            mode={mode}
          />
          {/*
            The same warning the meta strip carries, for the same reason and in
            the only other place the slug is editable. This editor covers the
            strip that would otherwise show it, so without this the one surface
            that hides the notice is also a surface that can rewrite a live
            address and save it.
          */}
          {slugName === undefined ? null : (
            <PublicUrlChangeNotice
              slugName={slugName}
              active
              className="mt-3 block"
            />
          )}
        </FormSection>
      )}
      {content.length === 0 ? null : (
        <FormSection label="Fields">
          <EntryFormContent
            fields={content}
            disabled={disabled}
            readOnly={readOnly}
            mode={mode}
          />
        </FormSection>
      )}
    </div>
  );
}

/** A field shown under another label in this view, its rules untouched. */
function relabelled(
  fields: FieldConfig[],
  name: string,
  label: string
): FieldConfig[] {
  return fields.map(field =>
    field.name === name ? { ...field, label } : field
  );
}

/**
 * The fields flat, for a dialog: the page's own group (its title, and its
 * slug read as the page's address, with the change warning), then the rest,
 * with no section cards or form headings. The group has a heading only while
 * both are drawn; drawn alone, the surface around it names it.
 */
function FlatEntryFields({
  page,
  content,
  disabled,
  readOnly,
  mode,
  slugName,
  address,
  alone = false,
}: Omit<EntryFieldsPanelProps, "presentation">): React.JSX.Element {
  return (
    <div className="space-y-6" onKeyDown={blockImplicitSubmit}>
      {page.length === 0 ? null : (
        <IdentityGroup
          page={page}
          disabled={disabled}
          readOnly={readOnly}
          mode={mode}
          slugName={slugName}
          address={address}
          alone={alone}
        />
      )}
      {content.length === 0 ? null : (
        <EntryFormContent
          fields={content}
          disabled={disabled}
          readOnly={readOnly}
          mode={mode}
        />
      )}
    </div>
  );
}

/**
 * The document's identity, flat: its title, and its slug as the page's
 * address. With the entry's address facts, the slug is drawn as its full
 * address (the chip the entry header draws); without them, as a field
 * labelled "Address", with the change warning where the address is live.
 */
function IdentityGroup({
  page,
  disabled,
  readOnly,
  mode,
  slugName,
  address,
  alone,
}: Omit<EntryFieldsPanelProps, "presentation" | "content">): React.JSX.Element {
  // The slug is the field named so, whether or not its address is live yet.
  const slugField = slugName ?? "slug";
  const slug = page.find(f => f.name === slugField);
  const chip = address !== undefined && slug !== undefined;
  return (
    <section
      {...(alone === true ? {} : { "aria-labelledby": "entry-fields-page" })}
      className="space-y-1"
    >
      {alone === true ? null : (
        <h3 id="entry-fields-page" className="text-sm font-semibold">
          Page
        </h3>
      )}
      <EntryFormContent
        fields={relabelled(
          chip ? page.filter(f => f !== slug) : page,
          slugField,
          "Address"
        )}
        disabled={disabled}
        readOnly={readOnly}
        mode={mode}
      />
      {chip ? (
        <AddressChipField
          slug={slug}
          facts={address}
          locked={addressLocked(slug, readOnly, disabled)}
          hasPublicAddress={slugName !== undefined}
        />
      ) : (
        <AddressNotice slugName={slugName} />
      )}
    </section>
  );
}

/**
 * Whether the address chip may not edit the slug: the form's one decision
 * about the field (`effectiveFieldGate`), from what the panel holds and the
 * slug's own read-only and disabled gates, as the field itself would be.
 * Its condition is judged before this, where the field is offered at all.
 */
function addressLocked(
  slug: FieldConfig,
  readOnly: boolean | undefined,
  disabled: boolean | undefined
): boolean {
  const gate = effectiveFieldGate(
    slug,
    { shown: true, readOnly: readOnly === true, disabled: disabled === true },
    undefined
  );
  return gate.readOnly || gate.disabled;
}

/** The change warning beside the slug drawn as a field, only where it is live. */
function AddressNotice({
  slugName,
}: {
  slugName: string | undefined;
}): React.JSX.Element | null {
  if (slugName === undefined) return null;
  return (
    <PublicUrlChangeNotice slugName={slugName} active className="mt-2 block" />
  );
}

/**
 * The slug as the entry's full address, labelled "Address": the site's
 * address and the entry's path in the header's chip, with its copy, its
 * in-place edit (Enter keeps, Escape puts back) and, where the address is
 * live, the warning that changing it retires the old one. Its details are
 * read here, while it is drawn, as the header reads them.
 */
function AddressChipField({
  slug,
  facts,
  locked,
  hasPublicAddress,
}: {
  slug: FieldConfig;
  facts: EntryAddressFacts;
  locked: boolean;
  hasPublicAddress: boolean;
}): React.JSX.Element {
  const details = useEntryDetails(facts.detailsOf);
  return (
    <div
      role="group"
      aria-labelledby="entry-fields-address"
      className="pt-3"
      // The slug's place, where a surface showing a field it refused finds it.
      data-field={"name" in slug ? slug.name : "slug"}
    >
      <p id="entry-fields-address" className="text-sm font-medium">
        Address
      </p>
      <DocumentAddressChip
        slug={{ field: slug, locked, hasPublicAddress }}
        address={details?.address}
        published={facts.published}
      />
    </div>
  );
}

/** The top-level fields left after `leaveOut`, by name. */
function withoutLeftOut<T extends { name?: string }>(
  fields: T[],
  leaveOut: readonly string[] | undefined
): T[] {
  if (leaveOut === undefined || leaveOut.length === 0) return fields;
  const out = new Set(leaveOut);
  return fields.filter(f => !out.has(f.name ?? ""));
}

/**
 * The panel for one asking field, or NULL when it would have nothing in it.
 *
 * The whole decision in one place, because it is one decision. A caller reads
 * the answer twice — once to decide whether to offer a region and once to fill
 * it — and those must not be able to disagree; returning an element that
 * happens to render nothing is what reserved width to display blankness. A
 * group asked for alone, or fields left out, decide it the same way: what is
 * left is what is counted.
 */
export function fieldsBesidePanel(
  allFields: FieldConfig[],
  excludePath: string,
  options: {
    disabled?: boolean;
    readOnly?: boolean;
    mode?: "create" | "edit";
    /**
     * The current values of every field a condition watches. Without them a
     * field whose condition is false is counted here and renders nothing,
     * which offers the panel and draws a heading over blank space.
     */
    values?: Record<string, unknown>;
    /** Whether the document has a public address the slug decides. */
    hasPublicAddress?: boolean;
    /** For the dialog, the slug drawn as the entry's full address. */
    address?: EntryAddressFacts;
  } & EntryFieldsOptions = {}
): React.ReactNode | null {
  const beside = computeFieldsBeside(allFields, excludePath, options.values);
  const group = options.group;
  const page =
    group === "content" ? [] : withoutLeftOut(beside.page, options.leaveOut);
  const content =
    group === "page" ? [] : withoutLeftOut(beside.content, options.leaveOut);
  if (page.length === 0 && content.length === 0) return null;
  // Warned about only where the slug is actually offered AND the document has
  // an address to break: a notice on a document nobody can reach is noise, and
  // one beside a field this panel is not showing points at nothing.
  const slug = page.find(f => f.name === "slug");
  return (
    <EntryFieldsPanel
      page={page}
      content={content}
      disabled={options.disabled}
      readOnly={options.readOnly}
      mode={options.mode}
      {...(options.presentation === undefined
        ? {}
        : { presentation: options.presentation })}
      // Drawn as the full address only where the identity is asked for on
      // its own: a surface drawing both groups keeps them as fields.
      address={group === "page" ? options.address : undefined}
      alone={group !== undefined}
      slugName={
        options.hasPublicAddress === true && slug !== undefined
          ? (slug.name ?? "slug")
          : undefined
      }
    />
  );
}
