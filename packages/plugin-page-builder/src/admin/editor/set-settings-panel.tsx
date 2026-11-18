"use client";

/**
 * A header & footer set's settings, in the builder's right panel on the set's
 * own screen while nothing is selected: its name, the header and the footer
 * it shows (each a picker with pictures), how many pages use it, whether it
 * is the site default or a way to make it so, and a ⋯ menu with Rename,
 * Duplicate and Delete.
 *
 * The name and the areas are the set form's own fields, so the top bar's
 * Save and Publish store them as the set's draft and publish it, and the
 * canvas draws a choice at once. Making it the default, copying it and
 * deleting it are the same flows as the Pages panel's rows.
 *
 * @module admin/editor/set-settings-panel
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  navigateTo,
  useLeaveWithoutWarning,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
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
  toast,
} from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useId, useRef, type JSX } from "react";
import { useController, type Control, type FieldValues } from "react-hook-form";

import { withArea, withoutArea } from "../../layout-area-rows";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../../library-contract";
import { duplicateLayout } from "../layout-writes-client";
import { useMakeDefaultFlow } from "../make-default-action";
import { useAskChoicesAgain } from "../page-layout";
import { useRemoveLayout } from "../RemoveLayoutAction";

import { checkedAdminPath, returnFromSearch } from "./edit-component";
import { setBuilderAddress } from "./set-address";
import { SetAreaPicker } from "./set-area-picker";
import { useSetStanding, type SetStanding } from "./set-reads";
import { useSetFormAreas, type SetMode } from "./set-regions";
import { usedOnWords } from "./set-words";

/** The set form's fields this edits. */
const TITLE_FIELD = "title";
const AREAS_FIELD = "areas";

/** What a refused write says: core's own words, or a plain fallback. */
function refusalOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The header & footer set could not be changed. Try again.";
}

export function SetSettingsPanel({
  set,
  control,
}: {
  set: SetMode;
  control: Control<FieldValues>;
}): JSX.Element {
  const headingId = useId();
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement | null>(null);
  const standing = useSetStanding(set.id);
  const form = useSetFormAreas(control);
  const title = useController({ control, name: TITLE_FIELD });
  const areas = useController({ control, name: AREAS_FIELD });
  const { onChange: setAreas } = areas.field;
  const chooseFor = useCallback(
    (area: RegionArea) => (component: string | null) => {
      setAreas(
        component === null
          ? withoutArea(form.rows, area)
          : withArea(form.rows, area, component)
      );
    },
    [form.rows, setAreas]
  );
  const shownTitle =
    typeof title.field.value === "string" ? title.field.value : "";
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
      data-set-settings=""
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2
          id={headingId}
          className="text-[color:var(--nx-builder-text)] m-0 text-sm font-semibold"
        >
          Header & footer set
        </h2>
        <SetMenu
          set={set}
          title={shownTitle}
          standing={standing}
          onRename={() => {
            nameInput.current?.focus();
            nameInput.current?.select();
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          ref={element => {
            title.field.ref(element);
            nameInput.current = element;
          }}
          name={title.field.name}
          value={shownTitle}
          onChange={event => title.field.onChange(event.target.value)}
          onBlur={title.field.onBlur}
          disabled={set.readOnly === true}
          aria-invalid={title.fieldState.invalid ? true : undefined}
        />
        {title.fieldState.error?.message === undefined ? null : (
          <p className="m-0 text-xs text-destructive">
            {title.fieldState.error.message}
          </p>
        )}
      </div>
      <AreaField
        area="header"
        value={form.header}
        onChoose={chooseFor("header")}
        disabled={set.readOnly === true}
      />
      <AreaField
        area="footer"
        value={form.footer}
        onChoose={chooseFor("footer")}
        disabled={set.readOnly === true}
      />
      <p className="text-[color:var(--nx-builder-text-muted)] m-0 text-xs">
        {usedOnWords(standing.pages)}
      </p>
      <DefaultLine set={set} title={shownTitle} standing={standing} />
    </section>
  );
}

/** One area's label and picker. */
function AreaField({
  area,
  value,
  onChoose,
  disabled,
}: {
  area: RegionArea;
  value: string | undefined;
  onChoose: (component: string | null) => void;
  disabled: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{area === "header" ? "Header" : "Footer"}</Label>
      <SetAreaPicker
        area={area}
        id={id}
        value={value}
        onChoose={onChoose}
        disabled={disabled}
      />
    </div>
  );
}

/** Who may choose the site default, as the Header & footer list asks it. */
function useMayChooseDefault(): boolean {
  const settings = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
    staleTime: 0,
  });
  return settings.data?.mayChooseDefaultLayout === true;
}

