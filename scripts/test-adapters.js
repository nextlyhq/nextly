#!/usr/bin/env node

/**
 * Multi-Adapter Testing Script
 *
 * This script helps you test the Nextly application with all three database adapters:
 * - PostgreSQL
 * - MySQL
 * - SQLite
 *
 * Usage:
 *   node scripts/test-adapters.js [command] [adapter]
 *
 * Commands:
 *   setup <adapter>    - Set up the database for the specified adapter
 *   switch <adapter>   - Switch to the specified adapter (copies env file)
 *   start <adapter>    - Start the app with the specified adapter
 *   test <adapter>     - Run tests with the specified adapter
 *   test-all           - Run tests with all adapters sequentially
 *   status             - Show current adapter configuration
 *   help               - Show this help message
 *
 * Adapters:
 *   postgresql, postgres, pg  - PostgreSQL database
 *   mysql, my                 - MySQL database
 *   sqlite, lite              - SQLite database
 *
 * Examples:
 *   node scripts/test-adapters.js switch postgresql
 *   node scripts/test-adapters.js start mysql
 *   node scripts/test-adapters.js test-all
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PLAYGROUND_DIR = path.join(__dirname, "..", "apps", "playground");
const ENV_FILE = path.join(PLAYGROUND_DIR, ".env");

// Adapter configurations
const ADAPTERS = {
  postgresql: {
    aliases: ["postgresql", "postgres", "pg"],
    envFile: ".env.postgresql",
    dockerProfile: null, // Default, no profile needed
    dockerService: "postgres",
    displayName: "PostgreSQL",
  },
  mysql: {
    aliases: ["mysql", "my"],
    envFile: ".env.mysql",
    dockerProfile: "mysql",
    dockerService: "mysql",
    displayName: "MySQL",
  },
  sqlite: {
    aliases: ["sqlite", "lite"],
    envFile: ".env.sqlite",
    dockerProfile: null, // No Docker needed
    dockerService: null,
    displayName: "SQLite",
  },
};

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, "green");
}

function logError(message) {
  log(`❌ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠️  ${message}`, "yellow");
}

function resolveAdapter(input) {
  if (!input) return null;
  const normalized = input.toLowerCase();

  for (const [key, config] of Object.entries(ADAPTERS)) {
    if (config.aliases.includes(normalized)) {
      return key;
    }
  }
  return null;
}

function getCurrentAdapter() {
  try {
    if (!fs.existsSync(ENV_FILE)) {
      return null;
    }
    const content = fs.readFileSync(ENV_FILE, "utf8");
    const match = content.match(/DB_DIALECT=(\w+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function switchAdapter(adapterKey) {
  const config = ADAPTERS[adapterKey];
  const sourceEnvFile = path.join(PLAYGROUND_DIR, config.envFile);

  if (!fs.existsSync(sourceEnvFile)) {
    logError(`Environment file not found: ${config.envFile}`);
    logWarning(`Please create ${sourceEnvFile} first.`);
    return false;
  }

  // Backup current .env if it exists
  if (fs.existsSync(ENV_FILE)) {
    const backupFile = path.join(PLAYGROUND_DIR, ".env.backup");
    fs.copyFileSync(ENV_FILE, backupFile);
    log(`Backed up current .env to .env.backup`);
  }

  // Copy the adapter-specific env file
  fs.copyFileSync(sourceEnvFile, ENV_FILE);
  logSuccess(`Switched to ${config.displayName} adapter`);

  return true;
}

function startDocker(adapterKey) {
  const config = ADAPTERS[adapterKey];

  if (!config.dockerService) {
    log(`${config.displayName} doesn't require Docker`);
    return true;
  }

  logStep("Docker", `Starting ${config.displayName} container...`);

  try {
    let cmd = "docker compose up -d";
    if (config.dockerProfile) {
      cmd += ` --profile ${config.dockerProfile}`;
    }
    cmd += ` ${config.dockerService}`;

    execSync(cmd, {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });

    logSuccess(`${config.displayName} container started`);
    return true;
  } catch (error) {
    logError(`Failed to start ${config.displayName} container`);
    return false;
  }
}

function waitForDatabase(adapterKey, maxAttempts = 30) {
  const config = ADAPTERS[adapterKey];

  if (!config.dockerService) {
    return true; // SQLite doesn't need to wait
  }

  logStep("Wait", `Waiting for ${config.displayName} to be ready...`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      let checkCmd;
      if (adapterKey === "postgresql") {
        checkCmd = "docker exec nextly-postgres pg_isready -U postgres";
      } else if (adapterKey === "mysql") {
        checkCmd =
          "docker exec nextly-mysql mysqladmin ping -h localhost -u root -pdev_password --silent";
      }

      if (checkCmd) {
        execSync(checkCmd, { stdio: "pipe" });
        logSuccess(`${config.displayName} is ready!`);
        return true;
      }
    } catch {
      process.stdout.write(".");
      execSync("sleep 1 || timeout /t 1 /nobreak > nul", {
        stdio: "pipe",
        shell: true,
      });
    }
  }

  console.log("");
  logError(`${config.displayName} did not become ready in time`);
  return false;
}

function runMigrations() {
  logStep("Migrations", "Running database migrations...");

  try {
    execSync("pnpm --filter playground db:push", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    logSuccess("Migrations completed");
    return true;
  } catch (error) {
    logError("Migration failed");
    return false;
  }
}

function startApp() {
  logStep("App", "Starting the application...");

  const child = spawn("pnpm", ["--filter", "playground", "dev"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    shell: true,
  });

  child.on("error", err => {
    logError(`Failed to start app: ${err.message}`);
  });

  return child;
}

function showStatus() {
  log("\n📊 Current Adapter Status\n", "bright");

  const currentAdapter = getCurrentAdapter();

  log("Current Configuration:", "cyan");
  if (currentAdapter) {
    const config = ADAPTERS[currentAdapter] || { displayName: currentAdapter };
    log(`  DB_DIALECT: ${currentAdapter} (${config.displayName || "Unknown"})`);
  } else {
    log("  No .env file found or DB_DIALECT not set", "yellow");
  }

  log("\nAvailable Adapters:", "cyan");
  for (const [key, config] of Object.entries(ADAPTERS)) {
    const envExists = fs.existsSync(path.join(PLAYGROUND_DIR, config.envFile));
    const status = envExists ? "✅" : "❌";
    const current = currentAdapter === key ? " (current)" : "";
    log(`  ${status} ${config.displayName}${current} - ${config.envFile}`);
  }

  log("\nDocker Containers:", "cyan");
  try {
    execSync(
      'docker ps --format "table {{.Names}}\t{{.Status}}" | grep nextly || echo "  No Nextly containers running"',
      {
        stdio: "inherit",
        shell: true,
      }
    );
  } catch {
    log("  Unable to check Docker status");
  }
}

function showHelp() {
  console.log(`
${colors.bright}Nextly Multi-Adapter Testing Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node scripts/test-adapters.js [command] [adapter]

${colors.cyan}Commands:${colors.reset}
  ${colors.green}setup${colors.reset} <adapter>    Set up database and run migrations
  ${colors.green}switch${colors.reset} <adapter>   Switch to the specified adapter (copies env file)
  ${colors.green}start${colors.reset} <adapter>    Start Docker + app with the specified adapter
  ${colors.green}status${colors.reset}             Show current adapter configuration
  ${colors.green}help${colors.reset}               Show this help message

${colors.cyan}Adapters:${colors.reset}
  ${colors.yellow}postgresql${colors.reset}, postgres, pg  - PostgreSQL database
  ${colors.yellow}mysql${colors.reset}, my                 - MySQL database
  ${colors.yellow}sqlite${colors.reset}, lite              - SQLite database (no Docker needed)

${colors.cyan}Examples:${colors.reset}
  # Switch to PostgreSQL and start the app
  node scripts/test-adapters.js start postgresql

  # Switch to MySQL (requires Docker)
  node scripts/test-adapters.js start mysql

  # Switch to SQLite (no Docker needed)
  node scripts/test-adapters.js start sqlite

  # Just switch the adapter without starting
  node scripts/test-adapters.js switch mysql

  # Check current status
  node scripts/test-adapters.js status

${colors.cyan}Quick Start:${colors.reset}
  1. For PostgreSQL (default):
     ${colors.yellow}docker compose up -d postgres${colors.reset}
     ${colors.yellow}node scripts/test-adapters.js start postgresql${colors.reset}

  2. For MySQL:
     ${colors.yellow}docker compose --profile mysql up -d mysql${colors.reset}
     ${colors.yellow}node scripts/test-adapters.js start mysql${colors.reset}

  3. For SQLite (simplest):
     ${colors.yellow}node scripts/test-adapters.js start sqlite${colors.reset}
`);
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const adapterInput = args[1];

  switch (command) {
    case "switch": {
      const adapter = resolveAdapter(adapterInput);
      if (!adapter) {
        logError(`Unknown adapter: ${adapterInput}`);
        log("Valid adapters: postgresql, mysql, sqlite");
        process.exit(1);
      }
      switchAdapter(adapter);
      break;
    }

    case "setup": {
      const adapter = resolveAdapter(adapterInput);
      if (!adapter) {
        logError(`Unknown adapter: ${adapterInput}`);
        process.exit(1);
      }

      log(`\n🔧 Setting up ${ADAPTERS[adapter].displayName}...\n`, "bright");

      if (!switchAdapter(adapter)) process.exit(1);
      if (!startDocker(adapter)) process.exit(1);
      if (!waitForDatabase(adapter)) process.exit(1);
      if (!runMigrations()) process.exit(1);

      logSuccess(`\n${ADAPTERS[adapter].displayName} setup complete!`);
      break;
    }

    case "start": {
      const adapter = resolveAdapter(adapterInput);
      if (!adapter) {
        logError(`Unknown adapter: ${adapterInput}`);
        process.exit(1);
      }

      log(`\n🚀 Starting with ${ADAPTERS[adapter].displayName}...\n`, "bright");

      if (!switchAdapter(adapter)) process.exit(1);
      if (!startDocker(adapter)) process.exit(1);
      if (!waitForDatabase(adapter)) process.exit(1);

      log(
        "\n📝 Note: You may need to run migrations if this is a fresh database:",
        "yellow"
      );
      log("   pnpm --filter playground db:push\n");

      startApp();
      break;
    }

    case "status":
      showStatus();
      break;

    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;

    default:
      if (command) {
        logError(`Unknown command: ${command}`);
      }
      showHelp();
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  logError(err.message);
  process.exit(1);
});
