// @typokit/nx — Init generator: adds TypoKit to an existing Nx workspace project
import type { Tree } from "@nx/devkit";
import {
  readProjectConfiguration,
  updateProjectConfiguration,
} from "@nx/devkit";
import type { InitGeneratorSchema } from "./schema.js";

export default async function initGenerator(
  tree: Tree,
  options: InitGeneratorSchema,
): Promise<void> {
  const projectConfig = readProjectConfiguration(tree, options.project);
  const projectRoot = projectConfig.root;
  const server = options.server ?? "native";
  const db = options.db ?? "drizzle";

  // Add typokit config file
  const configContent = `// TypoKit configuration
export default {
  typeFiles: ["src/**/*.types.ts", "src/**/types.ts"],
  routeFiles: ["src/**/*.routes.ts", "src/**/routes.ts", "src/**/contracts.ts"],
  outputDir: ".typokit",
  distDir: "dist",
  compiler: "tsc",
};
`;
  tree.write(`${projectRoot}/typokit.config.ts`, configContent);

  // Add types.ts starter file
  const typesContent = `// TypoKit type definitions
// Define your domain types here. TypoKit uses these as the single source of truth
// for validation, database schemas, API clients, and OpenAPI docs.

/** @table todos */
export interface Todo {
  /** @id @generated */
  id: number;
  title: string;
  completed: boolean;
}
`;
  if (!tree.exists(`${projectRoot}/src/types.ts`)) {
    tree.write(`${projectRoot}/src/types.ts`, typesContent);
  }

  // Add TypoKit dependencies to package.json
  const pkgJsonPath = `${projectRoot}/package.json`;
  if (tree.exists(pkgJsonPath)) {
    const pkgJson = JSON.parse(
      tree.read(pkgJsonPath, "utf-8") ?? "{}",
    ) as Record<string, Record<string, string>>;
    pkgJson["dependencies"] = pkgJson["dependencies"] ?? {};
    pkgJson["dependencies"]["@typokit/core"] = "workspace:*";
    pkgJson["dependencies"]["@typokit/types"] = "workspace:*";
    pkgJson["dependencies"]["@typokit/cli"] = "workspace:*";

    // Add server adapter
    const serverPkg =
      server === "native"
        ? "@typokit/server-native"
        : `@typokit/server-${server}`;
    pkgJson["dependencies"][serverPkg] = "workspace:*";

    // Add db adapter
    if (db !== "none") {
      pkgJson["dependencies"][`@typokit/db-${db}`] = "workspace:*";
    }

    tree.write(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
  }

  // Update project.json targets for TypoKit
  const updatedConfig = { ...projectConfig };
  updatedConfig.targets = updatedConfig.targets ?? {};
  updatedConfig.targets["typokit-build"] = {
    executor: "@typokit/nx:build",
    dependsOn: ["^build"],
    inputs: ["production", "^production"],
    outputs: [`{projectRoot}/.typokit`],
  };
  updatedConfig.targets["typokit-dev"] = {
    executor: "@typokit/nx:dev",
  };
  updatedConfig.targets["typokit-test"] = {
    executor: "@typokit/nx:test",
    dependsOn: ["typokit-build"],
    inputs: ["default", "^production"],
  };

  updateProjectConfiguration(tree, options.project, updatedConfig);
}
