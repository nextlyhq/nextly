"use client";

/**
 * One "Assign…" control for a part in review: a menu of whom it may be
 * assigned to, in place of a button per role.
 *
 * It offers the person themselves, the roles the part waits for (each as the
 * whole role), and the people holding one of those roles, read only for a
 * person who may list people. A search at the top asks the people list for
 * the name typed, so someone past its first page is found as well. Those are the assignees the server accepts, as
 * the part's review state names them: an assignee must hold the stage's
 * primary step, and the roles it waits for are the ones that do. The server
 * still judges every assignment; a refusal is said in a toast. A part already
 * assigned offers Unassign.
 *
 * @module components/features/entries/review/AssignPicker
 * @experimental
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";

import { toast } from "@admin/components/ui";
import { useAssignPart } from "@admin/hooks/queries/useReviewState";
import { useUsers } from "@admin/hooks/queries/useUsers";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { useHasPermission } from "@admin/hooks/useHasPermission";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { UserApiResponse } from "@admin/types/user";
import type { PartReview, ReviewAssignee } from "@admin/types/workflows";

/** One page of people, narrowed by the name typed where there is one. */
function peopleQuery(search: string) {
  const term = search.trim();
  return {
    pagination: { page: 0, pageSize: 100 },
    sorting: [],
    filters: term === "" ? {} : { search: term },
  };
}

/** One row of the picker: whom it assigns to, and what it says. */
interface AssignOption {
  key: string;
  label: string;
  assignee: ReviewAssignee;
}

/**
 * Whom the part may be assigned to: the person, the roles it waits for, then
 * the people holding one of those roles. Nobody already assigned is offered
 * again.
 */
function assignOptions({
  part,
  me,
  people,
}: {
  part: PartReview;
  me: string | null;
  people: readonly UserApiResponse[];
}): AssignOption[] {
  const roles = part.waitingFor?.kind === "roles" ? part.waitingFor.roles : [];
  const holding = new Set(roles.map(role => role.id));
  const assigned = part.assignee;
  const isAssigned = (assignee: ReviewAssignee) =>
    assigned !== null &&
    assigned.kind === assignee.kind &&
    assigned.id === assignee.id;
  const options: AssignOption[] = [
    ...(me === null
      ? []
      : [{ key: `user:${me}`, label: "Me", assignee: user(me) }]),
    ...roles.map(role => ({
      key: `role:${role.id}`,
      label: `${role.name ?? role.id} (the whole role)`,
      assignee: { kind: "role" as const, id: role.id },
    })),
    ...people
      .filter(
        person =>
          person.id !== me &&
          person.roles.some(role => holding.has(String(role.id)))
      )
      .map(person => ({
        key: `user:${person.id}`,
        label: person.name || person.email,
        assignee: user(person.id),
      })),
  ];
  return options.filter(option => !isAssigned(option.assignee));
}

function user(id: string): ReviewAssignee {
  return { kind: "user", id };
}

export function AssignPicker({
  document,
  part,
}: {
  document: ReleaseDocumentRef;
  part: PartReview;
}): JSX.Element {
  const has = useHasPermission();
  const me = useCurrentUserId();
  const assign = useAssignPart(document);
  // People are read once the menu is first opened, and only for a person who
  // may list them: the roles alone are offered to everyone else.
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const mayListPeople = has("read-users");
  const people = useUsers(peopleQuery(search), {
    enabled: opened && mayListPeople,
  });
  const options = assignOptions({
    part,
    me,
    people: people.data?.items ?? [],
  });

  const to = (assignee: ReviewAssignee | null) => {
    assign.mutate(
      { part: part.part, revision: part.revision, assignee },
      {
        onError: reason =>
          toast.error(apiErrorMessage(reason, "The part wasn't assigned.")),
      }
    );
  };

  return (
    <DropdownMenu onOpenChange={open => open && setOpened(true)}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 self-start px-2 text-xs"
          disabled={assign.isPending}
        >
          Assign…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {mayListPeople ? (
          <div className="p-1.5">
            <Input
              type="search"
              aria-label="Find a person"
              placeholder="Find a person…"
              className="h-8 text-xs"
              value={search}
              onChange={event => setSearch(event.target.value)}
              // The menu's own keys (typeahead, arrows) stay off the field
              // while a name is typed in it.
              onKeyDown={event => event.stopPropagation()}
            />
          </div>
        ) : null}
        {options.map(option => (
          <DropdownMenuItem
            key={option.key}
            onSelect={() => to(option.assignee)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
        {part.assignee === null ? null : (
          <>
            {options.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => to(null)}>
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
