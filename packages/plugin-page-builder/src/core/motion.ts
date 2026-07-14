/**
 * Entrance motion (spec §5). Isomorphic, React-free. Compiles a node's `motion`
 * config into CSS: a shared set of keyframes + a per-node animation rule wrapped in
 * `prefers-reduced-motion: no-preference` so it never fires for users who opt out.
 *
 * Entrance animations run on load (SSR-safe, zero-runtime). A scroll-triggered replay
 * runtime is an optional enhancement layered on top via `data-nx-motion`.
 */
import type { BlockNode } from "./types";

export interface MotionConfig {
  /** Animation name from MOTION_ANIMATIONS, or "none". */
  entrance?: string;
  /** e.g. "600ms" or "0.6s". Validated before emission. */
  duration?: string;
  /** e.g. "0ms". Validated before emission. */
  delay?: string;
}

export const MOTION_ANIMATIONS = [
  "none",
  "fade-in",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "zoom-in",
];

/** Shared keyframes, emitted once per page when any block animates. */
export const MOTION_KEYFRAMES = [
  "@keyframes nx-fade-in{from{opacity:0}to{opacity:1}}",
  "@keyframes nx-slide-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}",
  "@keyframes nx-slide-down{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}",
  "@keyframes nx-slide-left{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}",
  "@keyframes nx-slide-right{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}",
  "@keyframes nx-zoom-in{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:none}}",
].join("\n");

const TIME_RE = /^\d+(?:\.\d+)?m?s$/;

function safeTime(v: string | undefined, fallback: string): string {
  return v && TIME_RE.test(v) ? v : fallback;
}

/** Compile a node's entrance animation to a CSS rule (empty when none/invalid). */
export function compileMotionCss(node: BlockNode, cls: string): string {
  const m = node.motion;
  if (!m || !m.entrance || m.entrance === "none") return "";
  if (!MOTION_ANIMATIONS.includes(m.entrance)) return "";
  const dur = safeTime(m.duration, "600ms");
  const delay = safeTime(m.delay, "0ms");
  return `@media (prefers-reduced-motion: no-preference) { .${cls} { animation: nx-${m.entrance} ${dur} ease ${delay} both; } }`;
}
