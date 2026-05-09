/**
 * Media Folders Integration Test
 *
 * Tests the complete folder organization system including:
 * - Creating folders and subfolders
 * - Uploading media to folders
 * - Moving media between folders
 * - Listing folder contents
 * - Breadcrumb navigation
 * - Deleting folders
 *
 * Run with: pnpm exec tsx test-media-folders.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

import { getDb } from "./src/__tests__/fixtures/db";
import { ServiceContainer } from "./src/services/index";

async function testFolderSystem() {
  console.log("\n🧪 Media Folders Integration Test\n");
  console.log("=".repeat(60));

  const db = await getDb();
  const services = new ServiceContainer(db);

  // Test user ID (from seed data)
  const userId = "423ffef1-08ad-44c1-a153-fae98b4b80e5"; // admin@example.com

  const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
  };

  function test(name: string, fn: () => boolean | Promise<boolean>) {
    testResults.total++;
    return async () => {
      try {
        const result = await fn();
        if (result) {
          testResults.passed++;
          console.log(`✅ ${name}`);
        } else {
          testResults.failed++;
          console.log(`❌ ${name}`);
        }
      } catch (error) {
        testResults.failed++;
        console.log(`❌ ${name}`);
        console.error(
          `   Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };
  }

  // ========================================
  // Test 1: Create Root Folder
  // ========================================
  console.log("\n📁 Test 1: Create Root Folders");
  console.log("-".repeat(60));

  let productsFolder: any;
  let eventsFolder: any;

  await test("Create 'Products' root folder", async () => {
    const result = await services.mediaFolders.createFolder({
      name: "Products",
      description: "Product images and media",
      createdBy: userId,
    });

    productsFolder = result.data;
    console.log(
      `   Created folder: ${productsFolder?.id} - ${productsFolder?.name}`
    );
    return result.success && productsFolder?.name === "Products";
  })();

  await test("Create 'Events' root folder", async () => {
    const result = await services.mediaFolders.createFolder({
      name: "Events",
      description: "Event photos and videos",
      createdBy: userId,
    });

    eventsFolder = result.data;
    console.log(
      `   Created folder: ${eventsFolder?.id} - ${eventsFolder?.name}`
    );
    return result.success && eventsFolder?.name === "Events";
  })();

  // ========================================
  // Test 2: Create Subfolders
  // ========================================
  console.log("\n📂 Test 2: Create Nested Folder Structure");
  console.log("-".repeat(60));

  let electronicsFolder: any;
  let phonesFolder: any;

  await test("Create 'Electronics' subfolder under Products", async () => {
    const result = await services.mediaFolders.createFolder({
      name: "Electronics",
      description: "Electronic devices",
      parentId: productsFolder.id,
      createdBy: userId,
    });

    electronicsFolder = result.data;
    console.log(`   Created subfolder: ${electronicsFolder?.name}`);
    console.log(`   Parent: ${electronicsFolder?.parentId}`);
    return result.success && electronicsFolder?.parentId === productsFolder.id;
  })();

  await test("Create 'Phones' subfolder under Electronics", async () => {
    const result = await services.mediaFolders.createFolder({
      name: "Phones",
      description: "Smartphone images",
      parentId: electronicsFolder.id,
      createdBy: userId,
    });

    phonesFolder = result.data;
    console.log(`   Created nested subfolder: ${phonesFolder?.name}`);
    console.log(`   Hierarchy: Products > Electronics > Phones`);
    return result.success && phonesFolder?.parentId === electronicsFolder.id;
  })();

  // ========================================
  // Test 3: List Root Folders
  // ========================================
  console.log("\n📋 Test 3: List Root Folders");
  console.log("-".repeat(60));

  await test("List all root folders", async () => {
    const result = await services.mediaFolders.listRootFolders();

    console.log(`   Found ${result.data?.length} root folders:`);
    result.data?.forEach((folder: any) => {
      console.log(`   - ${folder.name}`);
    });

    return result.success && (result.data?.length || 0) >= 2;
  })();

  // ========================================
  // Test 4: List Subfolders
  // ========================================
  console.log("\n📂 Test 4: List Subfolders");
  console.log("-".repeat(60));

  await test("List subfolders of Products", async () => {
    const result = await services.mediaFolders.listSubfolders(
      productsFolder.id
    );

    console.log(`   Subfolders of 'Products': ${result.data?.length}`);
    result.data?.forEach((folder: any) => {
      console.log(`   - ${folder.name}`);
    });

    return result.success && (result.data?.length || 0) >= 1;
  })();

  // ========================================
  // Test 5: Upload Media to Folder
  // ========================================
  console.log("\n📷 Test 5: Upload Media to Folders");
  console.log("-".repeat(60));

  let phoneImage: any;

  await test("Upload image to 'Phones' folder", async () => {
    // Create a simple test image buffer (1x1 pixel PNG)
    const testImageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    const result = await services.media.uploadMedia({
      file: testImageBuffer,
      filename: "iphone-15-pro.png",
      mimeType: "image/png",
      size: testImageBuffer.length,
      uploadedBy: userId,
    });

    if (result.success && result.data) {
      // Move to Phones folder
      const moveResult = await services.mediaFolders.moveMediaToFolder(
        result.data.id,
        phonesFolder.id
      );

      phoneImage = moveResult.data;
      console.log(`   Uploaded: ${result.data.filename}`);
      console.log(`   Moved to folder: ${phonesFolder.name}`);
      return moveResult.success;
    }

    return false;
  })();

  // ========================================
  // Test 6: Get Folder Contents
  // ========================================
  console.log("\n📦 Test 6: Get Folder Contents");
  console.log("-".repeat(60));

  await test("Get contents of 'Phones' folder", async () => {
    const result = await services.mediaFolders.getFolderContents(
      phonesFolder.id
    );

    console.log(`   Folder: ${result.data?.folder?.name}`);
    console.log(`   Subfolders: ${result.data?.subfolders?.length || 0}`);
    console.log(`   Media files: ${result.data?.mediaFiles?.length || 0}`);

    if (result.data?.mediaFiles && result.data.mediaFiles.length > 0) {
      console.log(`   Files:`);
      result.data.mediaFiles.forEach((file: any) => {
        console.log(`   - ${file.filename} (${file.size} bytes)`);
      });
    }

    return result.success && (result.data?.mediaFiles?.length || 0) >= 1;
  })();

  // ========================================
  // Test 7: Breadcrumb Navigation
  // ========================================
  console.log("\n🍞 Test 7: Breadcrumb Navigation");
  console.log("-".repeat(60));

  await test("Get breadcrumbs for 'Phones' folder", async () => {
    const result = await services.mediaFolders.getFolderById(phonesFolder.id);

    console.log(`   Breadcrumb trail:`);
    result.data?.breadcrumbs?.forEach((crumb: any, i: number) => {
      const arrow =
        i < (result.data?.breadcrumbs?.length || 0) - 1 ? " > " : "";
      console.log(`   ${crumb.name}${arrow}`);
    });

    const expectedPath = ["Root", "Products", "Electronics", "Phones"];
    const actualPath = result.data?.breadcrumbs?.map((c: any) => c.name) || [];

    return (
      result.success &&
      JSON.stringify(actualPath) === JSON.stringify(expectedPath)
    );
  })();

  // ========================================
  // Test 8: Get Root Folder Contents
  // ========================================
  console.log("\n📦 Test 8: Get Root Folder Contents");
  console.log("-".repeat(60));

  await test("Get contents of root folder", async () => {
    const result = await services.mediaFolders.getFolderContents(null);

    console.log(`   Root folder:`);
    console.log(`   - Subfolders: ${result.data?.subfolders?.length || 0}`);
    console.log(
      `   - Media files (unorganized): ${result.data?.mediaFiles?.length || 0}`
    );

    if (result.data?.subfolders) {
      console.log(`   Root folders:`);
      result.data.subfolders.forEach((folder: any) => {
        console.log(`   - ${folder.name}`);
      });
    }

    return result.success;
  })();

  // ========================================
  // Test 9: Move Media Between Folders
  // ========================================
  console.log("\n🔄 Test 9: Move Media Between Folders");
  console.log("-".repeat(60));

  await test("Move media from Phones to Electronics folder", async () => {
    if (!phoneImage) {
      console.log(`   Skipped: No media to move`);
      return true;
    }

    const result = await services.mediaFolders.moveMediaToFolder(
      phoneImage.id,
      electronicsFolder.id
    );

    console.log(`   Moved: ${phoneImage.filename}`);
    console.log(`   From: Phones`);
    console.log(`   To: Electronics`);

    return result.success;
  })();

  await test("Move media back to Phones folder", async () => {
    if (!phoneImage) {
      console.log(`   Skipped: No media to move`);
      return true;
    }

    const result = await services.mediaFolders.moveMediaToFolder(
      phoneImage.id,
      phonesFolder.id
    );

    console.log(`   Moved back to: Phones`);
    return result.success;
  })();

  // ========================================
  // Test 10: Update Folder Metadata
  // ========================================
  console.log("\n✏️  Test 10: Update Folder Metadata");
  console.log("-".repeat(60));

  await test("Update 'Phones' folder metadata", async () => {
    const result = await services.mediaFolders.updateFolder(phonesFolder.id, {
      name: "Smartphones",
      description: "iPhone and Android devices",
    });

    console.log(`   Updated name: ${result.data?.name}`);
    console.log(`   Updated description: ${result.data?.description}`);

    return result.success && result.data?.name === "Smartphones";
  })();

  // ========================================
  // Test 11: Circular Reference Prevention
  // ========================================
  console.log("\n🚫 Test 11: Circular Reference Prevention");
  console.log("-".repeat(60));

  await test("Prevent circular reference (move Products into Phones)", async () => {
    const result = await services.mediaFolders.updateFolder(productsFolder.id, {
      parentId: phonesFolder.id,
    });

    console.log(`   Attempted to move Products into Phones`);
    console.log(`   Expected: Failure (circular reference)`);
    console.log(`   Result: ${result.success ? "❌ Allowed" : "✅ Blocked"}`);

    return !result.success && result.statusCode === 400;
  })();

  // ========================================
  // Test 12: Filter Media by Folder
  // ========================================
  console.log("\n🔍 Test 12: Filter Media by Folder");
  console.log("-".repeat(60));

  await test("List media in Phones folder", async () => {
    const result = await services.media.listMedia({
      folderId: phonesFolder.id,
      page: 1,
      pageSize: 24,
    });

    console.log(`   Media in Smartphones folder: ${result.data?.length || 0}`);
    result.data?.forEach((media: any) => {
      console.log(`   - ${media.filename}`);
    });

    return result.success;
  })();

  await test("List media in root (unorganized)", async () => {
    const result = await services.media.listMedia({
      folderId: null,
      page: 1,
      pageSize: 24,
    });

    console.log(`   Media in root (no folder): ${result.data?.length || 0}`);
    return result.success;
  })();

  // ========================================
  // Test 13: Delete Folder (Preserve Contents)
  // ========================================
  console.log("\n🗑️  Test 13: Delete Folder (Preserve Contents)");
  console.log("-".repeat(60));

  await test("Delete Smartphones folder (move contents to parent)", async () => {
    const result = await services.mediaFolders.deleteFolder(
      phonesFolder.id,
      false // deleteContents = false (preserve contents)
    );

    console.log(`   Deleted: Smartphones folder`);
    console.log(`   Contents moved to: Electronics`);

    return result.success;
  })();

  await test("Verify media moved to Electronics folder", async () => {
    const result = await services.mediaFolders.getFolderContents(
      electronicsFolder.id
    );

    console.log(`   Electronics folder now has:`);
    console.log(`   - Media files: ${result.data?.mediaFiles?.length || 0}`);

    return result.success && (result.data?.mediaFiles?.length || 0) >= 1;
  })();

  // ========================================
  // Test 14: Delete Folder (Delete Contents)
  // ========================================
  console.log("\n🗑️  Test 14: Delete Folder with Contents");
  console.log("-".repeat(60));

  await test("Delete Electronics folder (with contents)", async () => {
    const result = await services.mediaFolders.deleteFolder(
      electronicsFolder.id,
      true // deleteContents = true (cascade delete)
    );

    console.log(`   Deleted: Electronics folder`);
    console.log(`   Also deleted: All subfolders and media`);

    return result.success;
  })();

  // ========================================
  // Summary
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Summary");
  console.log("=".repeat(60));
  console.log(`Total Tests:  ${testResults.total}`);
  console.log(`✅ Passed:    ${testResults.passed}`);
  console.log(`❌ Failed:    ${testResults.failed}`);
  console.log(
    `Success Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`
  );
  console.log("=".repeat(60));

  if (testResults.failed === 0) {
    console.log("\n🎉 All tests passed! Folder system is working correctly.\n");
  } else {
    console.log("\n⚠️  Some tests failed. Please review the errors above.\n");
  }

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run the test
testFolderSystem().catch(error => {
  console.error("\n❌ Test suite failed with error:");
  console.error(error);
  process.exit(1);
});
