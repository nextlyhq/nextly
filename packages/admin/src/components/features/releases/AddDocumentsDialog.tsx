"use client";

/**
 * Add documents to a release from inside it, several at once.
 *
 * The picker lists documents from every collection and Single the reader may
 * publish or unpublish, narrowed by a search, a collection and "Has
 * unpublished changes". A document already in the release, or one the reader
 * may not act on with the chosen action, is listed but cannot be picked, with
 * the reason beside it; changing the action judges the list again. The
 * selection is added in one request, all or none.
 *
 * Documents added to go live may link to documents that will not be live when
 * the release runs. The add's answer names them, so the dialog then offers to
 * add those too, to go live with them, before it closes. Documents added to
 * come down are offered nothing.
 *
 * @module components/features/releases/AddDocumentsDialog
 */

import type { JSX } from "react";
import { useId, useState } from "react";

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@admin/components/ui";
import {
  useAddReleaseMembers,
  useReleaseDocumentNames,
} from "@admin/hooks/queries/useReleases";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type {
  AddedReleaseMember,
  Release,
  ReleaseMemberAction,
} from "@admin/types/releases";

import {
  documentKey,
  linkedOffer,
  membersToAdd,
  offersAnything,
  pickRefusal,
  type LinkedOffer,
  type PickerDocument,
} from "./add-documents";
import { useReturnFocusOnClose } from "./dialog-opener";
import { isDefiniteRefusal, releaseErrorMessage } from "./release-error";
import { ReleaseActionChoice } from "./ReleaseActionChoice";
import { useAddDocumentsSources } from "./useAddDocumentsSources";

export interface AddDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  release: Pick<Release, "id" | "title">;
  /** The documents the release holds that the reader can see, by key. */
  inRelease: ReadonlySet<string>;
  /**
   * Where focus goes back to on close, as read by whatever opened this dialog
   * before its code arrived. The lazy wrapper reads the opener on the click
   * itself: by the time this dialog first renders, the dialog standing in
   * while its code loaded holds focus, so this dialog cannot read it.
   */
  returnFocus?: (event: Event) => void;
}

/** The scope filter's value for every collection and Single. */
const EVERY_SCOPE = "__every__";

/** "1 document" or "3 documents". */
function documentsCount(count: number): string {
  return `${count} ${count === 1 ? "document" : "documents"}`;
}

