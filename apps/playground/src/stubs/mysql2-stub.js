// Empty mysql2 module shim. Turbopack's resolveAlias points
// `mysql2` and `mysql2/promise` here so workspace packages that import
// mysql2 conditionally (drizzle-orm, adapter-mysql) don't break the
// build when the playground is using SQLite or Postgres. The dialect
// switcher handles real mysql2 wiring when DB_DIALECT=mysql.
module.exports = {};
