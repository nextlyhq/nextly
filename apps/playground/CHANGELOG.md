# playground

## 0.1.2-alpha.1

### Patch Changes

- [#126](https://github.com/nextlyhq/nextly/pull/126) [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - parseMediaRoute had no case for the 'bulk' segment, so DELETE /api/media/bulk fell through to the single-item path and treated 'bulk' as a mediaId, causing a 404 from the database.

- Updated dependencies [[`4f86e82`](https://github.com/nextlyhq/nextly/commit/4f86e82cfea10911fef89ecde14a8a42ec4f0397), [`29d5ba5`](https://github.com/nextlyhq/nextly/commit/29d5ba5c8e821593a63d72107f49885d036bf5ca)]:
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.27
  - @nextlyhq/adapter-mysql@0.0.2-alpha.27
  - @nextlyhq/adapter-postgres@0.0.2-alpha.27
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.27
  - @nextlyhq/admin@0.0.2-alpha.27
  - nextly@0.0.2-alpha.27

## 0.1.2-alpha.0

### Patch Changes

- Updated dependencies [[`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e)]:
  - nextly@0.0.2-alpha.0
  - @nextlyhq/admin@0.0.2-alpha.0
  - @nextlyhq/adapter-drizzle@0.0.2-alpha.0
  - @nextlyhq/adapter-postgres@0.0.2-alpha.0
  - @nextlyhq/adapter-mysql@0.0.2-alpha.0
  - @nextlyhq/adapter-sqlite@0.0.2-alpha.0
