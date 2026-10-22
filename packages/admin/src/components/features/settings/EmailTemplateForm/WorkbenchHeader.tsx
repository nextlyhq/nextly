"use client";

/**
 * The workbench's header: the way back, which email this is and whose, its
 * state, and the page's actions.
 *
 * Each control appears once. On a phone the actions move to the bottom bar,
 * so the header keeps only the way back, the name and the menu.
 */
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { useForm } from "react-hook-form";

import {
  STATE_LABELS,
  stateOf,
} from "@admin/components/features/email-hub/messages/messages-model";
import {
  ArrowLeft,
  Braces,
  Copy,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
} from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { cn } from "@admin/lib/utils";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import type { TemplateFormValues } from "./schema";
import { ownerName, type WorkbenchTier } from "./workbench-model";
import type { SheetPanel } from "./WorkbenchLayout";

/** The menu's acts, each present only when it can happen. */
export interface WorkbenchMenu {
  onDuplicate?: () => void;
  onReview?: () => void;
  onReset?: () => void;
  onDelete?: () => void;
  /** Why Delete isn't offered, when the email can't be deleted. */
  deleteRefusal?: string;
}

type FormControlOf = ReturnType<typeof useForm<TemplateFormValues>>["control"];

export interface WorkbenchHeaderProps {
  tier: WorkbenchTier;
  control: FormControlOf;
  onNameChange: (value: string, onChange: (v: string) => void) => void;
  /** The saved email, or nothing while creating one. */
  record?: EmailTemplateRecord;
  isEdit: boolean;
  isPending: boolean;
  isDirty: boolean;
  isActive: boolean;
  /** Whether the site may change the owner's parts right now. */
  ownsContent: boolean;
  /** Whether there is test data to show (a layout has none). */
  hasData: boolean;
  sheet: SheetPanel | null;
  onToggleSheet: (panel: SheetPanel) => void;
  onExit: () => void;
  exitLabel: string;
  onSendTest: () => void;
  onOverride: () => void;
  menu: WorkbenchMenu;
}

