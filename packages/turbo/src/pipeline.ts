// @typokit/turbo — Turborepo pipeline configuration helpers

/** Configuration for a single Turborepo task */
export interface TurboTaskConfig {
  dependsOn?: string[];
  outputs?: string[];
  cache?: boolean;
  persistent?: boolean;
  env?: string[];
  inputs?: string[];
}

/** Map of task names to their configuration */
export interface TurboPipeline {
  [taskName: string]: TurboTaskConfig;
}

/** Root turbo.json structure */
export interface TurboConfig {
  $schema?: string;
  tasks: TurboPipeline;
  globalDependencies?: string[];
  globalEnv?: string[];
}

/** Default pipeline tasks for a TypoKit project */
export const defaultPipeline: TurboPipeline = {
  "build": {
    dependsOn: ["^build"],
    outputs: ["dist/**", ".typokit/**"],
    inputs: ["src/**/*.ts", "tsconfig.json"],
  },
  "dev": {
    dependsOn: ["^build"],
    cache: false,
    persistent: true,
  },
  "test": {
    dependsOn: ["build"],
    outputs: [],
    inputs: ["src/**/*.ts", "src/**/*.test.ts"],
  },
  "typecheck": {
    dependsOn: ["^build"],
    outputs: [],
  },
  "lint": {
    outputs: [],
  },
};

/**
 * Create a turbo.json configuration object with TypoKit defaults.
 * Merges user overrides on top of the default pipeline.
 */
export function createTurboConfig(overrides?: {
  tasks?: TurboPipeline;
  globalDependencies?: string[];
  globalEnv?: string[];
}): TurboConfig {
  const tasks: TurboPipeline = { ...defaultPipeline };

  if (overrides?.tasks) {
    for (const [key, value] of Object.entries(overrides.tasks)) {
      tasks[key] = { ...tasks[key], ...value };
    }
  }

  const config: TurboConfig = {
    $schema: "https://turbo.build/schema.json",
    tasks,
  };

  if (overrides?.globalDependencies) {
    config.globalDependencies = overrides.globalDependencies;
  }

  if (overrides?.globalEnv) {
    config.globalEnv = overrides.globalEnv;
  }

  return config;
}
