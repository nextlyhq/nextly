/**
 * The body of a written email: its blocks as cards, in place of the code
 * editor. Each card has a handle to drag, Move up and Move down, and a menu
 * with Duplicate and Remove (with Undo); Add block puts a new one at the end
 * of the email, or of a list. The edits themselves are `block-model.ts`'s.
 *
 * @module components/features/settings/EmailTemplateForm/written/WrittenBody
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@nextlyhq/ui";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import { useRef, type JSX, type MutableRefObject } from "react";

import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Plus,
} from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";
import type {
  WrittenBlock,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";

import {
  addBlock,
  duplicateBlock,
  moveBlock,
  moveBlockTo,
  removeBlock,
  restoreBlock,
  updateBlock,
  type BlockKind,
  type BlockPath,
} from "./block-model";
import { RunEditor } from "./RunEditor";
import { ChipNode, type Inline } from "./runs";

/**
 * Puts a chip for `variable` where the person was last typing; false when
 * no block has been typed in yet, so the caller can say where to click.
 */
export type InsertVariable = (variable: string) => boolean;

/** Each kind's name, as a card and the Add block menu show it. */
const KIND_NAMES: Record<BlockKind, string> = {
  heading: "Heading",
  text: "Text",
  button: "Button",
  image: "Image",
  divider: "Divider",
  spacer: "Spacer",
  list: "List",
};

/** The order Add block offers the kinds in, and what each is called there. */
const ADDABLE: ReadonlyArray<[BlockKind, string]> = [
  ["heading", "Heading"],
  ["text", "Text"],
  ["button", "Button"],
  ["image", "Image"],
  ["divider", "Divider"],
  ["spacer", "Spacer"],
  ["list", "List of items"],
];

/** A spacer's three heights, in pixels, as the brand's rhythm suggests. */
const SPACER_SIZES: ReadonlyArray<[string, number]> = [
  ["Small", 12],
  ["Medium", 24],
  ["Large", 48],
];

/** Plain text and chips only: what a heading, label or alt text stores. */
function plain<T>(runs: Inline[]): T[] {
  return runs.map(run =>
    run.type === "chip"
      ? {
          type: "chip",
          variable: run.variable,
          ...(run.fallback !== undefined ? { fallback: run.fallback } : {}),
        }
      : { type: "text", text: run.text }
  ) as T[];
}

interface Edit {
  /** Replace the document with `next`. */
  change: (next: WrittenDocument) => void;
  /** The document as it is now, for an Undo that runs after other edits. */
  current: () => WrittenDocument;
  readOnly: boolean;
  /** The declared list variables a list block can repeat over. */
  listVariables: readonly string[];
  /** Told which field's editor was typed in last. */
  focused: (editor: LexicalEditor) => void;
}

/** The fields of one block, by its kind. */
function BlockFields({
  block,
  path,
  edit,
}: {
  block: WrittenBlock;
  path: BlockPath;
  edit: Edit;
}): JSX.Element | null {
  const set = (next: WrittenBlock) =>
    edit.change(updateBlock(edit.current(), path, next));
  switch (block.type) {
    case "heading":
      return (
        <RunEditor
          label="Heading"
          placeholder="Write a heading"
          value={block.text}
          readOnly={edit.readOnly}
          onFocusEditor={edit.focused}
          onChange={text => set({ ...block, text: plain(text) })}
        />
      );
    case "text":
      return (
        <RunEditor
          rich
          label="Text"
          placeholder="Write something."
          value={block.text}
          readOnly={edit.readOnly}
          onFocusEditor={edit.focused}
          onChange={text => set({ ...block, text })}
        />
      );
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <RunEditor
            label="Button label"
            value={block.label}
            readOnly={edit.readOnly}
            onFocusEditor={edit.focused}
            onChange={label => set({ ...block, label: plain(label) })}
          />
          {"url" in block.link ? (
            <Input
              aria-label="Button link"
              placeholder="https://"
              value={block.link.url}
              readOnly={edit.readOnly}
              onChange={event =>
                set({ ...block, link: { url: event.target.value } })
              }
            />
          ) : (
            <p className="self-center text-sm text-muted-foreground">
              Links to [{block.link.chip.variable}]
            </p>
          )}
        </div>
      );
    case "image":
      return (
        <div className="grid gap-2">
          {"url" in block.src ? (
            <Input
              aria-label="Image address"
              placeholder="https://"
              value={block.src.url}
              readOnly={edit.readOnly}
              onChange={event =>
                set({ ...block, src: { url: event.target.value } })
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              The image at [{block.src.chip.variable}]
            </p>
          )}
          <RunEditor
            label="Alt text"
            placeholder="Describe the image"
            value={block.alt}
            readOnly={edit.readOnly}
            onFocusEditor={edit.focused}
            onChange={alt => set({ ...block, alt: plain(alt) })}
          />
          {block.alt.length === 0 ? (
            <p className="text-xs text-warning-text">
              No alt text: screen readers and blocked images show nothing.
            </p>
          ) : null}
        </div>
      );
    case "divider":
      return null;
    case "spacer":
      return (
        <div role="group" aria-label="Space" className="flex gap-1">
          {SPACER_SIZES.map(([name, height]) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={
                (block.height ?? 24) === height ? "secondary" : "outline"
              }
              aria-pressed={(block.height ?? 24) === height}
              disabled={edit.readOnly}
              onClick={() => set({ ...block, height })}
            >
              {name}
            </Button>
          ))}
        </div>
      );
    case "list":
      return (
        <div className="grid gap-3">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            For each item in
            <select
              aria-label="List variable"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={block.variable}
              disabled={edit.readOnly}
              onChange={event =>
                set({ ...block, variable: event.target.value })
              }
            >
              <option value="">Choose a list</option>
              {edit.listVariables.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-2">
            <BlockList blocks={block.blocks} list={path[0]} edit={edit} />
          </div>
        </div>
      );
  }
}