/** The email's name, editable on any email: it is the site's setting. */
function NameField({
  control,
  onNameChange,
  isPending,
}: Pick<WorkbenchHeaderProps, "control" | "onNameChange" | "isPending">) {
  return (
    <FormField
      control={control}
      name="name"
      render={({ field }) => (
        // A refused save has to say why here: this field is always on
        // screen, so without its message Save reads as a dead control.
        <FormItem className="min-w-0 space-y-0">
          <FormControl>
            <input
              {...field}
              onChange={e => onNameChange(e.target.value, field.onChange)}
              disabled={isPending}
              placeholder="Untitled email"
              aria-label="Email name"
              className="w-full truncate bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Under the name: the state, whether it's off, the owner, the description. */
function StateLine({
  tier,
  record,
  isActive,
}: {
  tier: WorkbenchTier;
  record: EmailTemplateRecord;
  isActive: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
      <Badge variant="outline" className="shrink-0">
        {STATE_LABELS[stateOf(record)]}
      </Badge>
      {isActive ? null : (
        <Badge variant="outline" className="shrink-0">
          Off
        </Badge>
      )}
      <span className="shrink-0" data-testid="workbench-owner">
        {ownerName(record)}
      </span>
      {tier === "desktop" && record.description ? (
        <span className="truncate">· {record.description}</span>
      ) : null}
    </div>
  );
}

function UnsavedMark({ isDirty }: { isDirty: boolean }) {
  if (!isDirty) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
      Unsaved changes
    </span>
  );
}

/**
 * A button's label: shown on a desktop, read by a screen reader everywhere.
 * On a tablet the secondary actions keep only their icons, so the name keeps
 * the room it needs.
 */
function ActionLabel({
  tier,
  children,
}: {
  tier: WorkbenchTier;
  children: string;
}) {
  return (
    <span className={tier === "tablet" ? "sr-only" : undefined}>
      {children}
    </span>
  );
}

/** The page's actions, beside the name above a phone's width. */
function HeaderActions({
  tier,
  hasData,
  sheet,
  onToggleSheet,
  isEdit,
  isPending,
  onSendTest,
  ownsContent,
  onOverride,
}: Pick<
  WorkbenchHeaderProps,
  | "tier"
  | "hasData"
  | "sheet"
  | "onToggleSheet"
  | "isEdit"
  | "isPending"
  | "onSendTest"
  | "ownsContent"
  | "onOverride"
> & { tier: WorkbenchTier }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {hasData ? (
        <Button
          type="button"
          variant="outline"
          aria-pressed={sheet === "data"}
          onClick={() => onToggleSheet("data")}
        >
          <Braces className="h-4 w-4" />
          <ActionLabel tier={tier}>Data</ActionLabel>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        aria-pressed={sheet === "details"}
        onClick={() => onToggleSheet("details")}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <ActionLabel tier={tier}>Details</ActionLabel>
      </Button>
      {isEdit ? (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onSendTest}
        >
          <Send className="h-4 w-4" />
          <ActionLabel tier={tier}>Send test</ActionLabel>
        </Button>
      ) : null}
      {ownsContent ? null : (
        <Button type="button" disabled={isPending} onClick={onOverride}>
          <Pencil className="h-4 w-4" />
          Override
        </Button>
      )}
      <SaveButton
        isEdit={isEdit}
        isPending={isPending}
        variant={ownsContent ? "default" : "outline"}
      />
    </div>
  );
}

/** Delete, or the reason it isn't offered. */
function DeleteItem({ menu }: { menu: WorkbenchMenu }) {
  if (menu.onDelete) {
    return (
      <DropdownMenuItem
        onSelect={menu.onDelete}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </DropdownMenuItem>
    );
  }
  if (!menu.deleteRefusal) return null;
  return (
    <DropdownMenuItem disabled>
      <Trash2 className="h-4 w-4" />
      {menu.deleteRefusal}
    </DropdownMenuItem>
  );
}

/** The acts done less often, behind one button; nothing when there are none. */
function MoreMenu({ menu, owner }: { menu: WorkbenchMenu; owner: string }) {
  const items = [
    menu.onDuplicate && (
      <DropdownMenuItem key="duplicate" onSelect={menu.onDuplicate}>
        <Copy className="h-4 w-4" />
        Duplicate
      </DropdownMenuItem>
    ),
    menu.onReview && (
      <DropdownMenuItem key="review" onSelect={menu.onReview}>
        <History className="h-4 w-4" />
        Review {owner}&apos;s update
      </DropdownMenuItem>
    ),
    menu.onReset && (
      <DropdownMenuItem key="reset" onSelect={menu.onReset}>
        <RotateCcw className="h-4 w-4" />
        Reset to {owner}&apos;s version
      </DropdownMenuItem>
    ),
  ].filter(Boolean);
  const hasDelete = Boolean(menu.onDelete || menu.deleteRefusal);
  if (items.length === 0 && !hasDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items}
        {hasDelete && items.length > 0 ? <DropdownMenuSeparator /> : null}
        <DeleteItem menu={menu} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkbenchHeader(props: WorkbenchHeaderProps) {
  const { tier, record, isEdit, onExit, exitLabel } = props;
  const isPhone = tier === "phone";
  return (
    <div
      data-testid="workbench-header"
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b border-border",
        isPhone ? "h-14 px-2" : "h-16 pl-3 pr-4"
      )}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label={exitLabel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <NameField {...props} />
        {record && !isPhone ? (
          <StateLine tier={tier} record={record} isActive={props.isActive} />
        ) : null}
      </div>
      {isPhone ? null : (
        <>
          <UnsavedMark isDirty={props.isDirty} />
          <HeaderActions {...props} />
        </>
      )}
      {isEdit && record ? (
        <MoreMenu menu={props.menu} owner={ownerName(record)} />
      ) : null}
    </div>
  );
}

/** The phone's bottom bar: the actions the header holds above that width. */
export function PhoneActions({
  isEdit,
  isPending,
  ownsContent,
  onSendTest,
  onOverride,
}: Pick<
  WorkbenchHeaderProps,
  "isEdit" | "isPending" | "ownsContent" | "onSendTest" | "onOverride"
>) {
  return (
    <>
      {isEdit ? (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onSendTest}
        >
          Send test
        </Button>
      ) : null}
      {ownsContent ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onOverride}
        >
          Override
        </Button>
      )}
      <SaveButton isEdit={isEdit} isPending={isPending} />
    </>
  );
}

/** Save, or Create while creating; submits the workbench's form. */
export function SaveButton({
  isEdit,
  isPending,
  variant = "default",
}: {
  isEdit: boolean;
  isPending: boolean;
  variant?: "default" | "outline";
}) {
  const idle = isEdit ? "Save" : "Create email";
  const busy = isEdit ? "Saving…" : "Creating…";
  return (
    <Button type="submit" variant={variant} disabled={isPending}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {isPending ? busy : idle}
    </Button>
  );
}
