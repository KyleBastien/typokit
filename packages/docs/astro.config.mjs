import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://typokit.github.io",
  integrations: [
    starlight({
      title: "TypoKit",
      social: {
        github: "https://github.com/typokit/typokit",
      },
      sidebar: [
        {
          label: "Getting Started",
          collapsed: false,
          items: [
            { label: "Welcome", slug: "" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "Project Structure", slug: "getting-started/project-structure" },
          ],
        },
        {
          label: "Core Concepts",
          collapsed: true,
          items: [
            { label: "Schema-First Types", slug: "core-concepts/schema-first-types" },
            { label: "Routing and Handlers", slug: "core-concepts/routing-and-handlers" },
            { label: "Middleware and Context", slug: "core-concepts/middleware-and-context" },
            { label: "Error Handling", slug: "core-concepts/error-handling" },
            { label: "Server Adapters", slug: "core-concepts/server-adapters" },
            { label: "Database Adapters", slug: "core-concepts/database-adapters" },
            { label: "Plugins", slug: "core-concepts/plugins" },
            { label: "Testing", slug: "core-concepts/testing" },
            { label: "Observability and Debugging", slug: "core-concepts/observability" },
          ],
        },
        {
          label: "Guides",
          collapsed: true,
          items: [
            { label: "Building Your First API", slug: "guides/building-first-api" },
            { label: "Custom Server Adapter", slug: "guides/custom-server-adapter" },
            { label: "Custom Plugin Development", slug: "guides/custom-plugin" },
            { label: "Migration from Express/Fastify", slug: "guides/migration" },
          ],
        },
        {
          label: "CLI Reference",
          collapsed: true,
          items: [
            { label: "Scaffolding and Development", slug: "cli-reference/scaffolding-dev" },
            { label: "Generate, Migrate, and Test", slug: "cli-reference/generate-migrate-test" },
            { label: "Inspect Commands", slug: "cli-reference/inspect" },
          ],
        },
        {
          label: "API Reference",
          collapsed: true,
          items: [
            { label: "Overview", slug: "api-reference" },
          ],
        },
        {
          label: "Architecture",
          collapsed: true,
          items: [
            { label: "Overview", slug: "architecture/overview" },
            { label: "Build Pipeline", slug: "architecture/build-pipeline" },
            { label: "Compiled Router", slug: "architecture/compiled-router" },
          ],
        },
        {
          label: "Contributing",
          collapsed: true,
          items: [
            { label: "Contributing Guide", slug: "contributing" },
          ],
        },
        {
          label: "AI Agents",
          collapsed: true,
          items: [
            { label: "AI Agent Integration", slug: "ai-agents/integration" },
            { label: "Machine-Readable Docs", slug: "ai-agents/machine-readable" },
          ],
        },
        {
          label: "Blog",
          collapsed: true,
          items: [
            { label: "Blog", slug: "blog" },
          ],
        },
      ],
    }),
  ],
});
