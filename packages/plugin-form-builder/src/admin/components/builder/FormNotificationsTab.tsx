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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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

/** The `{{fieldName}}` shape the send path resolves against submissions. */
const FIELD_REF_PATTERN = /^\{\{(\w+)\}\}$/;

function toFieldRef(fieldName: string): string {
  return `{{${fieldName}}}`;
}

function parseFieldRef(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(FIELD_REF_PATTERN);
  return match ? match[1] : null;
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

/**
 * Deliberately loose email shape check (something@something.tld): the goal
 * is catching typos before they fail at delivery, not RFC 5322 conformance.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
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
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
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
  onEdit,
  onDuplicate,
  onDelete,
  onToggleEnabled,
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
    <div
      className={`border border-border bg-background ${notification.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/5 text-primary">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        </span>

        <button
          type="button"
          onClick={onEdit}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-none py-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
            <DropdownMenuItem onClick={onEdit} className="gap-2 cursor-pointer">
              <Pencil className="h-4 w-4 text-muted-foreground" />
              Edit
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

// ============================================================================
// Notification Sheet
// ============================================================================

type ReplyToMode = "none" | "field" | "custom";

interface NotificationSheetProps {
  initial: FormNotification;
  isEditing: boolean;
  providers: ProviderOption[];
  templates: TemplateOption[];
  fields: readonly FieldOption[];
  defaults: NotificationDefaults | null;
  onSave: (notification: FormNotification) => void;
  onClose: () => void;
}

function initialReplyToMode(replyTo: string | undefined): ReplyToMode {
  if (!replyTo) return "none";
  return parseFieldRef(replyTo) ? "field" : "custom";
}

function NotificationSheet({
  initial,
  isEditing,
  providers,
  templates,
  fields,
  defaults,
  onSave,
  onClose,
}: NotificationSheetProps) {
  const [form, setForm] = useState<FormNotification>(initial);
  const [replyToMode, setReplyToMode] = useState<ReplyToMode>(
    initialReplyToMode(initial.replyTo)
  );
  // Save-time address errors, keyed by field. Nothing here goes through
  // form submission (every control is a type="button" callback), so
  // constraint validation never runs — this is its replacement.
  const [addressErrors, setAddressErrors] = useState<
    Partial<Record<"senderEmail" | "to" | "replyTo", string>>
  >({});

  const update = useCallback(
    <K extends keyof FormNotification>(key: K, value: FormNotification[K]) => {
      setForm(prev => ({ ...prev, [key]: value }));
      setAddressErrors(prev =>
        key in prev ? { ...prev, [key]: undefined } : prev
      );
    },
    []
  );

  const handleSave = useCallback(() => {
    const errors: typeof addressErrors = {};
    const invalid = (value: string | undefined) =>
      Boolean(value?.trim()) && !isValidEmail(value as string);
    if (invalid(form.senderEmail)) {
      errors.senderEmail = "Enter a valid email address.";
    }
    if (form.recipientType === "static" && invalid(form.to)) {
      errors.to = "Enter a valid email address.";
    }
    // Only literal reply-to addresses are validated; {{field}} references
    // resolve against each submission at send time.
    if (!parseFieldRef(form.replyTo) && invalid(form.replyTo)) {
      errors.replyTo = "Enter a valid email address.";
    }
    if (Object.values(errors).some(Boolean)) {
      setAddressErrors(errors);
      return;
    }
    onSave(form);
  }, [form, onSave]);

  const defaultProvider = providers.find(p => p.isDefault);
  const defaultProviderLabel = defaultProvider
    ? `System default (${defaultProvider.name})`
    : "System default";

  const toRef = parseFieldRef(form.to);
  const toFieldOptions = buildEmailFieldOptions(
    fields,
    form.recipientType === "field" ? toRef : null
  );
  const replyToRef = parseFieldRef(form.replyTo);
  const replyToFieldOptions = buildEmailFieldOptions(fields, replyToRef);

  const senderPlaceholder = defaults?.defaultFrom || "Provider default";
  const senderHelp = defaults?.defaultFrom
    ? `Leave blank to send from ${defaults.defaultFrom} (the configured default).`
    : "Leave blank to use the template or provider default address.";

  const condition = form.condition;

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle>
            {isEditing ? "Edit notification" : "New notification"}
          </SheetTitle>
          <SheetDescription>
            Sent when someone submits this form.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="notification-name">Name</Label>
            <Input
              id="notification-name"
              type="text"
              value={form.name}
              onChange={e => update("name", e.target.value)}
              placeholder="e.g. Admin notification"
            />
          </div>

          {/* Provider & Template */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="notification-provider">Email provider</Label>
              <Select
                value={form.providerId ?? "__default"}
                onValueChange={value =>
                  update(
                    "providerId",
                    value === "__default" ? undefined : value
                  )
                }
              >
                <SelectTrigger
                  id="notification-provider"
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notification-template">Email template</Label>
              <Select
                value={form.templateSlug ?? "__none"}
                onValueChange={value =>
                  update("templateSlug", value === "__none" ? undefined : value)
                }
              >
                <SelectTrigger
                  id="notification-template"
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
              {!form.templateSlug && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  Required — a notification without a template is never sent.
                </p>
              )}
            </div>
          </div>

          {/* Sender */}
          <div className="space-y-1.5">
            <Label htmlFor="notification-sender">Sender email</Label>
            <Input
              id="notification-sender"
              type="email"
              value={form.senderEmail ?? ""}
              onChange={e => update("senderEmail", e.target.value || undefined)}
              placeholder={senderPlaceholder}
              aria-invalid={addressErrors.senderEmail ? true : undefined}
            />
            {addressErrors.senderEmail ? (
              <p className="text-xs text-destructive">
                {addressErrors.senderEmail}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{senderHelp}</p>
            )}
          </div>

          {/* Recipients */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="notification-recipient-type">Send to</Label>
                <Select
                  value={form.recipientType}
                  onValueChange={value => {
                    // Switching target kinds invalidates the previous `to`
                    // value shape, so it resets rather than leaking a
                    // {{ref}} into the static input (or vice versa).
                    setForm(prev => ({
                      ...prev,
                      recipientType: value as "static" | "field",
                      to: "",
                    }));
                  }}
                >
                  <SelectTrigger
                    id="notification-recipient-type"
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
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notification-to">
                  {form.recipientType === "field"
                    ? "Visitor email field"
                    : "Recipient address"}
                </Label>
                {form.recipientType === "field" ? (
                  <Select
                    value={toRef ?? "__none"}
                    onValueChange={value =>
                      update("to", value === "__none" ? "" : toFieldRef(value))
                    }
                  >
                    <SelectTrigger
                      id="notification-to"
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
                ) : (
                  <Input
                    id="notification-to"
                    type="email"
                    value={form.to}
                    onChange={e => update("to", e.target.value)}
                    placeholder={
                      defaults?.defaultToEmail || "admin@example.com"
                    }
                    aria-invalid={addressErrors.to ? true : undefined}
                  />
                )}
                {addressErrors.to && (
                  <p className="text-xs text-destructive">{addressErrors.to}</p>
                )}
                {form.recipientType === "field" &&
                  toFieldOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Add an email field to the form first.
                    </p>
                  )}
              </div>
            </div>

            {/* Reply-To */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="notification-replyto-mode">Reply-To</Label>
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
                    id="notification-replyto-mode"
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
              </div>

              {replyToMode === "field" && (
                <div className="space-y-1.5">
                  <Label htmlFor="notification-replyto">
                    Visitor email field
                  </Label>
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
                      id="notification-replyto"
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
                </div>
              )}
              {replyToMode === "custom" && (
                <div className="space-y-1.5">
                  <Label htmlFor="notification-replyto">Reply-To address</Label>
                  <Input
                    id="notification-replyto"
                    type="email"
                    value={form.replyTo ?? ""}
                    onChange={e =>
                      update("replyTo", e.target.value || undefined)
                    }
                    placeholder="replies@example.com"
                    aria-invalid={addressErrors.replyTo ? true : undefined}
                  />
                  {addressErrors.replyTo && (
                    <p className="text-xs text-destructive">
                      {addressErrors.replyTo}
                    </p>
                  )}
                </div>
              )}
            </div>
            {replyToMode === "field" && (
              <p className="text-xs text-muted-foreground -mt-2">
                Replying to this email answers the person who submitted the
                form.
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

          {/* Send condition */}
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
                <div className="min-w-36 flex-1 space-y-1.5">
                  <Label htmlFor="notification-condition-field">Field</Label>
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
                      id="notification-condition-field"
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
                </div>

                <div className="min-w-36 flex-1 space-y-1.5">
                  <Label htmlFor="notification-condition-comparison">
                    Comparison
                  </Label>
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
                      id="notification-condition-comparison"
                      className="w-full bg-transparent border-input dark:bg-muted/50"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COMPARISON_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {!VALUELESS_COMPARISONS.has(condition.comparison) && (
                  <div className="min-w-36 flex-1 space-y-1.5">
                    <Label htmlFor="notification-condition-value">Value</Label>
                    <Input
                      id="notification-condition-value"
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
                  </div>
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

        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted p-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!form.name.trim()}
          >
            {isEditing ? "Save changes" : "Add notification"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
  const [sheetState, setSheetState] = useState<{
    open: boolean;
    editing: FormNotification | null;
  }>({ open: false, editing: null });

  useEffect(() => {
    void fetchProviders().then(setProviders);
    void fetchTemplates().then(setTemplates);
  }, []);

  const fieldList = useMemo<FieldOption[]>(
    () => fields.map(f => ({ name: f.name, label: f.label, type: f.type })),
    [fields]
  );

  const openAddSheet = useCallback(() => {
    setSheetState({ open: true, editing: null });
  }, []);

  const openEditSheet = useCallback((notification: FormNotification) => {
    setSheetState({ open: true, editing: notification });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetState({ open: false, editing: null });
  }, []);

  const handleSave = useCallback(
    (notification: FormNotification) => {
      if (sheetState.editing) {
        updateNotification(notification.id, notification);
      } else {
        addNotification(notification);
      }
      closeSheet();
    },
    [sheetState.editing, addNotification, updateNotification, closeSheet]
  );

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

  const initialNotification = sheetState.editing ?? createNotification();

  return (
    <div className="max-w-200">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            Notifications
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Emails sent when someone submits this form.
          </p>
        </div>
        <Button type="button" onClick={openAddSheet}>
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
          <Button type="button" onClick={openAddSheet}>
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
              onEdit={() => openEditSheet(notification)}
              onDuplicate={() => duplicateNotification(notification.id)}
              onDelete={() => deleteNotification(notification.id)}
              onToggleEnabled={enabled =>
                updateNotification(notification.id, { enabled })
              }
            />
          ))}
        </div>
      )}

      {/* Editor sheet */}
      {sheetState.open && (
        <NotificationSheet
          initial={initialNotification}
          isEditing={!!sheetState.editing}
          providers={providers}
          templates={templates}
          fields={fieldList}
          defaults={defaults}
          onSave={handleSave}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

export default FormNotificationsTab;
