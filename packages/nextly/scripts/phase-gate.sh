#!/usr/bin/env bash
# Phase Gate Script — Plan 23: Nextly Package Refactor
#
# Runs all verification checks after each phase. Compares results against
# known baselines so only NEW regressions cause failure.
#
# Usage: bash scripts/phase-gate.sh
#
# Exit codes:
#   0 — No new regressions
#   1 — New regressions detected

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PACKAGE_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── Baselines (Phase 0, recorded 2026-04-10) ───
# These are pre-existing issues, NOT caused by refactoring.
# The gate fails only if counts INCREASE beyond these baselines.
BASELINE_TS_ERRORS=8        # TS2742 in test-setup.ts
BASELINE_LINT_WARNINGS=3118 # Mostly .tsup/declaration/ artifacts
BASELINE_TEST_FAILURES=610  # Tests requiring DATABASE_URL (updated Phase 5: includes all workspace tests)

NEW_REGRESSIONS=0
RESULTS=()

echo "========================================="
echo "  Plan 23 Phase Gate"
echo "  Package: @revnixhq/nextly"
echo "  Date: $(date -Iseconds)"
echo "========================================="

# ─── 1. Type Check ───
echo -e "\n${YELLOW}=== Type Check (tsc --noEmit) ===${NC}"
TS_OUTPUT=$(pnpm check-types 2>&1 || true)
TS_ERRORS=$(echo "$TS_OUTPUT" | grep -c "error TS" || true)

if [ "$TS_ERRORS" -le "$BASELINE_TS_ERRORS" ]; then
  echo -e "${GREEN}PASS: Type Check — $TS_ERRORS errors (baseline: $BASELINE_TS_ERRORS)${NC}"
  RESULTS+=("PASS: Type Check — $TS_ERRORS errors (baseline: $BASELINE_TS_ERRORS)")
else
  NEW_COUNT=$((TS_ERRORS - BASELINE_TS_ERRORS))
  echo -e "${RED}FAIL: Type Check — $TS_ERRORS errors ($NEW_COUNT NEW, baseline: $BASELINE_TS_ERRORS)${NC}"
  echo "$TS_OUTPUT" | grep "error TS" | tail -20
  RESULTS+=("FAIL: Type Check — $NEW_COUNT new errors")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── 2. Lint ───
echo -e "\n${YELLOW}=== Lint (eslint) ===${NC}"
LINT_OUTPUT=$(pnpm lint 2>&1 || true)
# Strip ANSI codes, then parse "N problems" from the summary line
LINT_CLEAN=$(echo "$LINT_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
LINT_WARNINGS=$(echo "$LINT_CLEAN" | grep -oP '\d+(?= problems)' | tail -1 || echo "0")

if [ "$LINT_WARNINGS" -le "$BASELINE_LINT_WARNINGS" ]; then
  echo -e "${GREEN}PASS: Lint — $LINT_WARNINGS warnings (baseline: $BASELINE_LINT_WARNINGS)${NC}"
  RESULTS+=("PASS: Lint — $LINT_WARNINGS warnings (baseline: $BASELINE_LINT_WARNINGS)")
else
  NEW_COUNT=$((LINT_WARNINGS - BASELINE_LINT_WARNINGS))
  echo -e "${RED}FAIL: Lint — $LINT_WARNINGS warnings ($NEW_COUNT NEW, baseline: $BASELINE_LINT_WARNINGS)${NC}"
  RESULTS+=("FAIL: Lint — $NEW_COUNT new warnings")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── 3. Tests ───
echo -e "\n${YELLOW}=== Tests (vitest) ===${NC}"
TEST_OUTPUT=$(pnpm test 2>&1 || true)
# Strip ANSI codes, then parse the "Tests" summary line (not "Test Files")
TEST_CLEAN=$(echo "$TEST_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
TEST_FAILURES=$(echo "$TEST_CLEAN" | grep "^      Tests" | grep -oP '\d+(?= failed)' || echo "0")
TEST_PASSED=$(echo "$TEST_CLEAN" | grep "^      Tests" | grep -oP '\d+(?= passed)' || echo "0")

if [ "$TEST_FAILURES" -le "$BASELINE_TEST_FAILURES" ]; then
  echo -e "${GREEN}PASS: Tests — $TEST_FAILURES failures (baseline: $BASELINE_TEST_FAILURES), $TEST_PASSED passed${NC}"
  RESULTS+=("PASS: Tests — $TEST_FAILURES failures (baseline: $BASELINE_TEST_FAILURES)")
else
  NEW_COUNT=$((TEST_FAILURES - BASELINE_TEST_FAILURES))
  echo -e "${RED}FAIL: Tests — $TEST_FAILURES failures ($NEW_COUNT NEW, baseline: $BASELINE_TEST_FAILURES)${NC}"
  RESULTS+=("FAIL: Tests — $NEW_COUNT new failures")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── 4. Build ───
echo -e "\n${YELLOW}=== Build (tsup + tsc + rollup-dts + postbuild) ===${NC}"
if pnpm build 2>&1; then
  echo -e "${GREEN}PASS: Build${NC}"
  RESULTS+=("PASS: Build")
else
  echo -e "${RED}FAIL: Build${NC}"
  RESULTS+=("FAIL: Build")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── 5. Export Verification ───
echo -e "\n${YELLOW}=== Export Verification ===${NC}"
if npx tsx scripts/verify-exports.ts 2>&1; then
  echo -e "${GREEN}PASS: Export Verification${NC}"
  RESULTS+=("PASS: Export Verification")
else
  echo -e "${RED}FAIL: Export Verification${NC}"
  RESULTS+=("FAIL: Export Verification — missing exports detected")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── 6. DTS Verification ───
echo -e "\n${YELLOW}=== DTS Verification ===${NC}"
if npx tsx scripts/verify-dts.ts 2>&1; then
  echo -e "${GREEN}PASS: DTS Verification${NC}"
  RESULTS+=("PASS: DTS Verification")
else
  echo -e "${RED}FAIL: DTS Verification${NC}"
  RESULTS+=("FAIL: DTS Verification — bundled declarations missing or broken")
  NEW_REGRESSIONS=$((NEW_REGRESSIONS + 1))
fi

# ─── Summary ───
echo ""
echo "========================================="
echo "  Phase Gate Results"
echo "========================================="
for result in "${RESULTS[@]}"; do
  if [[ "$result" == PASS* ]]; then
    echo -e "  ${GREEN}$result${NC}"
  else
    echo -e "  ${RED}$result${NC}"
  fi
done
echo ""
echo -e "  ${CYAN}Baselines: TS=$BASELINE_TS_ERRORS errors, Lint=$BASELINE_LINT_WARNINGS warnings, Tests=$BASELINE_TEST_FAILURES failures${NC}"
echo "========================================="

if [ "$NEW_REGRESSIONS" -gt 0 ]; then
  echo -e "\n${RED}Phase gate FAILED — $NEW_REGRESSIONS new regression(s) detected.${NC}"
  exit 1
else
  echo -e "\n${GREEN}Phase gate PASSED — no new regressions.${NC}"
  exit 0
fi
