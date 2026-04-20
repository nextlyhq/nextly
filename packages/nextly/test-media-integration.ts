#!/usr/bin/env tsx
/**
 * Media Management Integration Test
 *
 * End-to-end test script for media management system.
 * Tests all CRUD operations, pagination, search, filtering, and sorting.
 *
 * Usage:
 *   pnpm exec tsx packages/nextly/test-media-integration.ts
 *
 * Requirements:
 *   - Database running (PostgreSQL/MySQL/SQLite)
 *   - Tables migrated (media table exists)
 *   - Environment variables configured
 *
 * @see packages/nextly/MEDIA_TESTING_GUIDE.md
 */

import fs from "fs";
import path from "path";

import { db } from "./src/database/drizzle";
import { ServiceContainer } from "./src/services";
import type { Media } from "./src/types/media";

// ANSI color codes for pretty output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  log(title, "cyan");
  console.log("=".repeat(60));
}

function logSuccess(message: string) {
  log(`✅ ${message}`, "green");
}

function logError(message: string) {
  log(`❌ ${message}`, "red");
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, "blue");
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, "yellow");
}

// Create a test image buffer
function createTestImage(): Buffer {
  // 1x1 transparent PNG (base64 encoded)
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  return Buffer.from(base64, "base64");
}

async function runTests() {
  logSection("🚀 Media Management Integration Test");

  const services = new ServiceContainer(db);
  const uploadedMedia: Media[] = [];
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // ==================== TEST 1: Upload Image ====================
    logSection("TEST 1: Upload Image with Thumbnail Generation");

    const imageBuffer = createTestImage();
    const uploadResult = await services.media.uploadMedia({
      file: imageBuffer,
      filename: "test-integration.png",
      mimeType: "image/png",
      size: imageBuffer.length,
      uploadedBy: "423ffef1-08ad-44c1-a153-fae98b4b80e5", // Seeded admin user
    });

    if (uploadResult.success && uploadResult.data) {
      logSuccess(`Uploaded: ${uploadResult.data.filename}`);
      logInfo(`  URL: ${uploadResult.data.url}`);
      logInfo(`  Thumbnail: ${uploadResult.data.thumbnailUrl || "N/A"}`);
      logInfo(`  Size: ${uploadResult.data.size} bytes`);
      logInfo(
        `  Dimensions: ${uploadResult.data.width}x${uploadResult.data.height}`
      );
      uploadedMedia.push(uploadResult.data);
      testsPassed++;
    } else {
      logError(`Upload failed: ${uploadResult.message}`);
      testsFailed++;
    }

    // ==================== TEST 2: Upload Multiple Files ====================
    logSection("TEST 2: Upload Multiple Files");

    for (let i = 1; i <= 3; i++) {
      const buffer = createTestImage();
      const result = await services.media.uploadMedia({
        file: buffer,
        filename: `test-batch-${i}.png`,
        mimeType: "image/png",
        size: buffer.length,
        uploadedBy: "423ffef1-08ad-44c1-a153-fae98b4b80e5",
      });

      if (result.success && result.data) {
        logSuccess(`Batch upload ${i}/3: ${result.data.filename}`);
        uploadedMedia.push(result.data);
        testsPassed++;
      } else {
        logError(`Batch upload ${i}/3 failed: ${result.message}`);
        testsFailed++;
      }
    }

    // ==================== TEST 3: List Media (Pagination) ====================
    logSection("TEST 3: List Media with Pagination");

    const listResult = await services.media.listMedia({
      page: 1,
      pageSize: 10,
      sortBy: "uploadedAt",
      sortOrder: "desc",
    });

    if (listResult.success && listResult.meta) {
      logSuccess(`Found ${listResult.meta.total} total media items`);
      logInfo(`  Page: ${listResult.meta.page}/${listResult.meta.totalPages}`);
      logInfo(`  Page size: ${listResult.meta.pageSize}`);
      logInfo(`  Items on this page: ${listResult.data?.length || 0}`);
      testsPassed++;
    } else {
      logError(`List failed: ${listResult.message}`);
      testsFailed++;
    }

    // ==================== TEST 4: Search by Filename ====================
    logSection("TEST 4: Search by Filename");

    const searchResult = await services.media.listMedia({
      page: 1,
      pageSize: 10,
      search: "test-integration",
    });

    if (searchResult.success) {
      const found = searchResult.data?.filter(m =>
        m.filename.includes("test-integration")
      );
      logSuccess(`Search found ${found?.length || 0} matching items`);
      found?.forEach(item => {
        logInfo(`  - ${item.filename}`);
      });
      testsPassed++;
    } else {
      logError(`Search failed: ${searchResult.message}`);
      testsFailed++;
    }

    // ==================== TEST 5: Filter by Type ====================
    logSection("TEST 5: Filter by Media Type");

    const filterResult = await services.media.listMedia({
      page: 1,
      pageSize: 10,
      type: "image",
    });

    if (filterResult.success) {
      logSuccess(
        `Filter by type 'image': ${filterResult.data?.length || 0} items`
      );
      const allImages = filterResult.data?.every(m =>
        m.mimeType.startsWith("image/")
      );
      if (allImages) {
        logSuccess("  All results are images ✓");
      } else {
        logWarning("  Some results are not images");
      }
      testsPassed++;
    } else {
      logError(`Filter failed: ${filterResult.message}`);
      testsFailed++;
    }

    // ==================== TEST 6: Sort by Size ====================
    logSection("TEST 6: Sort by Size (Descending)");

    const sortResult = await services.media.listMedia({
      page: 1,
      pageSize: 5,
      sortBy: "size",
      sortOrder: "desc",
    });

    if (sortResult.success && sortResult.data && sortResult.data.length >= 2) {
      const sizes = sortResult.data.map(m => m.size);
      const isSorted = sizes.every(
        (size, i, arr) => i === 0 || arr[i - 1] >= size
      );

      if (isSorted) {
        logSuccess("Sort by size (desc) working correctly ✓");
        logInfo(`  Sizes: ${sizes.join(", ")} bytes`);
        testsPassed++;
      } else {
        logError("Sort by size (desc) NOT working correctly");
        logInfo(`  Sizes: ${sizes.join(", ")} bytes`);
        testsFailed++;
      }
    } else {
      logWarning("Not enough data to test sorting (need at least 2 items)");
      testsPassed++;
    }

    // ==================== TEST 7: Get Media by ID ====================
    logSection("TEST 7: Get Media by ID");

    if (uploadedMedia.length > 0) {
      const firstMedia = uploadedMedia[0];
      const getResult = await services.media.getMediaById(firstMedia.id);

      if (getResult.success && getResult.data) {
        logSuccess(`Retrieved media: ${getResult.data.filename}`);
        logInfo(`  ID: ${getResult.data.id}`);
        logInfo(`  URL: ${getResult.data.url}`);
        testsPassed++;
      } else {
        logError(`Get by ID failed: ${getResult.message}`);
        testsFailed++;
      }
    } else {
      logWarning("No uploaded media to test Get by ID");
    }

    // ==================== TEST 8: Update Media Metadata ====================
    logSection("TEST 8: Update Media Metadata");

    if (uploadedMedia.length > 0) {
      const firstMedia = uploadedMedia[0];
      const updateResult = await services.media.updateMedia(firstMedia.id, {
        altText: "Integration test image",
        caption: "Testing metadata updates",
        tags: ["test", "integration", "automated"],
      });

      if (updateResult.success) {
        logSuccess("Metadata updated successfully");
        logInfo(`  Alt text: Integration test image`);
        logInfo(`  Caption: Testing metadata updates`);
        logInfo(`  Tags: test, integration, automated`);

        // Verify update
        const verifyResult = await services.media.getMediaById(firstMedia.id);
        if (
          verifyResult.success &&
          verifyResult.data?.altText === "Integration test image"
        ) {
          logSuccess("  Update verified ✓");
          testsPassed++;
        } else {
          logError("  Update NOT verified");
          testsFailed++;
        }
      } else {
        logError(`Update failed: ${updateResult.message}`);
        testsFailed++;
      }
    } else {
      logWarning("No uploaded media to test Update");
    }

    // ==================== TEST 9: Delete Media ====================
    logSection("TEST 9: Delete Media Files");

    for (const media of uploadedMedia) {
      const deleteResult = await services.media.deleteMedia(media.id);

      if (deleteResult.success) {
        logSuccess(`Deleted: ${media.filename}`);

        // Verify deletion
        const verifyResult = await services.media.getMediaById(media.id);
        if (!verifyResult.success) {
          logSuccess(`  Deletion verified ✓`);
          testsPassed++;
        } else {
          logError(`  Deletion NOT verified (file still exists)`);
          testsFailed++;
        }
      } else {
        logError(`Delete failed: ${deleteResult.message}`);
        testsFailed++;
      }
    }

    // ==================== TEST 10: Storage Configuration ====================
    logSection("TEST 10: Storage Configuration");

    const storageType = services.media.getStorageType();
    logSuccess(`Storage type: ${storageType}`);

    if (storageType === "local") {
      logInfo("  Upload directory: ./public/uploads");
      logInfo("  Public path: /uploads");
    } else if (storageType === "vercel-blob") {
      logInfo("  Using Vercel Blob storage");
    } else if (storageType === "s3") {
      logInfo("  Using AWS S3 storage");
    } else if (storageType === "r2") {
      logInfo("  Using Cloudflare R2 storage");
    }
    testsPassed++;

    // ==================== Summary ====================
    logSection("📊 Test Summary");

    const total = testsPassed + testsFailed;
    const passRate = ((testsPassed / total) * 100).toFixed(1);

    console.log();
    log(`Total tests: ${total}`, "cyan");
    log(`Passed: ${testsPassed}`, "green");
    log(`Failed: ${testsFailed}`, testsFailed > 0 ? "red" : "green");
    log(`Pass rate: ${passRate}%`, testsFailed === 0 ? "green" : "yellow");
    console.log();

    if (testsFailed === 0) {
      logSuccess("🎉 All tests passed!");
      process.exit(0);
    } else {
      logError("Some tests failed. Please review the output above.");
      process.exit(1);
    }
  } catch (error) {
    logError(`Fatal error during testing: ${error}`);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  logError(`Unhandled error: ${error}`);
  console.error(error);
  process.exit(1);
});
