// @typokit/turbo — Setup instructions and template generation

import { createTurboConfig } from "./pipeline.js";
import type { TurboConfig } from "./pipeline.js";

/**
 * Returns a turbo.json template string ready to write to disk.
 * Generates a complete turbo.json with TypoKit-optimized pipeline tasks.
 */
export function getTurboJsonTemplate(overrides?: Parameters<typeof createTurboConfig>[0]): string {
  const config: TurboConfig = createTurboConfig(overrides);
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Returns setup instructions for integrating TypoKit into a Turborepo workspace.
 */
export function getSetupInstructions(): string {
  return `# Setting up TypoKit in a Turborepo workspace

## 1. Install dependencies

In your Turborepo root:

\`\`\`bash
npm install @typokit/turbo --save-dev
# or
pnpm add @typokit/turbo --save-dev -w
\`\`\`

In your TypoKit server package:

\`\`\`bash
npm install @typokit/core @typokit/types
\`\`\`

## 2. Configure turbo.json

Add TypoKit-aware pipeline tasks to your \`turbo.json\`:

\`\`\`json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".typokit/**"],
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": [],
      "inputs": ["src/**/*.ts", "src/**/*.test.ts"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    }
  }
}
\`\`\`

Key points:
- \`build\` outputs include \`.typokit/\` (generated code directory)
- \`dev\` is non-cacheable and persistent (watch mode)
- \`test\` depends on \`build\` (needs generated code)

## 3. Add scripts to your TypoKit package

In your server package's \`package.json\`:

\`\`\`json
{
  "scripts": {
    "build": "typokit build",
    "dev": "typokit dev",
    "test": "typokit test"
  }
}
\`\`\`

## 4. Run with Turborepo

\`\`\`bash
# Build all packages (TypoKit packages built in dependency order)
turbo build

# Start dev mode for all packages
turbo dev

# Run tests
turbo test
\`\`\`

## Programmatic Usage

You can also use the helper scripts programmatically:

\`\`\`typescript
import { runBuild, runDev, runTest } from "@typokit/turbo";

// In a custom build script
await runBuild({ cwd: "./packages/server" });
\`\`\`

Or generate a turbo.json configuration:

\`\`\`typescript
import { createTurboConfig, getTurboJsonTemplate } from "@typokit/turbo";

// Get a config object
const config = createTurboConfig({
  tasks: { "build": { env: ["DATABASE_URL"] } }
});

// Or get a ready-to-write JSON string
const json = getTurboJsonTemplate();
\`\`\`
`;
}