export function AddDocumentsDialog({
  open,
  onOpenChange,
  release,
  inRelease,
  returnFocus: givenReturnFocus,
}: AddDocumentsDialogProps): JSX.Element {
  // Focus goes back to what opened the dialog when it closes: the opener its
  // lazy wrapper read, or, rendered directly, the one read here.
  const ownReturnFocus = useReturnFocusOnClose(open);
  const returnFocus = givenReturnFocus ?? ownReturnFocus;
  // The offer replaces the picker once an add has landed, so the dialog keeps
  // which one it shows; reopening it starts at the picker again.
  const [offer, setOffer] = useState<LinkedOffer | null>(null);
  const close = (next: boolean) => {
    if (!next) setOffer(null);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        onCloseAutoFocus={returnFocus}
        className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        {offer === null ? (
          <DocumentPicker
            release={release}
            inRelease={inRelease}
            enabled={open}
            onAdded={(added, landedIn) => {
              const next = linkedOffer(added, landedIn);
              if (offersAnything(next)) setOffer(next);
              else close(false);
            }}
            onCancel={() => close(false)}
          />
        ) : (
          <LinkedDocumentsOffer
            release={release}
            offer={offer}
            onDone={() => close(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The documents picked so far, by key, and the two ways the set changes: one
 * document picked or unpicked, and dropping every pick a predicate refuses.
 */
function usePickedDocuments() {
  const [picked, setPicked] = useState<Map<string, PickerDocument>>(
    () => new Map()
  );
  const toggle = (document: PickerDocument, on: boolean) => {
    setPicked(current => {
      const next = new Map(current);
      if (on) next.set(documentKey(document), document);
      else next.delete(documentKey(document));
      return next;
    });
  };
  const dropRefused = (refused: (document: PickerDocument) => boolean) => {
    setPicked(
      current =>
        new Map([...current].filter(([, document]) => !refused(document)))
    );
  };
  return { picked, toggle, dropRefused };
}

/** The first screen: the documents, the action, and the one add. */
function DocumentPicker({
  release,
  inRelease,
  enabled,
  onAdded,
  onCancel,
}: {
  release: Pick<Release, "id" | "title">;
  inRelease: ReadonlySet<string>;
  enabled: boolean;
  onAdded: (added: AddedReleaseMember[], landedIn: ReadonlySet<string>) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const { can } = useCurrentUserPermissions();
  const [action, setAction] = useState<ReleaseMemberAction>("publish");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const { picked, toggle, dropRefused } = usePickedDocuments();
  const sources = useAddDocumentsSources(
    { search, scope, pendingOnly },
    enabled
  );
  const add = useAddReleaseMembers(release.id);

  const refusalOf = (document: PickerDocument, next = action) =>
    pickRefusal(document, next, { can, inRelease });
  // Either action is offered where the reader may take it on any scope listed.
  const canPublishAny = sources.scopes.some(each =>
    can(`publish-${each.slug}`)
  );
  const canUnpublishAny = sources.scopes.some(each =>
    can(`unpublish-${each.slug}`)
  );

  const changeAction = (next: ReleaseMemberAction) => {
    setAction(next);
    // A document the new action may not take is no longer picked.
    dropRefused(document => Boolean(refusalOf(document, next)));
  };

  const submit = () => {
    const chosen = [...picked.values()];
    if (chosen.length === 0) return;
    add.mutate(
      { members: membersToAdd(chosen, action) },
      {
        onSuccess: answer => {
          toast.success(
            `Added ${documentsCount(chosen.length)} to the release.`
          );
          const landedIn = new Set(inRelease);
          for (const document of chosen) landedIn.add(documentKey(document));
          onAdded(answer.item.members, landedIn);
        },
      }
    );
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add documents to “{release.title}”</DialogTitle>
        <DialogDescription>
          Pick documents from any collection or Single, then add them in one
          step.
        </DialogDescription>
      </DialogHeader>

      <ReleaseActionChoice
        action={action}
        onChange={changeAction}
        canPublishDocument={canPublishAny}
        canUnpublishDocument={canUnpublishAny}
        subject="the documents"
        heldSubject="any of these documents"
      />

      <PickerFilters
        ids={ids}
        search={search}
        onSearch={setSearch}
        scope={scope}
        onScope={setScope}
        scopes={sources.scopes}
        pendingOnly={pendingOnly}
        onPendingOnly={setPendingOnly}
      />

      <PickerList
        label={`${ids}-list`}
        sources={sources}
        picked={picked}
        refusalOf={refusalOf}
        onToggle={toggle}
      />

      {add.isError ? <AddFailure error={add.error} /> : null}

      <PickerFooter
        count={picked.size}
        adding={add.isPending}
        onCancel={onCancel}
      />
    </form>
  );
}

/** The search, the collection filter and Has unpublished changes. */
function PickerFilters({
  ids,
  search,
  onSearch,
  scope,
  onScope,
  scopes,
  pendingOnly,
  onPendingOnly,
}: {
  ids: string;
  search: string;
  onSearch: (search: string) => void;
  scope: string | null;
  onScope: (scope: string | null) => void;
  scopes: ReturnType<typeof useAddDocumentsSources>["scopes"];
  pendingOnly: boolean;
  onPendingOnly: (pendingOnly: boolean) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${ids}-search`}>Find a document</Label>
          <Input
            id={`${ids}-search`}
            type="search"
            value={search}
            onChange={event => onSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor={`${ids}-scope`}>Collection</Label>
          <Select
            value={scope ?? EVERY_SCOPE}
            onValueChange={next => onScope(next === EVERY_SCOPE ? null : next)}
          >
            <SelectTrigger id={`${ids}-scope`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERY_SCOPE}>
                All collections and Singles
              </SelectItem>
              {scopes.map(each => (
                <SelectItem key={each.slug} value={each.slug}>
                  {each.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${ids}-pending`}
          checked={pendingOnly}
          onCheckedChange={onPendingOnly}
        />
        <Label htmlFor={`${ids}-pending`} className="font-normal">
          Has unpublished changes
        </Label>
      </div>
    </>
  );
}

/**
 * Why the add failed: a refusal the server gave, with nothing added, or no
 * answer at all, when whether anything was added is not known.
 */
function AddFailure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {isDefiniteRefusal(error)
        ? `${releaseErrorMessage(error, "The documents could not be added.")} Nothing was added.`
        : "No answer came back. Check the release's documents before trying again."}
    </p>
  );
}

/** How many are picked, Cancel, and the add, named by how many it adds. */
function PickerFooter({
  count,
  adding,
  onCancel,
}: {
  count: number;
  adding: boolean;
  onCancel: () => void;
}) {
  let addLabel = `Add ${documentsCount(count)}`;
  if (adding) addLabel = "Adding…";
  else if (count === 0) addLabel = "Add documents";
  return (
    <DialogFooter className="items-center sm:justify-between">
      <p role="status" className="text-sm text-muted-foreground">
        {count === 0 ? "None picked" : `${count} picked`}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={adding}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={count === 0 || adding}>
          {addLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

/** The listed documents, each pickable or held with its reason. */
function PickerList({
  label,
  sources,
  picked,
  refusalOf,
  onToggle,
}: {
  label: string;
  sources: ReturnType<typeof useAddDocumentsSources>;
  picked: ReadonlyMap<string, PickerDocument>;
  refusalOf: (document: PickerDocument) => string | null;
  onToggle: (document: PickerDocument, on: boolean) => void;
}) {
  if (sources.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The documents could not be loaded.
      </p>
    );
  }
  if (sources.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading documents…
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {sources.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents match. Try another search or collection.
        </p>
      ) : (
        <ul
          aria-label="Documents"
          className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {sources.documents.map(document => {
            const key = documentKey(document);
            const refusal = refusalOf(document);
            const id = `${label}-${key}`;
            return (
              <li key={key} className="flex items-start gap-3 px-3 py-2">
                <Checkbox
                  id={id}
                  checked={picked.has(key)}
                  disabled={refusal !== null}
                  aria-describedby={refusal ? `${id}-held` : undefined}
                  onCheckedChange={next => onToggle(document, next === true)}
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-col">
                  <Label htmlFor={id} className="break-words font-normal">
                    {document.title}
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {document.scopeLabel}
                    {document.status
                      ? ` · ${document.status === "published" ? "Published" : "Draft"}`
                      : ""}
                  </span>
                  {refusal ? (
                    <span
                      id={`${id}-held`}
                      className="text-xs text-muted-foreground"
                    >
                      {refusal}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sources.truncated.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          More in {sources.truncated.join(", ")}. Search to narrow them.
        </p>
      ) : null}
      {sources.singlesUnfiltered ? (
        <p className="text-xs text-muted-foreground">
          The unpublished-changes filter doesn&apos;t apply to Singles yet: they
          are listed whatever their changes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The second screen, after documents went in to go live: the documents they
 * link to that will not be live when the release runs, offered to go live
 * with them. "Not now" adds nothing more.
 */
function LinkedDocumentsOffer({
  release,
  offer,
  onDone,
}: {
  release: Pick<Release, "id" | "title">;
  offer: LinkedOffer;
  onDone: () => void;
}) {
  const add = useAddReleaseMembers(release.id);
  const names = useReleaseDocumentNames(release.id, offer.links);
  const offered = offer.links.length;
  const addLinked = () =>
    add.mutate(
      {
        members: offer.links.map(link => ({
          scopeKind: link.scopeKind,
          scopeSlug: link.scopeSlug,
          entryId: link.entryId,
          action: "publish",
        })),
      },
      {
        onSuccess: () => {
          toast.success(`Added ${documentsCount(offered)} to go live too.`);
          onDone();
        },
      }
    );
  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Linked documents that won’t be live</DialogTitle>
        <DialogDescription>
          The documents you added link to these, which will not be live when “
          {release.title}” runs.
          {offered > 0 ? " Add them to go live with it?" : null}
        </DialogDescription>
      </DialogHeader>
      {offered > 0 ? (
        <ul
          aria-label="Linked documents"
          className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {offer.links.map(link => (
            <li key={documentKey(link)} className="flex flex-col px-3 py-2">
              <span className="break-words text-sm">
                {names.documentOf(link)?.title ??
                  (names.isPending(link.scopeSlug) ? "Loading…" : "Untitled")}
              </span>
              <span className="text-xs text-muted-foreground">
                {names.scopeNamesOf(link.scopeSlug)?.singular ?? link.scopeSlug}{" "}
                · linked from {link.fields.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <OfferCounts offer={offer} />
      {add.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {isDefiniteRefusal(add.error)
            ? `${releaseErrorMessage(add.error, "The linked documents could not be added.")} Nothing more was added.`
            : "No answer came back. Check the release's documents before trying again."}
        </p>
      ) : null}
      <DialogFooter>
        {offered > 0 ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={add.isPending}
              onClick={onDone}
            >
              Not now
            </Button>
            <Button type="button" disabled={add.isPending} onClick={addLinked}>
              {add.isPending ? "Adding…" : `Add ${documentsCount(offered)}`}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

/** What the offer can only count: links the reader cannot see, or that are gone. */
function OfferCounts({ offer }: { offer: LinkedOffer }) {
  const lines = [
    offer.hiddenCount > 0
      ? `${offer.hiddenCount} more ${offer.hiddenCount === 1 ? "link goes" : "links go"} to documents you cannot view.`
      : null,
    offer.inHiddenFields > 0
      ? `${offer.inHiddenFields} more ${offer.inHiddenFields === 1 ? "link is" : "links are"} in fields you cannot view.`
      : null,
    offer.deletedCount > 0
      ? `${offer.deletedCount} ${offer.deletedCount === 1 ? "link goes" : "links go"} to documents that no longer exist.`
      : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {lines.map(line => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