/**
 * The site default's badge, or the way to make this set the default for
 * someone who may: "Make site default", or for a set never published,
 * "Publish it, then make default".
 */
function DefaultLine({
  set,
  title,
  standing,
}: {
  set: SetMode;
  title: string;
  standing: SetStanding;
}): JSX.Element | null {
  const may = useMayChooseDefault();
  const askChoicesAgain = useAskChoicesAgain();
  const after = useCallback(() => {
    standing.reread();
    askChoicesAgain();
  }, [standing, askChoicesAgain]);
  const makeDefault = useMakeDefaultFlow({ published: after, made: after });
  if (standing.isDefault) {
    return (
      <div>
        <Badge variant="info">Site default</Badge>
      </div>
    );
  }
  if (!may || standing.set === undefined) return null;
  const published = standing.set.published;
  return (
    <div>
      {makeDefault.dialog}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => makeDefault.start({ id: set.id, title, published })}
      >
        {published ? "Make site default" : "Publish it, then make default"}
      </Button>
    </div>
  );
}

/** Where the set's screen goes back to: the page it came from, or its list. */
function leaveAddress(collection: string | undefined): string | undefined {
  const back = returnFromSearch(window.location.search);
  if (back !== undefined) return back;
  return collection === undefined
    ? undefined
    : checkedAdminPath(`/admin/collections/${encodeURIComponent(collection)}`);
}

/**
 * The set's ⋯ menu: Rename (its Name field, focused), Duplicate and Delete,
 * each only for someone with the right it needs.
 */
function SetMenu({
  set,
  title,
  standing,
  onRename,
}: {
  set: SetMode;
  title: string;
  standing: SetStanding;
  onRename: () => void;
}): JSX.Element {
  const meta = standing.choices?.meta;
  const leaveWithoutWarning = useLeaveWithoutWarning();
  // Rename starts once the menu has CLOSED: started while it closes, the
  // menu's focus return would take the focus back from the field.
  const renameAfterClose = useRef(false);
  const removal = useRemoveLayout({
    entryId: set.id,
    published: standing.set?.published === true,
    // Deleted: back where the author came from, the set no longer being
    // there to stay on. Unpublished: the set read again, as its form does.
    leave: action => {
      if (action === "unpublish") {
        window.location.reload();
        return;
      }
      const to = leaveAddress(meta?.layoutsCollection);
      leaveWithoutWarning();
      if (to === undefined) window.location.reload();
      else navigateTo(to);
    },
  });
  const duplicate = async () => {
    try {
      const copy = await duplicateLayout(set.id);
      toast.success(`${copy.title} was made.`, {
        action: {
          label: "Open",
          onClick: () => {
            if (meta === undefined) return;
            window.location.assign(
              setBuilderAddress(
                meta.layoutsCollection,
                copy.id,
                window.location,
                title
              )
            );
          },
        },
      });
      standing.reread();
    } catch (error) {
      toast.error(refusalOf(error));
    }
  };
  const mayRename = set.readOnly !== true;
  const mayDuplicate = meta?.canCreateLayouts === true;
  const mayDelete = meta?.canDeleteAnyLayout === true && set.readOnly !== true;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${title === "" ? "this set" : title}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-[color:var(--nx-builder-text)]"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={event => {
            if (!renameAfterClose.current) return;
            renameAfterClose.current = false;
            event.preventDefault();
            onRename();
          }}
        >
          {mayRename ? (
            <DropdownMenuItem
              onSelect={() => {
                renameAfterClose.current = true;
              }}
            >
              Rename
            </DropdownMenuItem>
          ) : null}
          {mayDuplicate ? (
            <DropdownMenuItem onSelect={() => void duplicate()}>
              Duplicate
            </DropdownMenuItem>
          ) : null}
          {mayDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  // The default is taken down only once another set is the
                  // default: said here, before any check is asked.
                  if (standing.isDefault) {
                    toast.error(
                      `${title} is the site default. Make another set the default before deleting it.`
                    );
                    return;
                  }
                  removal.open();
                }}
              >
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {removal.dialog}
    </>
  );
}
