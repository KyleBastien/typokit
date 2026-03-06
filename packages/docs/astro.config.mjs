import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import starlightBlog from "starlight-blog";

export default defineConfig({
  site: "https://kylebastien.github.io",
  base: "/typokit",
  integrations: [
    starlight({
      title: "TypoKit",
      description: "Schema-first, type-safe API framework for TypeScript. Build robust APIs with full type safety from schema to client.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/typokit/typokit" },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://kylebastien.github.io/typokit/og-image.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:type", content: "image/png" } },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { property: "og:site_name", content: "TypoKit Documentation" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://kylebastien.github.io/typokit/og-image.png" } },
      ],
      plugins: [
        starlightBlog({
          title: "Blog",
          prefix: "blog",
        }),
        starlightTypeDoc({
          entryPoints: [
            "../core",
            "../types",
            "../errors",
            "../client",
            "../client-react-query",
            "../client-swr",
            "../server-express",
            "../server-fastify",
            "../server-hono",
            "../server-native",
            "../db-drizzle",
            "../db-kysely",
            "../db-prisma",
            "../db-raw",
            "../plugin-debug",
            "../plugin-ws",
            "../plugin-axum",
            "../transform-native",
            "../transform-typia",
            "../platform-bun",
            "../platform-deno",
            "../platform-node",
            "../testing",
            "../otel",
            "../cli",
          ],
          tsconfig: "../../tsconfig.json",
          output: "api-reference/generated",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            entryPointStrategy: "packages",
          },
          errorOnEmptyDocumentation: false,
        }),
      ],
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
            { label: "Building a Rust/Axum Server", slug: "guides/rust-axum-server" },
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
        typeDocSidebarGroup,
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

      ],
    }),
  ],
});
