/**
 * `CSS.escape`, which jsdom does not implement and the editor calls wherever
 * it finds an element by an id placed in a quoted attribute selector: the
 * chip a pick hands focus to, the visitor badge it measures, the variable row
 * it scrolls to. Without it those paths throw inside an event handler or a
 * layout effect, which reads as a failure of whatever was being tested.
 *
 * A stub rather than a polyfill: every caller puts the result between quotes,
 * where only a quote and a backslash need escaping. Installed only where there
 * is a DOM and it has none, so a real implementation is never replaced, and
 * the node suites are untouched.
 */
if (
  typeof document !== "undefined" &&
  (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape === undefined
) {
  Object.defineProperty(globalThis, "CSS", {
    value: {
      ...(globalThis as { CSS?: object }).CSS,
      escape: (text: string): string => text.replace(/["\\]/g, "\\$&"),
    },
    configurable: true,
  });
}
