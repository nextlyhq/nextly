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

This repo uses [Changesets](https://github.com/changesets/changesets). A PR that changes a published package under `packages/*` includes **one** changeset that lists every published package, since they version in lockstep, with the bump `patch` while the packages are in alpha. A PR that only changes tests, CI or docs gets none.

```bash
pnpm changeset
```

Then commit the generated `.changeset/*.md` file.

- [ ] I added one `patch` changeset covering every published package (or this PR only changes tests, CI or docs)

> No CI job requires a changeset, so your reviewer checks it. CI does refuse a changeset you add that leaves out a package of the lockstep group.

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
