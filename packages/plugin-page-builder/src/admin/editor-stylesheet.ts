/**
 * The editor's stylesheet, as a module of its own so the admin entry can
 * fetch it with the parts it styles (`withEditorStylesheet` in `index.ts`)
 * rather than with the entry, which every admin screen loads.
 *
 * Relative, and kept external by the build (`tsdown.config.ts`): the sheet is
 * copied into `dist/styles` rather than bundled, and the host's bundler loads
 * the copied file, resolving its `@import` of the builder's sheet as an app's
 * own import of it would.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor-stylesheet
 */
import "../styles/editor.css";
