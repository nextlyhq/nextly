/**
 * What a plugin's dashboard widget component is handed, and the shapes its data
 * arrives in.
 *
 * 🔴 Its OWN subpath rather than the root barrel. `index.ts` re-exports VALUES
 * from bare `nextly` — `definePlugin`, `NextlyError`, the field builders — so
 * evaluating it loads the whole package, and a plugin that wanted nothing but a
 * type would pay for the Direct API graph to get it. Reached through
 * `@nextlyhq/plugin-sdk/widgets`, these cost nothing: the module behind them
 * emits a zero-byte runtime chunk.
 *
 * The wire shapes are RE-EXPORTED from core rather than restated. They describe
 * what the server sends, so the server declares them; the admin and every
 * plugin are consumers of one definition. Each of those three used to carry its
 * own copy, and the copies had already drifted.
 *
 * Every export here is `@experimental`: they describe the widget contract, and
 * that contract graduates only when a first-party plugin source has exercised
 * it (D55). `STABILITY.md` is the authoritative ledger and lists them.
 *
 * @module widgets
 */

/**
 * @experimental The widget component contract and the shapes its data arrives
 * in. No compatibility guarantee until `contributes.admin.widgets` graduates.
 */
export type {
  WidgetComponentProps,
  WidgetQueryBatchResponse,
  WidgetResult,
  WidgetResultField,
  WidgetSlot,
} from "nextly/widget-result";
