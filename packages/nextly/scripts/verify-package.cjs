#!/usr/bin/env node
/**
 * Verify package is ready for publishing
 * Run this before `npm publish`
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

console.log('Verifying package before publish...\n');

const checks = {
  pass: 0,
  fail: 0,
  warnings: 0
};

function pass(msg) {
  console.log(`${msg}`);
  checks.pass++;
}

function fail(msg) {
  console.error(` ${msg}`);
  checks.fail++;
}

function warn(msg) {
  console.warn(` ${msg}`);
  checks.warnings++;
}

// Check 1: dist/ exists
if (existsSync(join(__dirname, '..', 'dist'))) {
  pass('dist/ directory exists');
} else {
  fail('dist/ directory not found - run `pnpm build` first');
}

// Check 2: Migrations exist in dist
const postgresqlMigrations = join(__dirname, '..', 'dist', 'migrations', 'postgresql');
const mysqlMigrations = join(__dirname, '..', 'dist', 'migrations', 'mysql');

if (existsSync(postgresqlMigrations)) {
  pass('PostgreSQL migrations found in dist/');
} else {
  fail('PostgreSQL migrations NOT found in dist/migrations/postgresql/');
}

if (existsSync(mysqlMigrations)) {
  pass('MySQL migrations found in dist/');
} else {
  fail('MySQL migrations NOT found in dist/migrations/mysql/');
}

// Check 3: _journal.json files exist
const postgresqlJournal = join(postgresqlMigrations, 'meta', '_journal.json');
const mysqlJournal = join(mysqlMigrations, 'meta', '_journal.json');

if (existsSync(postgresqlJournal)) {
  pass('PostgreSQL _journal.json exists');
} else {
  fail('PostgreSQL meta/_journal.json NOT found');
}

if (existsSync(mysqlJournal)) {
  pass('MySQL _journal.json exists');
} else {
  fail('MySQL meta/_journal.json NOT found');
}

// Check 4: Main entry points exist (ESM-only)
const mainMjs = join(__dirname, '..', 'dist', 'index.mjs');
const mainDts = join(__dirname, '..', 'dist', 'index.d.ts');

if (existsSync(mainMjs)) {
  pass('dist/index.mjs exists');
} else {
  fail('dist/index.mjs NOT found');
}

if (existsSync(mainDts)) {
  pass('dist/index.d.ts exists');
} else {
  fail('dist/index.d.ts NOT found');
}

// Check 5: npm pack dry-run
console.log('\n Checking npm pack output...');
try {
  const packOutput = execSync('npm pack --dry-run 2>&1', { encoding: 'utf-8' });

  if (packOutput.includes('migrations/postgresql')) {
    pass('PostgreSQL migrations will be included in package');
  } else {
    fail('PostgreSQL migrations will NOT be included in package');
  }

  if (packOutput.includes('migrations/mysql')) {
    pass('MySQL migrations will be included in package');
  } else {
    fail('MySQL migrations will NOT be included in package');
  }

  if (packOutput.includes('_journal.json')) {
    pass('Migration journal files will be included');
  } else {
    fail('Migration journal files will NOT be included');
  }

  // Check package size
  const sizeMatch = packOutput.match(/Unpacked size:\s+([\d.]+\s+\w+)/);
  if (sizeMatch) {
    console.log(`\n Package size: ${sizeMatch[1]}`);
  }
} catch (error) {
  fail(`npm pack check failed: ${error.message}`);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log(` Passed: ${checks.pass}`);
if (checks.warnings > 0) {
  console.log(` Warnings: ${checks.warnings}`);
}
if (checks.fail > 0) {
  console.log(` Failed: ${checks.fail}`);
  console.log('\n Package verification FAILED - DO NOT PUBLISH');
  process.exit(1);
} else {
  console.log('\n Package verification PASSED - Ready to publish!');
  console.log('\nNext steps:');
  console.log('  npm version patch  # or minor/major');
  console.log('  npm publish');
  process.exit(0);
}
