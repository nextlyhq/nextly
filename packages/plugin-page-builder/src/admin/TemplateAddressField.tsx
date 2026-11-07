"use client";

/**
 * The template form's address control: where the template's collection's
 * entries are served, editable only by someone allowed to manage template
 * routing.
 *
 * The admin draws the field's label, description and error around this
 * control, as it does around every plugin field editor. What this adds is the
 * routing question: the address moves every entry's live address, so it is
 * offered for editing only once the server has said the caller holds
 * `manage-template-routing`, and is shown read-only otherwise, with why. It
 * decides nothing: the field's own rules take an address out of anyone
 * else's save, and the template action asks the same permission first.
 *
 * Read-only while the answer is in flight, the opposite of the pattern verbs'
 * optimistic gate, because what it gates is different: an input that turns
 * read-only under the author's cursor would discard what they typed, while a
 * moment's wait before it becomes editable costs nothing.
 *
 * @module admin/TemplateAddressField
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { Input } from "@nextlyhq/ui";
import { Lock } from "lucide-react";
import { useId, type JSX } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

// The CONTRACT, not the route: the route reaches server-only modules.
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  TEMPLATE_ROUTING_ROUTE_PATH,
  type TemplateRoutingAccess,
} from "../templates/template-actions-contract";

export interface TemplateAddressFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads and writes. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
  /** The field's declaration, as the admin passes it to a plugin field editor. */
  field?: { label?: unknown; admin?: { placeholder?: unknown } };
  /** The document is being read, not edited. */
  readOnly?: boolean;
  /** The field is unavailable: no permission, or a form mid-submit. */
  disabled?: boolean;
}

/** Where the routing answer stands. */
export type RoutingAnswer =
  | { readonly state: "pending" }
  | { readonly state: "failed" }
  | { readonly state: "answered"; readonly mayManageRouting: boolean };

/** What the control draws: whether it may be edited, and the line under it. */
export interface AddressFieldView {
  readonly editable: boolean;
  /** Why it cannot be edited, or null where it can. */
  readonly note: string | null;
  /** Whether the note is the read-only lock rather than a passing state. */
  readonly locked: boolean;
}

/**
 * The control's state from the form's flags and the routing answer. Its own
 * function so the rule is pinned apart from the render: an address offered
 * for editing to someone without the permission would look saved and be
 * silently dropped by the field's rules.
 */
export function addressFieldView(
  flags: { readonly readOnly?: boolean; readonly disabled?: boolean },
  answer: RoutingAnswer
): AddressFieldView {
  // A version being read, or a form mid-submit, says nothing about routing.
  if (flags.readOnly === true || flags.disabled === true) {
    return { editable: false, note: null, locked: false };
  }
  switch (answer.state) {
    // Read-only and unexplained for the moment the answer takes: a note
    // drawn and then taken away would move everything below it for the
    // authors who may edit, who are the ones this form is for.
    case "pending":
      return { editable: false, note: null, locked: false };
    case "failed":
      return {
        editable: false,
        note: "Couldn't check whether you can change this address. Reload the page to try again.",
        locked: false,
      };
    case "answered":
      return answer.mayManageRouting
        ? { editable: true, note: null, locked: false }
        : {
            editable: false,
            note: "Only someone allowed to manage template routing can set or change this address.",
            locked: true,
          };
  }
}

/** The routing question, asked once per form. */
function useRoutingAnswer(): RoutingAnswer {
  const read = usePluginRoute<TemplateRoutingAccess>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATE_ROUTING_ROUTE_PATH,
    // Fresh on every mount: a role change lands through screens that know
    // nothing about this route.
    staleTime: 0,
  });
  return routingAnswerOf(read);
}

/**
 * The routing answer from the read: only a FRESH one. A read refreshing on
 * mount keeps the cached answer while it runs, and after it fails, so a
 * permission taken away since would otherwise keep the address editable
 * until the refresh came back, or for good if it never did.
 */
export function routingAnswerOf(read: {
  readonly data: TemplateRoutingAccess | null | undefined;
  readonly error: Error | null;
  readonly fetching: boolean;
}): RoutingAnswer {
  if (read.error !== null) return { state: "failed" };
  if (read.fetching || read.data === undefined || read.data === null) {
    return { state: "pending" };
  }
  return {
    state: "answered",
    mayManageRouting: read.data.mayManageRouting === true,
  };
}

/** The field's label and placeholder, as its declaration gives them. */
function declaredText(declaration: TemplateAddressFieldProps["field"]): {
  label: string;
  placeholder: string | undefined;
} {
  const placeholder = declaration?.admin?.placeholder;
  return {
    label:
      typeof declaration?.label === "string" ? declaration.label : "Address",
    placeholder: typeof placeholder === "string" ? placeholder : undefined,
  };
}

/**
 * What the input shows when empty: the example where it may be typed in,
 * that there is none where it may not.
 */
function emptyText(
  editable: boolean,
  value: string,
  placeholder: string | undefined
): string | undefined {
  if (editable) return placeholder;
  return value === "" ? "No address set" : undefined;
}

export function TemplateAddressField<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  control,
  field: declaration,
  readOnly = false,
  disabled = false,
}: TemplateAddressFieldProps<TFieldValues>): JSX.Element {
  const { field, fieldState } = useController({ name, control });
  const answer = useRoutingAnswer();
  const view = addressFieldView({ readOnly, disabled }, answer);
  const answerPending = answer.state === "pending";
  const noteId = useId();
  const { label, placeholder } = declaredText(declaration);
  const value = typeof field.value === "string" ? field.value : "";
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        ref={field.ref}
        type="text"
        // The wrapper's label is not tied to a plugin editor's control, so
        // the input carries its own name.
        aria-label={label}
        aria-describedby={view.note === null ? undefined : noteId}
        aria-invalid={fieldState.invalid || undefined}
        aria-busy={answerPending || undefined}
        value={value}
        onChange={event => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        readOnly={!view.editable}
        disabled={disabled}
        placeholder={emptyText(view.editable, value, placeholder)}
        spellCheck={false}
        autoComplete="off"
        // A value nobody here may change reads as settled, not as an
        // input waiting for text.
        className={
          view.editable
            ? "font-mono"
            : "bg-muted/40 font-mono text-muted-foreground"
        }
      />
      {/* Only when there is something to say, so the field's description
          sits under the input as every other field's does. */}
      {view.note === null ? null : (
        <p
          id={noteId}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {view.locked ? (
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          <span>{view.note}</span>
        </p>
      )}
    </div>
  );
}
