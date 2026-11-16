/**
 * Work shared within one batch, for one caller.
 *
 * `getOrCompute` runs `compute` the first time a key is asked for and hands every
 * later asker, concurrent ones included, the same in-flight promise: two cards
 * reading the same scan share one scan. A computation that rejects is not kept,
 * so a later asker runs it again rather than inheriting one failure for the
 * whole batch.
 *
 * 🔴 A module of its own, importing nothing: `defineWidget` names it in what a
 * data function is handed, and everything a declaration's types reach is
 * compiled by whoever reads a declaration, the admin's tests among them. In
 * the source registry it drew in the read services and the auth layer behind
 * them.
 *
 * @experimental
 * @module domains/widgets/widget-scope
 */
export interface WidgetScope {
  getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T>;
}
