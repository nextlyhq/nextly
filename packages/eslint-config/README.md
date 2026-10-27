# @nextlyhq/eslint-config

> Internal package. Not published to npm. Empty on purpose.

This held the repository's shared ESLint configuration. Nothing uses it any
more: the repository lints with oxlint (`oxlint.config.mjs`), and a scaffolded
plugin's lint config ships in its template (`templates/plugin/eslint.config.mjs`).

## Why it is still here

Every pending changeset in `.changeset/` names `@nextlyhq/eslint-config`, the
consumed pre-release ones included, and Changesets refuses to plan a release
while a changeset names a package the workspace does not have. Removing the
package would mean rewriting each of those changesets, so it stays as a
`package.json` with no code and no dependencies, and stays in the `fixed` group.

## When it goes

In the first pull request after the alpha pre-release ends, once
`changeset version` has consumed the backlog of changesets. That pull request
deletes this directory and its entry in `.changeset/config.json`, and touches no
changeset.
