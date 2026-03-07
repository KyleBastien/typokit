/**
 * Syncs versions from main NAPI packages to their platform-specific npm packages
 * and updates optionalDependencies to match.
 *
 * Run after `nx release version` so platform packages stay in lock-step.
 *
 * Usage: node --experimental-strip-types scripts/sync-native-versions.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
}

const NAPI_PACKAGES: string[] = [
  "packages/transform-native",
  "packages/plugin-axum",
];

for (const pkgDir of NAPI_PACKAGES) {
  const mainPkgPath = join(pkgDir, "package.json");
  const mainPkg: PackageJson = JSON.parse(readFileSync(mainPkgPath, "utf8"));
  const { version } = mainPkg;
  const npmDir = join(pkgDir, "npm");

  console.log(`Syncing ${mainPkg.name} platform packages to v${version}`);

  // Update optionalDependencies in the main package.json
  if (mainPkg.optionalDependencies) {
    for (const dep of Object.keys(mainPkg.optionalDependencies)) {
      mainPkg.optionalDependencies[dep] = version;
    }
    writeFileSync(mainPkgPath, JSON.stringify(mainPkg, null, 2) + "\n");
    console.log(`  Updated optionalDependencies in ${mainPkgPath}`);
  }

  // Update each platform package version
  if (!existsSync(npmDir)) continue;
  for (const dir of readdirSync(npmDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const platformPkgPath = join(npmDir, dir.name, "package.json");
    if (!existsSync(platformPkgPath)) continue;

    const platformPkg: PackageJson = JSON.parse(
      readFileSync(platformPkgPath, "utf8"),
    );
    platformPkg.version = version;
    writeFileSync(
      platformPkgPath,
      JSON.stringify(platformPkg, null, 2) + "\n",
    );
    console.log(`  ${platformPkg.name}@${version}`);
  }
}

console.log("Native version sync complete.");
