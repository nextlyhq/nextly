/**
 * Every kind of event a workflow records shows in the History panel through the history's one
 * reading of a kind it has no verb of its own for: the kind's name in words, then what it applied
 * to, with who did it leading the row and the comment as its note. Nothing in the history names a
 * workflow kind, so these rows are the proof that a feature's kinds read there unchanged.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { DocumentEvent, VersionScope } from "@admin/services/versionApi";

import { HistoryStoryList } from "../HistoryStoryList";

const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish" };
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    getLocale: (code: string) => ({ label: LANGUAGES[code] ?? code }),
  }),
}));

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersionDiff: () => ({ data: undefined, isLoading: false, isError: false }),
}));

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 10, 5, 9, minutes)).toISOString();

/**
 * Each kind the workflows record, with the actor it is recorded as and the words the history
 * says for it: the steps (one kind per step kind, and an assignment), both withdrawals, and the
 * moves a deploy, a discard or the recovery command make.
 */
const KINDS: Array<{
  kind: string;
  actor: Pick<DocumentEvent, "actorKind" | "actorId" | "actorName">;
  says: string;
}> = [
  {
    kind: "workflow-submit",
    actor: person(),
    says: "Workflow submit · English",
  },
  {
    kind: "workflow-approve",
    actor: person(),
    says: "Workflow approve · English",
  },
  {
    kind: "workflow-request-changes",
    actor: person(),
    says: "Workflow request changes · English",
  },
  { kind: "workflow-move", actor: person(), says: "Workflow move · English" },
  {
    kind: "workflow-assign",
    actor: person(),
    says: "Workflow assign · English",
  },
  {
    kind: "workflow-approval-withdrawn",
    actor: person(),
    says: "Workflow approval withdrawn · English",
  },
  {
    kind: "workflow-approval-withdrawn-by-definition",
    actor: system(),
    says: "Workflow approval withdrawn by definition · English",
  },
  {
    kind: "workflow-stage-renamed",
    actor: system(),
    says: "Workflow stage renamed · English",
  },
  {
    kind: "workflow-stage-removed",
    actor: system(),
    says: "Workflow stage removed · English",
  },
  {
    kind: "workflow-detached",
    actor: system(),
    says: "Workflow detached · English",
  },
  {
    kind: "workflow-discarded",
    actor: person(),
    says: "Workflow discarded · English",
  },
  {
    kind: "workflow-stranded-moved",
    actor: person(),
    says: "Workflow stranded moved · English",
  },
];

function person(): Pick<DocumentEvent, "actorKind" | "actorId" | "actorName"> {
  return { actorKind: "person", actorId: "u1", actorName: "Ana" };
}

function system(): Pick<DocumentEvent, "actorKind" | "actorId" | "actorName"> {
  return { actorKind: "system", actorId: null, actorName: null };
}

function eventOf(
  kind: string,
  actor: Pick<DocumentEvent, "actorKind" | "actorId" | "actorName">,
  note: string | null
): DocumentEvent {
  return {
    id: `event-${kind}`,
    kind,
    ...actor,
    occurredAt: at(2),
    fromState: "legal",
    toState: "draft",
    note,
    versionNo: null,
    payload: null,
    parts: ["en"],
  };
}

function renderEvents(events: DocumentEvent[]) {
  return render(
    <HistoryStoryList
      scope={scope}
      versions={[]}
      events={events}
      lifecycle
      localized
      editingLocale={null}
      hasMore={false}
      selected={null}
      onSelect={vi.fn()}
    />
  );
}

describe("a workflow's events in the history", () => {
  it.each(KINDS)(
    "shows $kind as “$says”, led by who did it",
    ({ kind, actor, says }) => {
      renderEvents([eventOf(kind, actor, "Needs a source")]);

      const list = screen.getByRole("list", { name: "History, newest first" });
      const [row] = within(list).getAllByRole("listitem");
      expect(row).toHaveTextContent(`${says} · “Needs a source”`);
      expect(row).toHaveTextContent(
        actor.actorKind === "system" ? "System" : "Ana"
      );
    }
  );

  it("shows every kind as a row of its own, none dropped", () => {
    renderEvents(
      KINDS.map(({ kind, actor }, index) => ({
        ...eventOf(kind, actor, null),
        occurredAt: at(index + 1),
      })).reverse()
    );

    const list = screen.getByRole("list", { name: "History, newest first" });
    for (const { says } of KINDS) {
      expect(list).toHaveTextContent(says);
    }
  });
});
