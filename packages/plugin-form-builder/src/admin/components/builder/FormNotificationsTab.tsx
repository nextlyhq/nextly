"use client";

/**
 * Form Notifications Tab
 *
 * Per-form email notification rules: a list of cards, each editing in a
 * side sheet. A rule targets a static address or the visitor (via one of
 * the form's email fields), can set Reply-To from a field so replies reach
 * the visitor, and can carry a single send-condition evaluated against the
 * submitted data. An autoresponder is just a rule whose recipient is the
 * visitor — there is no separate feature.
 *
 * @module admin/components/builder/FormNotificationsTab
 */

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldShell,
  Grid,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import {
  Copy,
  Filter,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ConditionalLogicCondition } from "../../../types";
import {
  useFormBuilder,
  createNotification,
  type FormNotification,
} from "../../context/FormBuilderContext";

import {
  addressError,
  addressErrorsIn,
  isValidEmail,
  parseFieldRef,
  type AddressErrors,
  type AddressField,
} from "./notification-addresses";

// ============================================================================
// Types
// ============================================================================

/** Host-level notification defaults surfaced by the builder-config route. */
export interface NotificationDefaults {
  defaultFrom?: string;
  defaultToEmail?: string;
}

interface FormNotificationsTabProps {
  /** `null` while the builder-config request is still settling. */
  defaults: NotificationDefaults | null;
}

interface ProviderOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface TemplateOption {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  /** "template" or "layout" — layouts wrap templates and cannot be sent. */
  kind?: string;
}

interface FieldOption {
  name: string;
  label: string;
  type: string;
}

// ============================================================================
// API helpers
// ============================================================================