/** One block as a card: its handle, its kind, its moves and its menu. */
function BlockCard({
  id,
  block,
  path,
  isFirst,
  isLast,
  edit,
}: {
  id: string;
  block: WrittenBlock;
  path: BlockPath;
  isFirst: boolean;
  isLast: boolean;
  edit: Edit;
}): JSX.Element {
  const name = KIND_NAMES[block.type];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: edit.readOnly });
  const move = (by: -1 | 1) => edit.change(moveBlock(edit.current(), path, by));
  const remove = () => {
    const { doc, removed } = removeBlock(edit.current(), path);
    edit.change(doc);
    toast(`Removed the ${name.toLowerCase()} block`, {
      action: {
        label: "Undo",
        onClick: () => edit.change(restoreBlock(edit.current(), removed)),
      },
    });
  };
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={`${name} block`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // The card is the container its own layout answers to: a handle
        // column only where the card is wide enough to keep one.
        "group/block @container rounded-lg border border-border bg-card p-2",
        isDragging && "opacity-60"
      )}
    >
      <div className="grid grid-cols-1 gap-2 @[40rem]:grid-cols-[1.375rem_1fr]">
        {edit.readOnly ? (
          <span className="hidden @[40rem]:block" />
        ) : (
          <button
            ref={setActivatorNodeRef}
            type="button"
            title="Drag to move"
            className="hidden cursor-grab touch-none items-start justify-center pt-1 text-muted-foreground @[40rem]:flex"
            {...attributes}
            {...listeners}
            // Pointer and touch only: a keyboard moves a block with Move up and
            // Move down, which a screen reader announces.
            aria-hidden
            tabIndex={-1}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <div className="grid min-w-0 gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {name}
            </span>
            {edit.readOnly ? null : (
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  title="Move up"
                  disabled={isFirst}
                  onClick={() => move(-1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  title="Move down"
                  disabled={isLast}
                  onClick={() => move(1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for this ${name.toLowerCase()} block`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        edit.change(duplicateBlock(edit.current(), path).doc)
                      }
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={remove}
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          <BlockFields block={block} path={path} edit={edit} />
        </div>
      </div>
    </div>
  );
}

/** Add block: a new block of a kind at the end of the email, or of a list. */
function AddBlockMenu({
  list,
  edit,
}: {
  list: number | undefined;
  edit: Edit;
}): JSX.Element {
  const kinds =
    list === undefined ? ADDABLE : ADDABLE.filter(([k]) => k !== "list");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-fit">
          <Plus className="size-4" />
          {list === undefined ? "Add block" : "Add a block inside the list"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {kinds.map(([kind, label]) => (
          <DropdownMenuItem
            key={kind}
            onSelect={() =>
              edit.change(addBlock(edit.current(), kind, list).doc)
            }
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The blocks of the email, or of a list, in order, draggable among themselves. */
function BlockList({
  blocks,
  list,
  edit,
}: {
  blocks: readonly WrittenBlock[];
  list: number | undefined;
  edit: Edit;
}): JSX.Element {
  // Index ids: a block has no id of its own, and a drag only reorders
  // siblings, so the place is the identity while it lasts.
  const prefix = list === undefined ? "block" : `list-${list}-block`;
  const ids = blocks.map((_, i) => `${prefix}-${i}`);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const pathOf = (i: number): BlockPath =>
    list === undefined ? [i] : [list, i];
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    edit.change(moveBlockTo(edit.current(), pathOf(from), to));
  };
  return (
    <div className="grid gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {blocks.map((block, i) => (
            <BlockCard
              key={ids[i]}
              id={ids[i]}
              block={block}
              path={pathOf(i)}
              isFirst={i === 0}
              isLast={i === blocks.length - 1}
              edit={edit}
            />
          ))}
        </SortableContext>
      </DndContext>
      {edit.readOnly ? null : <AddBlockMenu list={list} edit={edit} />}
    </div>
  );
}

export interface WrittenBodyProps {
  value: WrittenDocument;
  onChange: (next: WrittenDocument) => void;
  readOnly?: boolean;
  /** The declared list variables a list block can repeat over. */
  listVariables?: readonly string[];
  /** Set to a way to put a variable where the person was last typing. */
  insertRef?: MutableRefObject<InsertVariable | null>;
}

export function WrittenBody({
  value,
  onChange,
  readOnly = false,
  listVariables = [],
  insertRef,
}: WrittenBodyProps): JSX.Element {
  // The field typed in last, where the Variables rail puts a chip.
  const lastEditor = useRef<LexicalEditor | null>(null);
  if (insertRef) {
    insertRef.current = variable => {
      const editor = lastEditor.current;
      if (!editor || readOnly) return false;
      editor.update(
        () => {
          const chip = new ChipNode(variable);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([chip]);
            return;
          }
          // No caret kept: at the end of what the field holds.
          const paragraph = $getRoot().getLastChild();
          if ($isElementNode(paragraph)) paragraph.append(chip);
          else $getRoot().append($createParagraphNode().append(chip));
        },
        { discrete: true }
      );
      return true;
    };
  }
  // The latest document, so an Undo after other edits restores into it.
  const latest = useRef(value);
  latest.current = value;
  const edit: Edit = {
    change: next => {
      latest.current = next;
      onChange(next);
    },
    current: () => latest.current,
    readOnly,
    listVariables,
    focused: editor => {
      lastEditor.current = editor;
    },
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Content</span> · The look
        comes from your brand settings.
      </p>
      <BlockList blocks={value.blocks} list={undefined} edit={edit} />
    </div>
  );
}
