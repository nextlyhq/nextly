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

export function WorkbenchHeader({
  tier,
  control,
  onNameChange,
  record,
  isEdit,
  isPending,
  isDirty,
  isActive,
  ownsContent,
  hasData,
  sheet,
  onToggleSheet,
  onExit,
  exitLabel,
  onSendTest,
  onOverride,
  menu,
}: {
  tier: WorkbenchTier;
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
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
}) {
  const isPhone = tier === "phone";
  const owner = record ? ownerName(record) : null;
  const state = record ? stateOf(record) : null;

  const menuItems = [
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
  const deleteItem = menu.onDelete ? (
    <DropdownMenuItem
      onSelect={menu.onDelete}
      className="text-destructive focus:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
      Delete
    </DropdownMenuItem>
  ) : menu.deleteRefusal ? (
    <DropdownMenuItem disabled>
      <Trash2 className="h-4 w-4" />
      {menu.deleteRefusal}
    </DropdownMenuItem>
  ) : null;

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
        {!isPhone && record ? (
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            {state ? (
              <Badge variant="outline" className="shrink-0">
                {STATE_LABELS[state]}
              </Badge>
            ) : null}
            {!isActive ? (
              <Badge variant="outline" className="shrink-0">
                Off
              </Badge>
            ) : null}
            <span className="shrink-0" data-testid="workbench-owner">
              {owner}
            </span>
            {tier === "desktop" && record.description ? (
              <span className="truncate">· {record.description}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {isDirty && !isPhone ? (
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
          Unsaved changes
        </span>
      ) : null}

      {!isPhone ? (
        <div className="flex shrink-0 items-center gap-2">
          {hasData ? (
            <Button
              type="button"
              variant="outline"
              aria-pressed={sheet === "data"}
              onClick={() => onToggleSheet("data")}
            >
              <Braces className="h-4 w-4" />
              Data
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            aria-pressed={sheet === "details"}
            onClick={() => onToggleSheet("details")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Details
          </Button>
          {isEdit ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onSendTest}
            >
              <Send className="h-4 w-4" />
              Send test
            </Button>
          ) : null}
          {!ownsContent ? (
            <Button type="button" disabled={isPending} onClick={onOverride}>
              <Pencil className="h-4 w-4" />
              Override
            </Button>
          ) : null}
          <SaveButton
            isEdit={isEdit}
            isPending={isPending}
            variant={ownsContent ? "default" : "outline"}
          />
        </div>
      ) : null}

      {isEdit && (menuItems.length > 0 || deleteItem) ? (
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
            {menuItems}
            {deleteItem && menuItems.length > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            {deleteItem}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
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
  return (
    <Button type="submit" variant={variant} disabled={isPending}>
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {isEdit ? "Saving…" : "Creating…"}
        </>
      ) : isEdit ? (
        "Save"
      ) : (
        "Create email"
      )}
    </Button>
  );
}
