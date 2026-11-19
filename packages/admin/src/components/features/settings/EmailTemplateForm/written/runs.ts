/**
 * A written block's text as the editor holds it, and back: the stored runs
 * (text with bold, italic and a link; chips for variables; line breaks inside
 * the text) become Lexical nodes, and the nodes become the same runs again,
 * so what is stored is exactly what the person sees.
 *
 * Chips and links are nodes of their own rather than Lexical's link node: a
 * link here may be a variable, which a URL can't hold, and a chip is one
 * piece that can't be typed into.
 *
 * @module components/features/settings/EmailTemplateForm/written/runs
 */
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  DecoratorNode,
  ElementNode,
  type Klass,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import type { WrittenBlock } from "@admin/services/emailTemplateApi";

/** One run of a text block: text with its marks, or a chip. */
export type Inline = Extract<WrittenBlock, { type: "text" }>["text"][number];

/** A link as stored: a fixed address, or a variable holding one. */
export type WrittenLink = NonNullable<Inline["link"]>;

/** A chip as stored: the variable and its fallback. */
type Chip = Extract<Inline, { type: "chip" }>;

/** The marks a run may carry besides its link. */
interface Marks {
  bold?: boolean;
  italic?: boolean;
}

type SerializedChipNode = Spread<
  { variable: string; fallback?: string; marks: Marks },
  SerializedLexicalNode
>;

/** A variable in the text: one piece, shown by name, that can't be typed into. */
export class ChipNode extends DecoratorNode<string> {
  __variable: string;
  __fallback: string | undefined;
  __marks: Marks;

  static getType(): string {
    return "written-chip";
  }

  static clone(node: ChipNode): ChipNode {
    return new ChipNode(
      node.__variable,
      node.__fallback,
      node.__marks,
      node.__key
    );
  }

  static importJSON(json: SerializedChipNode): ChipNode {
    return new ChipNode(json.variable, json.fallback, json.marks);
  }

  constructor(
    variable: string,
    fallback?: string,
    marks: Marks = {},
    key?: NodeKey
  ) {
    super(key);
    this.__variable = variable;
    this.__fallback = fallback;
    this.__marks = marks;
  }

  exportJSON(): SerializedChipNode {
    return {
      type: ChipNode.getType(),
      version: 1,
      variable: this.__variable,
      ...(this.__fallback !== undefined ? { fallback: this.__fallback } : {}),
      marks: this.__marks,
    };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.dataset.variable = this.__variable;
    // Its marks, as the sent email draws them: a chip is not a text node, so
    // the editor's text theme never reaches it.
    span.className = [
      this.__marks.bold ? "font-semibold" : "",
      this.__marks.italic ? "italic" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  /** The variable it stands for, as the editor shows it until names are known. */
  decorate(): string {
    return this.__variable;
  }
}

type SerializedWrittenLinkNode = Spread<
  { link: WrittenLink },
  SerializedElementNode
>;

/** A link around some text: a fixed address, or a variable holding one. */
export class WrittenLinkNode extends ElementNode {
  __link: WrittenLink;

  static getType(): string {
    return "written-link";
  }

  static clone(node: WrittenLinkNode): WrittenLinkNode {
    return new WrittenLinkNode(node.__link, node.__key);
  }

  static importJSON(json: SerializedWrittenLinkNode): WrittenLinkNode {
    return new WrittenLinkNode(json.link);
  }

  constructor(link: WrittenLink, key?: NodeKey) {
    super(key);
    this.__link = link;
  }

  exportJSON(): SerializedWrittenLinkNode {
    return {
      ...super.exportJSON(),
      type: WrittenLinkNode.getType(),
      link: this.__link,
    };
  }

  createDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = "underline";
    return a;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  canBeEmpty(): false {
    return false;
  }
}

/** The nodes an editor of written text registers. */
export const RUN_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  ChipNode,
  WrittenLinkNode,
];

/** Whether two links are the same address or the same variable. */
function sameLink(
  a: WrittenLink | undefined,
  b: WrittenLink | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A run's marks and link, as stored: only the ones it has. */
function decoration(
  marks: Marks,
  link: WrittenLink | undefined
): { bold?: true; italic?: true; link?: WrittenLink } {
  return {
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(link ? { link } : {}),
  };
}

/** The text nodes and line breaks for a run's text, with its marks. */
function textNodes(text: string, marks: Marks): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) nodes.push($createLineBreakNode());
    if (line.length === 0) return;
    const node = $createTextNode(line);
    if (marks.bold) node.toggleFormat("bold");
    if (marks.italic) node.toggleFormat("italic");
    nodes.push(node);
  });
  return nodes;
}

/** Replace the editor's content with `runs`. Call inside an update. */
export function $setRuns(runs: readonly Inline[]): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  let i = 0;
  while (i < runs.length) {
    const link = runs[i].link;
    // Neighbours with the same link sit inside one link node.
    let j = i;
    while (j < runs.length && sameLink(runs[j].link, link)) j++;
    const nodes = runs.slice(i, j).flatMap(run => {
      const marks = { bold: run.bold, italic: run.italic };
      return run.type === "chip"
        ? [new ChipNode(run.variable, run.fallback, marks)]
        : textNodes(run.text, marks);
    });
    if (link) {
      const holder = new WrittenLinkNode(link);
      holder.append(...nodes);
      paragraph.append(holder);
    } else {
      paragraph.append(...nodes);
    }
    i = j;
  }
  root.append(paragraph);
}

/** Append `run`, joining it to the last run when their marks and link match. */
function push(out: Inline[], run: Inline): void {
  const last = out[out.length - 1];
  if (
    run.type === "text" &&
    last?.type === "text" &&
    !!last.bold === !!run.bold &&
    !!last.italic === !!run.italic &&
    sameLink(last.link, run.link)
  ) {
    out[out.length - 1] = { ...last, text: last.text + run.text };
    return;
  }
  out.push(run);
}

/** The runs of `node`, inside a link when `link` is set. */
function collect(
  node: LexicalNode,
  link: WrittenLink | undefined,
  out: Inline[]
): void {
  if (node instanceof WrittenLinkNode) {
    for (const child of node.getChildren()) collect(child, node.__link, out);
  } else if (node instanceof ChipNode) {
    const chip: Chip = {
      type: "chip",
      variable: node.__variable,
      ...(node.__fallback !== undefined ? { fallback: node.__fallback } : {}),
      ...decoration(node.__marks, link),
    };
    out.push(chip);
  } else if ($isLineBreakNode(node)) {
    push(out, { type: "text", text: "\n", ...decoration({}, link) });
  } else if ($isTextNode(node)) {
    const text = node.getTextContent();
    if (text.length === 0) return;
    const marks = {
      bold: node.hasFormat("bold"),
      italic: node.hasFormat("italic"),
    };
    push(out, { type: "text", text, ...decoration(marks, link) });
  } else if ($isElementNode(node)) {
    for (const child of node.getChildren()) collect(child, link, out);
  }
}

/** The editor's content as runs. Call inside a read or an update. */
export function $readRuns(): Inline[] {
  const out: Inline[] = [];
  $getRoot()
    .getChildren()
    .forEach((paragraph, i) => {
      // A new paragraph (Enter) is a line break in the stored text.
      if (i > 0) push(out, { type: "text", text: "\n" });
      collect(paragraph, undefined, out);
    });
  return out;
}