async function fetchProviders(): Promise<ProviderOption[]> {
  try {
    const res = await fetch("/admin/api/email-providers?pageSize=100&page=1", {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { providers?: ProviderOption[] };
    return json.providers ?? [];
  } catch {
    return [];
  }
}

async function fetchTemplates(): Promise<TemplateOption[]> {
  try {
    const res = await fetch("/admin/api/email-templates", {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { templates?: TemplateOption[] };
    return json.templates ?? [];
  } catch {
    return [];
  }
}

// ============================================================================
// Field-reference helpers
// ============================================================================

function toFieldRef(fieldName: string): string {
  return `{{${fieldName}}}`;
}

/**
 * Options for address dropdowns: the form's email fields, plus the
 * currently-referenced field even when it is not an email type, so a legacy
 * value keeps displaying instead of silently vanishing from the select.
 */
function buildEmailFieldOptions(
  fields: readonly FieldOption[],
  currentRef: string | null
): FieldOption[] {
  const emailFields = fields.filter(field => field.type === "email");
  if (currentRef && !emailFields.some(field => field.name === currentRef)) {
    const current = fields.find(field => field.name === currentRef);
    if (current) return [...emailFields, current];
  }
  return emailFields;
}

// ============================================================================
// Condition labels
// ============================================================================

const COMPARISON_LABELS: Record<
  ConditionalLogicCondition["comparison"],
  string
> = {
  equals: "Equals",
  notEquals: "Does not equal",
  contains: "Contains",
  isEmpty: "Is empty",
  isNotEmpty: "Is not empty",
  greaterThan: "Greater than",
  lessThan: "Less than",
};

const VALUELESS_COMPARISONS: ReadonlySet<
  ConditionalLogicCondition["comparison"]
> = new Set(["isEmpty", "isNotEmpty"]);

// ============================================================================
// Notification Card
// ============================================================================

interface NotificationCardProps {
  notification: FormNotification;
  providerName: string;
  fields: readonly FieldOption[];
  /** Whether this row's editor is showing. */
  expanded: boolean;
  /** The editor region's id, so the summary can point at what it opens. */
  editorId: string;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  /** The editor, rendered under the summary while `expanded`. */
  children: React.ReactNode;
}

function describeRecipient(
  notification: FormNotification,
  fields: readonly FieldOption[]
): { text: string; missing: boolean } {
  if (notification.recipientType === "field") {
    const ref = parseFieldRef(notification.to);
    if (!ref) return { text: "No recipient field selected", missing: true };
    const field = fields.find(f => f.name === ref);
    if (!field) {
      // The referenced field was deleted (allowed while the rule was
      // disabled) — say so instead of presenting the dead name as valid.
      return {
        text: `Recipient field "${ref}" no longer exists`,
        missing: true,
      };
    }
    return {
      text: `To the visitor (${field.label})`,
      missing: false,
    };
  }
  if (!notification.to.trim()) {
    return { text: "No recipient address", missing: true };
  }
  return { text: `To ${notification.to}`, missing: false };
}

function NotificationCard({
  notification,
  providerName,
  fields,
  expanded,
  editorId,
  onToggle,
  onDuplicate,
  onDelete,
  onToggleEnabled,
  children,
}: NotificationCardProps) {
  const recipient = describeRecipient(notification, fields);
  const ccCount =
    (notification.cc?.length ?? 0) + (notification.bcc?.length ?? 0);

  // Deleting a referenced field is only blocked for enabled rules, so a
  // disabled rule can legitimately hold references to fields that no longer
  // exist — surface that on the card instead of sending broken email later.
  const fieldNames = new Set(fields.map(f => f.name));
  const replyToRef = parseFieldRef(notification.replyTo);
  const hasStaleReference =
    (replyToRef !== null && !fieldNames.has(replyToRef)) ||
    (notification.condition !== undefined &&
      !fieldNames.has(notification.condition.field));

  const warnings: string[] = [];
  if (!notification.templateSlug) {
    warnings.push("No template — will not send");
  }
  if (hasStaleReference) {
    warnings.push("References a deleted field — edit to repair");
  }

  return (
    <div className="border border-border bg-background">
      {/* The dimming is the SUMMARY's, not the card's. A disabled rule reads as
          inactive at a glance, but an expanded editor inside a faded card fades
          every label, input and validation message the author is reading while
          they fix it — and takes the already-muted help text below its intended
          contrast. */}
      <div
        className={`flex items-center gap-2 px-3 py-2.5 ${notification.enabled ? "" : "opacity-60"}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/5 text-primary">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={editorId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-none py-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          // The NAME stays put while the state changes. `aria-expanded` above
          // already says open or closed, and a control whose name moves with
          // its state is one a screen-reader user cannot refer to twice — and
          // one no test can hold a handle on across a click.
          aria-label={`Edit notification ${notification.name}`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {notification.name}
              </span>
              {notification.condition && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 rounded-none border-border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  <Filter className="h-2.5 w-2.5" aria-hidden="true" />
                  Conditional
                </Badge>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              <span className={recipient.missing ? "text-destructive" : ""}>
                {recipient.text}
              </span>
              {ccCount > 0 && (
                <span>
                  <span className="mx-1.5 text-muted-foreground">·</span>+
                  {ccCount} cc/bcc
                </span>
              )}
              <span className="mx-1.5 text-muted-foreground">·</span>
              {providerName}
            </span>
          </span>
          {warnings.length > 0 && (
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {warnings.map(warning => (
                <span
                  key={warning}
                  className="flex items-center gap-1 text-xs font-medium text-destructive"
                >
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  {warning}
                </span>
              ))}
            </span>
          )}
        </button>

        <Switch
          checked={notification.enabled}
          onCheckedChange={onToggleEnabled}
          aria-label={`${notification.enabled ? "Disable" : "Enable"} notification ${notification.name}`}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-none text-muted-foreground hover:text-foreground"
              aria-label={`Notification actions for ${notification.name}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 shadow-none border-border"
          >
            <DropdownMenuItem
              onClick={onToggle}
              className="gap-2 cursor-pointer"
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
              {expanded ? "Collapse" : "Edit"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDuplicate}
              className="gap-2 cursor-pointer"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Unmounted while collapsed rather than hidden. The editor holds a
          draft of the rule in its own state, seeded from the row; keeping a
          closed one mounted would keep a stale draft alive behind a summary
          that has moved on. */}
      {expanded && children}
    </div>
  );
}

// ============================================================================
// Recipient chip list (cc / bcc)
// ============================================================================

interface AddressChipListProps {
  id: string;
  label: string;
  addresses: string[];
  placeholder: string;
  onChange: (addresses: string[]) => void;
}

function AddressChipList({
  id,
  label,
  addresses,
  placeholder,
  onChange,
}: AddressChipListProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(() => {
    const email = draft.trim();
    if (!email) return;
    // Nothing here goes through form submission, so constraint validation
    // never runs — reject malformed addresses before they can be persisted
    // and fail at delivery.
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    onChange([...addresses, email]);
    setDraft("");
    setError(null);
  }, [draft, addresses, onChange]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {addresses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {addresses.map((email, index) => (
            <Badge
              key={`${email}-${index}`}
              variant="outline"
              className="gap-1.5 rounded-none border-border bg-primary/5 px-2 py-0.5 text-xs font-medium"
            >
              <span>{email}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                onClick={() =>
                  onChange(addresses.filter((_, i) => i !== index))
                }
                aria-label={`Remove ${email}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="email"
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button
          type="button"
          variant="outline"
          onClick={add}
          className="shrink-0 px-3"
        >
          Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface RecipientFieldsProps {
  form: FormNotification;
  fields: readonly FieldOption[];
  defaults: NotificationDefaults | null;
  update: <K extends keyof FormNotification>(
    key: K,
    value: FormNotification[K]
  ) => void;
  /**
   * Switching target kinds invalidates the previous `to` value shape, so both
   * keys move together. It goes back to the editor rather than being done here
   * because the editor owns the write-through to the form.
   */
  onRecipientTypeChange: (kind: "static" | "field") => void;
  addressErrors: AddressErrors;
  validateAddress: (key: AddressField, value: string | undefined) => void;
  replyToMode: ReplyToMode;
  setReplyToMode: (mode: ReplyToMode) => void;
}

/**
 * Who the notification goes to: the recipient itself, the reply-to, and the
 * optional cc/bcc lists.
 *
 * Extracted from the editor because it is the one part of a notification that
 * is entirely about addresses — the editor around it is about identity,
 * sending and conditions — and because leaving it inline made a single
 * component long enough that no reader could hold it at once.
 */
function RecipientFields({
  form,
  fields,
  defaults,
  update,
  onRecipientTypeChange,
  addressErrors,
  validateAddress,
  replyToMode,
  setReplyToMode,
}: RecipientFieldsProps) {
  // Derived here rather than passed in: each of these is a function of `form`
  // and `fields`, which this component already has, and computing them in the
  // caller would be the same answer worked out somewhere else.
  const toRef = parseFieldRef(form.to);
  const toFieldOptions = buildEmailFieldOptions(fields, toRef);
  const replyToRef = parseFieldRef(form.replyTo);
  const replyToFieldOptions = buildEmailFieldOptions(fields, replyToRef);

  return (
    <>
      <div className="space-y-4 pt-4 border-t border-border">
        <Grid cols={2} responsive>
          <FieldShell label="Send to" htmlFor="notification-recipient-type">
            {({ id, describedBy, invalid }) => (
              <Select
                value={form.recipientType}
                onValueChange={value => {
                  // Switching target kinds invalidates the previous `to`
                  // value shape, so it resets rather than leaking a
                  // {{ref}} into the static input (or vice versa).
                  onRecipientTypeChange(value as "static" | "field");
                }}
              >
                <SelectTrigger
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className="w-full bg-transparent border-input dark:bg-muted/50"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">A specific address</SelectItem>
                  <SelectItem value="field">
                    The visitor (email field)
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </FieldShell>

          {form.recipientType === "field" ? (
            <div className="space-y-1.5">
              <FieldShell label="Visitor email field" htmlFor="notification-to">
                {({ id, describedBy, invalid }) => (
                  <Select
                    value={toRef ?? "__none"}
                    onValueChange={value =>
                      update("to", value === "__none" ? "" : toFieldRef(value))
                    }
                  >
                    <SelectTrigger
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      className="w-full bg-transparent border-input dark:bg-muted/50"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Select a field</SelectItem>
                      {toFieldOptions.map(f => (
                        <SelectItem key={f.name} value={f.name}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
              {toFieldOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add an email field to the form first.
                </p>
              )}
            </div>
          ) : (
            <FieldShell
              label="Recipient address"
              htmlFor="notification-to"
              width="half"
              error={addressErrors.to}
            >
              <Input
                type="email"
                value={form.to}
                onChange={e => update("to", e.target.value)}
                onBlur={e => validateAddress("to", e.target.value)}
                placeholder={defaults?.defaultToEmail || "admin@example.com"}
              />
            </FieldShell>
          )}
        </Grid>

        {/* Reply-To */}
        <Grid cols={2} responsive>
          <FieldShell label="Reply-To" htmlFor="notification-replyto-mode">
            {({ id, describedBy, invalid }) => (
              <Select
                value={replyToMode}
                onValueChange={value => {
                  const mode = value as ReplyToMode;
                  setReplyToMode(mode);
                  // A mode change always clears the stored value (the old
                  // shape can't be represented in the new mode); it stays
                  // absent — not an empty string — until the user picks a
                  // field or types an address.
                  update("replyTo", undefined);
                }}
              >
                <SelectTrigger
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className="w-full bg-transparent border-input dark:bg-muted/50"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="field">
                    The visitor (email field)
                  </SelectItem>
                  <SelectItem value="custom">A custom address</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FieldShell>

          {replyToMode === "field" && (
            <FieldShell
              label="Visitor email field"
              htmlFor="notification-replyto"
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  value={replyToRef ?? "__none"}
                  onValueChange={value =>
                    update(
                      "replyTo",
                      value === "__none" ? undefined : toFieldRef(value)
                    )
                  }
                >
                  <SelectTrigger
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="w-full bg-transparent border-input dark:bg-muted/50"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Select a field</SelectItem>
                    {replyToFieldOptions.map(f => (
                      <SelectItem key={f.name} value={f.name}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldShell>
          )}
          {replyToMode === "custom" && (
            <FieldShell
              label="Reply-To address"
              htmlFor="notification-replyto"
              width="half"
              error={addressErrors.replyTo}
            >
              <Input
                type="email"
                value={form.replyTo ?? ""}
                onBlur={e => validateAddress("replyTo", e.target.value)}
                onChange={e => update("replyTo", e.target.value || undefined)}
                placeholder="replies@example.com"
              />
            </FieldShell>
          )}
        </Grid>
        {replyToMode === "field" && (
          <p className="text-xs text-muted-foreground -mt-2">
            Replying to this email answers the person who submitted the form.
          </p>
        )}

        <AddressChipList
          id="notification-cc"
          label="CC (optional)"
          addresses={form.cc}
          placeholder="cc@example.com"
          onChange={cc => update("cc", cc)}
        />
        <AddressChipList
          id="notification-bcc"
          label="BCC (optional)"
          addresses={form.bcc}
          placeholder="bcc@example.com"
          onChange={bcc => update("bcc", bcc)}
        />
      </div>
    </>
  );
}

interface SendConditionFieldProps {
  condition: ConditionalLogicCondition | undefined;
  fields: readonly FieldOption[];
  update: <K extends keyof FormNotification>(
    key: K,
    value: FormNotification[K]
  ) => void;
}

/**
 * The optional rule that decides whether a notification sends at all.
 *
 * Its own component because it is the one part of the editor with a shape of
 * its own — absent, or a field/comparison/value triple — and inline it made
 * the editor read as two unrelated forms sharing a scope.
 */
function SendConditionField({
  condition,
  fields,
  update,
}: SendConditionFieldProps) {
  return (
    <>
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Send condition
            </p>
            <p className="text-xs text-muted-foreground">
              Only send this notification when a submitted value matches.
            </p>
          </div>
          {!condition && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update("condition", {
                  field: fields[0]?.name ?? "",
                  comparison: "equals",
                  value: "",
                })
              }
              disabled={fields.length === 0}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add condition
            </Button>
          )}
        </div>

        {condition && (
          <div className="flex flex-wrap items-end gap-2 border border-border bg-muted/40 p-3">
            <FieldShell
              label="Field"
              htmlFor="notification-condition-field"
              className="min-w-36 flex-1"
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  value={condition.field || "__none"}
                  onValueChange={value =>
                    update("condition", {
                      ...condition,
                      field: value === "__none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="w-full bg-transparent border-input dark:bg-muted/50"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Select a field</SelectItem>
                    {fields.map(f => (
                      <SelectItem key={f.name} value={f.name}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldShell>

            <FieldShell
              label="Comparison"
              htmlFor="notification-condition-comparison"
              className="min-w-36 flex-1"
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  value={condition.comparison}
                  onValueChange={value =>
                    update("condition", {
                      ...condition,
                      comparison:
                        value as ConditionalLogicCondition["comparison"],
                    })
                  }
                >
                  <SelectTrigger
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="w-full bg-transparent border-input dark:bg-muted/50"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMPARISON_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldShell>

            {!VALUELESS_COMPARISONS.has(condition.comparison) && (
              <FieldShell
                label="Value"
                htmlFor="notification-condition-value"
                className="min-w-36 flex-1"
              >
                <Input
                  type="text"
                  value={
                    typeof condition.value === "string" ||
                    typeof condition.value === "number"
                      ? String(condition.value)
                      : ""
                  }
                  onChange={e =>
                    update("condition", {
                      ...condition,
                      value: e.target.value,
                    })
                  }
                />
              </FieldShell>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none text-muted-foreground hover:text-destructive"
              onClick={() => update("condition", undefined)}
              aria-label="Remove send condition"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

interface NotificationIdentityFieldsProps {
  form: FormNotification;
  providers: ProviderOption[];
  defaults: NotificationDefaults | null;
  templates: TemplateOption[];
  update: <K extends keyof FormNotification>(
    key: K,
    value: FormNotification[K]
  ) => void;
  addressErrors: AddressErrors;
  validateAddress: (key: AddressField, value: string | undefined) => void;
}

/**
 * What the notification IS: its name, which provider and template carry it,
 * and who it comes from.
 *
 * Separated from the recipients and the condition because those answer
 * different questions — where it goes, and whether it goes at all — and one
 * component answering all three was long enough that no reader could hold it.
 */
function NotificationIdentityFields({
  form,
  providers,
  defaults,
  templates,
  update,
  addressErrors,
  validateAddress,
}: NotificationIdentityFieldsProps) {
  // Derived here, from props this component already holds. Passing them in
  // would be the same answer worked out in the caller.
  const defaultProvider = providers.find(p => p.isDefault);
  const defaultProviderLabel = defaultProvider
    ? `System default (${defaultProvider.name})`
    : "System default";
  const senderPlaceholder = defaults?.defaultFrom || "Provider default";
  const senderHelp = defaults?.defaultFrom
    ? `Leave blank to send from ${defaults.defaultFrom} (the configured default).`
    : "Leave blank to use the template or provider default address.";

  return (
    <>
      {/* Name */}
      <FieldShell label="Name" htmlFor="notification-name" width="half">
        <Input
          type="text"
          value={form.name}
          onChange={e => update("name", e.target.value)}
          placeholder="e.g. Admin notification"
        />
      </FieldShell>

      {/* Provider & Template. A container-query grid rather than the
            viewport's `sm:` breakpoint: the admin content region is
            narrower than the window whenever both sidebars are open, so a
            viewport breakpoint promises columns this sheet does not have. */}
      <Grid cols={2} responsive>
        {/* Both `Select`-driven: FieldShell's render-function `children`
              applies the computed id/aria-describedby/aria-invalid to
              SelectTrigger, the actual focusable element, rather than to
              `Select`'s root (which accepts a fixed prop list and forwards
              none of the rest). */}
        <FieldShell label="Email provider" htmlFor="notification-provider">
          {({ id, describedBy, invalid }) => (
            <Select
              value={form.providerId ?? "__default"}
              onValueChange={value =>
                update("providerId", value === "__default" ? undefined : value)
              }
            >
              <SelectTrigger
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="w-full bg-transparent border-input dark:bg-muted/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">
                  {defaultProviderLabel}
                </SelectItem>
                {providers.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldShell>

        <div className="space-y-1.5">
          <FieldShell label="Email template" htmlFor="notification-template">
            {({ id, describedBy, invalid }) => (
              <Select
                value={form.templateSlug ?? "__none"}
                onValueChange={value =>
                  update("templateSlug", value === "__none" ? undefined : value)
                }
              >
                <SelectTrigger
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className="w-full bg-transparent border-input dark:bg-muted/50"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Select a template</SelectItem>
                  {templates
                    .filter(t => t.isActive && t.kind !== "layout")
                    .map(t => (
                      <SelectItem key={t.id} value={t.slug}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </FieldShell>
          {!form.templateSlug && (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              Required — a notification without a template is never sent.
            </p>
          )}
        </div>
      </Grid>

      {/* Sender */}
      <FieldShell
        label="Sender email"
        htmlFor="notification-sender"
        width="half"
        description={addressErrors.senderEmail ? undefined : senderHelp}
        error={addressErrors.senderEmail}
      >
        <Input
          type="email"
          value={form.senderEmail ?? ""}
          onChange={e => update("senderEmail", e.target.value || undefined)}
          onBlur={e => validateAddress("senderEmail", e.target.value)}
          placeholder={senderPlaceholder}
        />
      </FieldShell>
    </>
  );
}

// ============================================================================
// Notification editor
// ============================================================================

type ReplyToMode = "none" | "field" | "custom";

interface NotificationEditorProps {
  /**
   * The rule as the form holds it. Read on every render rather than copied
   * into local state: the summary row edits the same rule (its Enabled switch
   * writes straight to the form), and a second copy here would go stale the
   * moment it did — the next edit would then send the whole stale rule back
   * and undo it.
   */
  notification: FormNotification;
  /** Ties the row's toggle to this region for assistive tech. */
  editorId: string;
  providers: ProviderOption[];
  templates: TemplateOption[];
  fields: readonly FieldOption[];
  defaults: NotificationDefaults | null;
  /**
   * Every edit, as it happens. There is no save button here on purpose: the
   * page's own action bar commits the form, and a second one beside it could
   * only mean the same thing said twice or two different things unlabelled.
   */
  onChange: (notification: FormNotification) => void;
}

function initialReplyToMode(replyTo: string | undefined): ReplyToMode {
  if (!replyTo) return "none";
  return parseFieldRef(replyTo) ? "field" : "custom";
}

function NotificationEditor({
  notification,
  editorId,
  providers,
  templates,
  fields,
  defaults,
  onChange,
}: NotificationEditorProps) {
  const form = notification;
  const [replyToMode, setReplyToMode] = useState<ReplyToMode>(
    initialReplyToMode(notification.replyTo)
  );
  // Save-time address errors, keyed by field. Nothing here goes through
  // form submission (every control is a type="button" callback), so
  // constraint validation never runs — this is its replacement.
  // Seeded from the rule as it stands, so a row opened onto an address saved
  // earlier shows the problem straight away rather than waiting to be touched.
  const [addressErrors, setAddressErrors] = useState<AddressErrors>(() =>
    addressErrorsIn(notification)
  );

  const update = useCallback(
    <K extends keyof FormNotification>(key: K, value: FormNotification[K]) => {
      onChange({ ...notification, [key]: value });
      setAddressErrors(prev =>
        key in prev ? { ...prev, [key]: undefined } : prev
      );
    },
    [notification, onChange]
  );

  const changeRecipientType = useCallback(
    (kind: "static" | "field") => {
      onChange({ ...notification, recipientType: kind, to: "" });
    },
    [notification, onChange]
  );

  /**
   * Address validity, checked when the field is LEFT rather than on a save
   * press.
   *
   * Nothing here goes through form submission — every control is a
   * `type="button"` callback — so constraint validation never runs and this is
   * its replacement. Blur rather than change, because an address is invalid
   * for most of the time it is being typed.
   */
  const validateAddress = useCallback(
    (key: AddressField, value: string | undefined) => {
      setAddressErrors(prev => ({ ...prev, [key]: addressError(key, value) }));
    },
    []
  );

  const condition = form.condition;

  return (
    <div id={editorId} className="border-t border-border bg-muted/20 px-4 py-5">
      <div className="space-y-6">
        <NotificationIdentityFields
          form={form}
          providers={providers}
          defaults={defaults}
          templates={templates}
          update={update}
          addressErrors={addressErrors}
          validateAddress={validateAddress}
        />
        {/* Recipients */}
        <RecipientFields
          form={form}
          fields={fields}
          defaults={defaults}
          update={update}
          onRecipientTypeChange={changeRecipientType}
          addressErrors={addressErrors}
          validateAddress={validateAddress}
          replyToMode={replyToMode}
          setReplyToMode={setReplyToMode}
        />
        {/* Send condition */}
        <SendConditionField
          condition={condition}
          fields={fields}
          update={update}
        />
        {/* Enabled */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div>
            <Label htmlFor="notification-enabled">Enabled</Label>
            <p className="text-xs text-muted-foreground">
              Turn off to keep the rule without sending.
            </p>
          </div>
          <Switch
            id="notification-enabled"
            checked={form.enabled}
            onCheckedChange={checked => update("enabled", checked)}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FormNotificationsTab - the form's notification rules.
 *
 * Each rule references an existing email provider and template rather than
 * duplicating provider credentials or embedding a second template editor.
 */
export function FormNotificationsTab({ defaults }: FormNotificationsTabProps) {
  const {
    notifications,
    fields,
    addNotification,
    duplicateNotification,
    updateNotification,
    deleteNotification,
  } = useFormBuilder();

  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  // Which row is open. One at a time: several open at once turns the list
  // into a wall of fields and loses the overview the summaries exist to give.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchProviders().then(setProviders);
    void fetchTemplates().then(setTemplates);
  }, []);

  const fieldList = useMemo<FieldOption[]>(
    () => fields.map(f => ({ name: f.name, label: f.label, type: f.type })),
    [fields]
  );

  /**
   * A new rule is added immediately and opened, rather than composed in a
   * draft and committed on a button.
   *
   * That is the trade the inline editor makes: there is no save press to
   * attach a creation to, so the row exists from the moment it is asked for.
   * An unwanted one is removed the same way any other is, and an incomplete
   * one is inert — a notification without a template never sends, which the
   * row says on its face.
   */
  const addAndOpen = useCallback(() => {
    const created = createNotification();
    addNotification(created);
    setExpandedId(created.id);
  }, [addNotification]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId(current => (current === id ? null : id));
  }, []);

  const getProviderName = useCallback(
    (providerId?: string) => {
      if (!providerId) {
        const def = providers.find(p => p.isDefault);
        return def ? `${def.name} (default)` : "System default";
      }
      return providers.find(p => p.id === providerId)?.name ?? "Unknown";
    },
    [providers]
  );

  return (
    // The measure belongs to the page's shell, not to this tab.
    <div>
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            Notifications
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Emails sent when someone submits this form.
          </p>
        </div>
        <Button type="button" onClick={addAndOpen}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add notification
        </Button>
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 mt-6 border-2 border-dashed border-border rounded-none bg-muted">
          <div className="flex items-center justify-center w-12 h-12 rounded-none border border-border bg-background mb-4 text-primary">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-base font-medium text-foreground mb-1">
            No notifications yet
          </p>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
            Add a notification to email someone when this form is submitted.
          </p>
          <Button type="button" onClick={addAndOpen}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add notification
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notification => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              providerName={getProviderName(notification.providerId)}
              fields={fieldList}
              expanded={expandedId === notification.id}
              editorId={`notification-editor-${notification.id}`}
              onToggle={() => toggleExpanded(notification.id)}
              onDuplicate={() => duplicateNotification(notification.id)}
              onDelete={() => deleteNotification(notification.id)}
              onToggleEnabled={enabled =>
                updateNotification(notification.id, { enabled })
              }
            >
              <NotificationEditor
                notification={notification}
                editorId={`notification-editor-${notification.id}`}
                providers={providers}
                templates={templates}
                fields={fieldList}
                defaults={defaults}
                onChange={next => updateNotification(notification.id, next)}
              />
            </NotificationCard>
          ))}
        </div>
      )}
    </div>
  );
}

export default FormNotificationsTab;
