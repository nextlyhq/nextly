#!/bin/bash

# Nextly Yalc Publishing Script
# This script builds and publishes all packages to yalc in the correct dependency order

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the root directory of the monorepo
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}           Nextly Yalc Publishing Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if yalc is installed
if ! command -v yalc &> /dev/null; then
    echo -e "${RED}Error: yalc is not installed${NC}"
    echo -e "Install it with: ${YELLOW}npm install -g yalc${NC}"
    exit 1
fi

# Function to publish a package
publish_package() {
    local pkg_path="$1"
    local pkg_name="$2"

    if [ -d "$ROOT_DIR/$pkg_path" ]; then
        echo -e "${YELLOW}Publishing ${pkg_name}...${NC}"
        cd "$ROOT_DIR/$pkg_path"
        yalc publish --push
        echo -e "${GREEN}✓ Published ${pkg_name}${NC}"
        cd "$ROOT_DIR"
    else
        echo -e "${RED}✗ Package not found: ${pkg_path}${NC}"
    fi
}

# Parse arguments
SKIP_BUILD=false
PACKAGES_ONLY=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --skip-build) SKIP_BUILD=true ;;
        --packages) PACKAGES_ONLY="$2"; shift ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --skip-build    Skip the build step (use existing dist)"
            echo "  --packages      Comma-separated list of packages to publish"
            echo "                  Example: --packages nextly,admin"
            echo "  -h, --help      Show this help message"
            echo ""
            echo "Available packages:"
            echo "  adapter-drizzle, adapter-mysql, adapter-postgres, adapter-sqlite"
            echo "  nextly, admin, client, ui"
            echo "  storage-s3, storage-vercel-blob"
            echo "  plugin-form-builder, create-nextly-app"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Step 1: Build all packages (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
    echo -e "${BLUE}Step 1: Building all packages...${NC}"
    echo ""
    cd "$ROOT_DIR"
    pnpm build
    echo ""
    echo -e "${GREEN}✓ Build complete${NC}"
    echo ""
else
    echo -e "${YELLOW}Skipping build step (--skip-build flag)${NC}"
    echo ""
fi

# Step 2: Publish packages in dependency order
echo -e "${BLUE}Step 2: Publishing packages to yalc...${NC}"
echo ""

# Define packages in dependency order
declare -a TIER1=("packages/adapter-drizzle:@revnixhq/adapter-drizzle" "packages/client:@revnixhq/client" "packages/ui:@revnixhq/ui")
declare -a TIER2=("packages/adapter-mysql:@revnixhq/adapter-mysql" "packages/adapter-postgres:@revnixhq/adapter-postgres" "packages/adapter-sqlite:@revnixhq/adapter-sqlite")
declare -a TIER3=("packages/nextly:@revnixhq/nextly")
declare -a TIER4=("packages/admin:@revnixhq/admin" "packages/storage-s3:@revnixhq/storage-s3" "packages/storage-vercel-blob:@revnixhq/storage-vercel-blob" "packages/plugin-form-builder:@nextly/plugin-form-builder")
declare -a TIER5=("packages/create-nextly-app:@revnixhq/create-nextly-app")

# Function to check if package should be published
should_publish() {
    local pkg_short_name="$1"
    if [ -z "$PACKAGES_ONLY" ]; then
        return 0  # Publish all if no filter
    fi
    if [[ ",$PACKAGES_ONLY," == *",$pkg_short_name,"* ]]; then
        return 0
    fi
    return 1
}

# Publish Tier 1 - Foundation packages (no internal deps)
echo -e "${BLUE}Tier 1: Foundation packages${NC}"
for pkg in "${TIER1[@]}"; do
    IFS=':' read -r path name <<< "$pkg"
    short_name=$(basename "$path")
    if should_publish "$short_name"; then
        publish_package "$path" "$name"
    fi
done
echo ""

# Publish Tier 2 - Database adapters
echo -e "${BLUE}Tier 2: Database adapters${NC}"
for pkg in "${TIER2[@]}"; do
    IFS=':' read -r path name <<< "$pkg"
    short_name=$(basename "$path")
    if should_publish "$short_name"; then
        publish_package "$path" "$name"
    fi
done
echo ""

# Publish Tier 3 - Core
echo -e "${BLUE}Tier 3: Core package${NC}"
for pkg in "${TIER3[@]}"; do
    IFS=':' read -r path name <<< "$pkg"
    short_name=$(basename "$path")
    if should_publish "$short_name"; then
        publish_package "$path" "$name"
    fi
done
echo ""

# Publish Tier 4 - High-level packages
echo -e "${BLUE}Tier 4: High-level packages${NC}"
for pkg in "${TIER4[@]}"; do
    IFS=':' read -r path name <<< "$pkg"
    short_name=$(basename "$path")
    if should_publish "$short_name"; then
        publish_package "$path" "$name"
    fi
done
echo ""

# Publish Tier 5 - CLI
echo -e "${BLUE}Tier 5: CLI${NC}"
for pkg in "${TIER5[@]}"; do
    IFS=':' read -r path name <<< "$pkg"
    short_name=$(basename "$path")
    if should_publish "$short_name"; then
        publish_package "$path" "$name"
    fi
done
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}All packages published to yalc!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. To test create-nextly-app CLI:"
echo -e "   ${BLUE}mkdir ~/nextly-test && cd ~/nextly-test${NC}"
echo -e "   ${BLUE}yalc add @revnixhq/create-nextly-app${NC}"
echo -e "   ${BLUE}npx create-nextly-app my-app${NC}"
echo ""
echo "2. To add packages to an existing Next.js app:"
echo -e "   ${BLUE}cd /path/to/your/nextjs-app${NC}"
echo -e "   ${BLUE}yalc add @revnixhq/nextly @revnixhq/admin${NC}"
echo -e "   ${BLUE}yalc add @revnixhq/adapter-postgres${NC}  # or mysql/sqlite"
echo ""
echo "3. To update packages after changes:"
echo -e "   ${BLUE}./scripts/yalc-publish.sh --skip-build${NC}  # if already built"
echo -e "   ${BLUE}./scripts/yalc-publish.sh${NC}               # full rebuild"
echo ""
echo "4. To remove yalc links from a project:"
echo -e "   ${BLUE}yalc remove --all${NC}"
echo ""
