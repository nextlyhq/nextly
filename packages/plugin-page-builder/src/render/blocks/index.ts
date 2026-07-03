/**
 * Registers the 7 built-in block renderers into `defaultBlockRegistry` as a side
 * effect. Importing this (done by the "./render" entry) makes them available to
 * PageRenderer and — later — the editor canvas.
 */
export { paragraph } from "./paragraph";
export { heading } from "./heading";
export { image } from "./image";
export { button } from "./button";
export { video } from "./video";
export { container } from "./container";
export { grid } from "./grid";
