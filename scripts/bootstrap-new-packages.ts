/**
 * Bootstraps first-time npm publishes for packages that don't yet exist on
 * the registry. OIDC trusted publishing cannot create new packages, so this
 * script publishes them once using NPM_TOKEN. Subsequent releases go through
 * OIDC via `nx release publish`.
 *
 * Usage: node --experimental-strip-types scripts/bootstrap-new-packages.ts [--dry-run]
 *
 * Env vars:
 *   NPM_TOKEN - required
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

function packageExistsOnNpm(name: string): boolean {
  try {
    execSync(`npm view ${name} version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Scan packages/* for publishable packages (matching nx release config)
const packagesDir = "packages";
const dirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => !d.name.startsWith("example-") && d.name !== "docs")
  .map((d) => join(packagesDir, d.name));

let bootstrapped = 0;

for (const dir of dirs) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) continue;

  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.private) continue;

  if (packageExistsOnNpm(pkg.name)) {
    console.log(`✅ ${pkg.name} — already on npm`);
    continue;
  }

  const token = process.env.NPM_TOKEN;
  if (!token) {
    console.error(`❌ ${pkg.name} is new but NPM_TOKEN is not set`);
    process.exit(1);
  }

  console.log(`🆕 ${pkg.name}@${pkg.version} — first publish via NPM_TOKEN`);
  const dryRunFlag = dryRun ? " --dry-run" : "";
  try {
    execSync(
      `npm publish --access public --registry https://registry.npmjs.org/${dryRunFlag}`,
      {
        cwd: dir,
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_AUTH_TOKEN: token,
          NPM_CONFIG_PROVENANCE: "false",
        },
      },
    );
    bootstrapped++;
  } catch (err) {
    console.error(`⚠️  Failed to bootstrap ${pkg.name}:`, err);
  }
}

console.log(
  bootstrapped > 0
    ? `Bootstrapped ${bootstrapped} new package(s).`
    : "All packages already exist on npm — nothing to bootstrap.",
);
