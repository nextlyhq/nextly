## Summary

<!-- What does this PR do and why? Keep it short. -->

## Type of change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would change existing behavior)
- [ ] Documentation update
- [ ] Refactor / chore (no user-facing change)

## Related issues

<!-- e.g. Closes #123, Refs #456 -->

## Changeset

This repo uses [Changesets](https://github.com/changesets/changesets). A PR that changes a published package under `packages/*` includes **one** changeset that lists every package in the lockstep group, the `fixed` list in `.changeset/config.json` (private packages such as `@nextlyhq/tsconfig` included), with the bump `patch` while the packages are in alpha. A PR that changes no published package (tests, CI, docs or internal tooling only) gets none.

```bash
pnpm changeset
```

Then commit the generated `.changeset/*.md` file.

- [ ] I added one `patch` changeset covering the whole lockstep group (or this PR changes no published package)

> No CI job requires a changeset, so your reviewer checks it. CI does refuse a changeset you add that leaves out a package of the lockstep group, or uses a bump other than `patch`.

## Test plan

<!-- How did you verify this works? Commands run, scenarios tested, screenshots, etc. -->

- [ ] `pnpm lint`
- [ ] `pnpm check-types`
- [ ] `pnpm build`
- [ ] Manually verified the change

## Checklist

- [ ] I read [CONTRIBUTING](../CONTRIBUTING.md)
- [ ] My commits follow the [Conventional Commits](https://www.conventionalcommits.org/) spec (enforced by commitlint)
- [ ] I targeted the `main` branch
- [ ] I updated relevant documentation

## Screenshots / recordings

<!-- Optional. Drag images or videos here for UI changes. -->

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to? Migration risks, perf concerns, etc. -->
