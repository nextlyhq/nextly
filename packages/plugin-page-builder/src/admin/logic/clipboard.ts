"use client";

/** Session clipboard for block copy/paste + copy-style/paste-style (spec §K). */
import type { BlockNode } from "../../core/types";

interface StyleClip {
  style?: BlockNode["style"];
  styleHover?: BlockNode["styleHover"];
}

let nodeClip: BlockNode | null = null;
let styleClip: StyleClip | null = null;

export const clipboard = {
  copyNode(n: BlockNode) {
    nodeClip = structuredClone(n);
  },
  getNode(): BlockNode | null {
    return nodeClip;
  },
  copyStyle(n: BlockNode) {
    styleClip = {
      style: n.style ? structuredClone(n.style) : undefined,
      styleHover: n.styleHover ? structuredClone(n.styleHover) : undefined,
    };
  },
  getStyle(): StyleClip | null {
    return styleClip;
  },
};
