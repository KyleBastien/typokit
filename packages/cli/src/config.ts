// @typokit/cli — Configuration loading

export interface TypoKitConfig {
  /** Glob patterns or paths for type definition files */
  typeFiles?: string[];
  /** Glob patterns or paths for route contract files */
  routeFiles?: string[];
  /** Output directory for generated files (default: ".typokit") */
  outputDir?: string;
  /** Output directory for compiled output (default: "dist") */
  distDir?: string;
  /** TypeScript compiler to use: "tsc" | "tsup" | "swc" (default: "tsc") */
  compiler?: "tsc" | "tsup" | "swc";
  /** Additional compiler args */
  compilerArgs?: string[];
}

const DEFAULT_CONFIG: Required<TypoKitConfig> = {
  typeFiles: ["src/**/*.types.ts", "src/**/types.ts"],
  routeFiles: ["src/**/*.routes.ts", "src/**/routes.ts", "src/**/contracts.ts"],
  outputDir: ".typokit",
  distDir: "dist",
  compiler: "tsc",
  compilerArgs: [],
};

/**
 * Load TypoKit configuration from typokit.config.ts or package.json.
 * Searches in the given root directory.
 */
export async function loadConfig(rootDir: string): Promise<Required<TypoKitConfig>> {
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync, readFileSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: string) => string;
  };

  // Try typokit.config.ts (compiled to .js)
  const configTsPath = join(rootDir, "typokit.config.ts");
  const configJsPath = join(rootDir, "typokit.config.js");

  if (existsSync(configJsPath)) {
    try {
      const { pathToFileURL } = await import(/* @vite-ignore */ "url") as {
        pathToFileURL: (p: string) => { href: string };
      };
      const mod = (await import(pathToFileURL(configJsPath).href)) as {
        default?: TypoKitConfig;
      };
      return mergeConfig(mod.default ?? {});
    } catch {
      // Fall through to package.json
    }
  }

  if (existsSync(configTsPath)) {
    // Config exists as TS but not compiled — return defaults with a note
    // Users should compile it or use package.json field
  }

  // Try package.json "typokit" field
  const pkgPath = join(rootDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkgContent = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      if (pkg["typokit"] && typeof pkg["typokit"] === "object") {
        return mergeConfig(pkg["typokit"] as TypoKitConfig);
      }
    } catch {
      // Fall through to defaults
    }
  }

  return { ...DEFAULT_CONFIG };
}

function mergeConfig(partial: TypoKitConfig): Required<TypoKitConfig> {
  return {
    typeFiles: partial.typeFiles ?? DEFAULT_CONFIG.typeFiles,
    routeFiles: partial.routeFiles ?? DEFAULT_CONFIG.routeFiles,
    outputDir: partial.outputDir ?? DEFAULT_CONFIG.outputDir,
    distDir: partial.distDir ?? DEFAULT_CONFIG.distDir,
    compiler: partial.compiler ?? DEFAULT_CONFIG.compiler,
    compilerArgs: partial.compilerArgs ?? DEFAULT_CONFIG.compilerArgs,
  };
}
