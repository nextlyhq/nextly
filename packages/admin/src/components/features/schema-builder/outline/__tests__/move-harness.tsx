/**
 * The outline as a page draws it for moving fields: the fields held in state,
 * the outline built from them, and the page's side of every move asking the
 * real move rule, so a test sees what a person would after each key, menu
 * choice or Move to….
 */
import { DndContext } from "@dnd-kit/core";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { vi } from "vitest";

import {
  judgeMove,
  moveDestinations,
  type MoveContext,
} from "@admin/lib/builder/move-rule";
import { fieldGroupFieldHolding } from "@admin/lib/builder/outline/move-targets";
import type { BlockCatalog } from "@admin/lib/builder/outline/block-rows";
import {
  buildOutline,
  flattenOutline,
  type LoadedFieldGroup,
} from "@admin/lib/builder/outline/outline-model";

import type { BuilderField } from "../../types";
import { Outline } from "../Outline";
import type { OutlineCallbacks } from "../outline-types";

/** What a test reads back: the fields as the last move left them. */
export interface MoveHarnessProbe {
  fields: readonly BuilderField[];
  commits: number;
}

export function MoveHarness({
  initial,
  context,
  fieldGroups = new Map(),
  blockCatalogs,
  probe,
}: {
  initial: BuilderField[];
  /** The rule's context, less what the harness reads from the outline. */
  context: MoveContext;
  fieldGroups?: ReadonlyMap<string, LoadedFieldGroup>;
  /** The blocks each blocks field accepts, so its block and prop rows are drawn. */
  blockCatalogs?: ReadonlyMap<string, BlockCatalog>;
  probe: MoveHarnessProbe;
}): JSX.Element {
  const [fields, setFields] = useState(initial);
  probe.fields = fields;
  const nodes = useMemo(
    () =>
      buildOutline(fields, {
        entityReadOnly: context.entityReadOnly,
        fieldGroups,
        blockCatalogs,
      }),
    [fields, context.entityReadOnly, fieldGroups, blockCatalogs]
  );
  const byId = useMemo(
    () => new Map(flattenOutline(nodes).map(node => [node.id, node])),
    [nodes]
  );
  // A field group's own field stands for the field using the group.
  const ctx: MoveContext = {
    ...context,
    fieldGroupFieldHolding: rowId => fieldGroupFieldHolding(byId, rowId),
  };
  const callbacks: OutlineCallbacks = {
    select: vi.fn(),
    addAt: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    setHidden: vi.fn(),
    openFieldGroup: vi.fn(),
    fields,
    judgeMove: (id, target) => judgeMove(fields, id, target, ctx),
    moveDestinations: id => moveDestinations(fields, id, ctx),
    commitMove: next => {
      probe.commits += 1;
      setFields(next);
    },
  };
  return (
    <DndContext>
      <Outline
        kind="collection"
        nodes={nodes}
        systemFields={[]}
        errors={new Map()}
        foldKey="test:moves"
        selectedId={null}
        readOnly={context.entityReadOnly}
        callbacks={callbacks}
        renderPreview={() => null}
      />
    </DndContext>
  );
}

/** A fresh probe for one test. */
export function newProbe(): MoveHarnessProbe {
  return { fields: [], commits: 0 };
}

/** A plain field, as the Builder holds one. */
export function plain(
  name: string,
  extra: Partial<BuilderField> = {}
): BuilderField {
  return {
    id: `f-${name}`,
    name,
    label: name[0]?.toUpperCase() + name.slice(1),
    type: "text",
    ...extra,
  } as BuilderField;
}
