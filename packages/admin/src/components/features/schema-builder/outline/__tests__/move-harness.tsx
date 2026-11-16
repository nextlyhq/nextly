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

import type { BuilderFieldError } from "@admin/lib/builder/field-validators";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
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
import { crumbsByPointer } from "../FocusCrumbs";
import { Outline } from "../Outline";
import type { OutlineCallbacks } from "../outline-types";

/** What a test reads back: the fields as the last move left them. */
export interface MoveHarnessProbe {
  fields: readonly BuilderField[];
  commits: number;
  /** The selected field, as the page would keep it. */
  selectedId: string | null;
  /** Where each "Add field" asked to add, in order. */
  addsAt: FieldInsertPosition[];
}

export function MoveHarness({
  initial,
  context,
  fieldGroups = new Map(),
  blockCatalogs,
  errors = new Map(),
  probe,
}: {
  initial: BuilderField[];
  /** The rule's context, less what the harness reads from the outline. */
  context: MoveContext;
  fieldGroups?: ReadonlyMap<string, LoadedFieldGroup>;
  /** The blocks each blocks field accepts, so its block and prop rows are drawn. */
  blockCatalogs?: ReadonlyMap<string, BlockCatalog>;
  /** The fields' errors, as the page's validation reports them. */
  errors?: ReadonlyMap<string, BuilderFieldError>;
  probe: MoveHarnessProbe;
}): JSX.Element {
  const [fields, setFields] = useState(initial);
  // Selection as the page keeps it: the field whose settings are open.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  probe.fields = fields;
  probe.selectedId = selectedId;
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
    select: id => setSelectedId(id),
    addAt: target => {
      probe.addsAt.push(target);
    },
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
    <DndContext collisionDetection={crumbsByPointer}>
      <Outline
        kind="collection"
        nodes={nodes}
        systemFields={[]}
        errors={errors}
        foldKey="test:moves"
        selectedId={selectedId}
        readOnly={context.entityReadOnly}
        callbacks={callbacks}
        renderPreview={() => null}
      />
    </DndContext>
  );
}

/** A fresh probe for one test. */
export function newProbe(): MoveHarnessProbe {
  return { fields: [], commits: 0, selectedId: null, addsAt: [] };
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
