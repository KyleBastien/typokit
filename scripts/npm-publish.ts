/**
 * Publishes an npm package with OIDC provenance if it already exists on the
 * registry, or falls back to NPM_TOKEN for first-time publishes (OIDC
 * trusted publishing cannot create new packages).
 *
 * Usage: node --experimental-strip-types scripts/npm-publish.ts <dir> [--dry-run]
 *
 * Env vars:
 *   NPM_ACCESS_TOKEN - required for first-time publishes
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!dir) {
  console.error("Usage: npm-publish.ts <package-dir> [--dry-run]");
  process.exit(1);
}

interface PackageJson {
  name: string;
  version: string;
}

const pkg: PackageJson = JSON.parse(
  readFileSync(join(dir, "package.json"), "utf8"),
);

function packageExistsOnNpm(name: string): boolean {
  try {
    execSync(`npm view ${name} version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const exists = packageExistsOnNpm(pkg.name);
const dryRunFlag = dryRun ? " --dry-run" : "";

if (exists) {
  console.log(`📦 ${pkg.name}@${pkg.version} — exists on npm, using OIDC provenance`);
  execSync(`npm publish --access public --provenance${dryRunFlag}`, {
    cwd: dir,
    stdio: "inherit",
  });
} else {
  const token = process.env.NPM_ACCESS_TOKEN;
  if (!token) {
    console.error(`❌ ${pkg.name} is new but NPM_ACCESS_TOKEN is not set — cannot publish`);
    process.exit(1);
  }
  console.log(`🆕 ${pkg.name}@${pkg.version} — first publish, using NPM_TOKEN`);
  execSync(
    `npm publish --access public --registry https://registry.npmjs.org/${dryRunFlag}`,
    {
      cwd: dir,
      stdio: "inherit",
      env: {
        ...process.env,
        // Token-based auth, no provenance (requires OIDC)
        NODE_AUTH_TOKEN: token,
        NPM_CONFIG_PROVENANCE: "false",
      },
    },
  );
}
