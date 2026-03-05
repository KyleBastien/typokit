// @typokit/nx — Route generator: scaffolds a route module
import type { Tree } from "@nx/devkit";
import { readProjectConfiguration } from "@nx/devkit";
import type { RouteGeneratorSchema } from "./schema.js";

export default async function routeGenerator(
  tree: Tree,
  options: RouteGeneratorSchema,
): Promise<void> {
  const projectName = options.project;
  let projectRoot = ".";
  if (projectName) {
    const projectConfig = readProjectConfiguration(tree, projectName);
    projectRoot = projectConfig.root;
  }

  const routeName = options.name;
  const pascalName = toPascalCase(routeName);
  const routeDir = `${projectRoot}/src/routes/${routeName}`;

  // Generate contracts.ts
  const contractsContent = `// Route contracts for ${routeName}
import type { RouteContract, HttpMethod } from "@typokit/types";

export const ${routeName}Contracts: RouteContract[] = [
  {
    method: "GET" as HttpMethod,
    path: "/${routeName}",
    name: "list${pascalName}",
    request: {},
    response: { status: 200 },
  },
  {
    method: "GET" as HttpMethod,
    path: "/${routeName}/:id",
    name: "get${pascalName}",
    request: {},
    response: { status: 200 },
  },
  {
    method: "POST" as HttpMethod,
    path: "/${routeName}",
    name: "create${pascalName}",
    request: {},
    response: { status: 201 },
  },
];
`;
  tree.write(`${routeDir}/contracts.ts`, contractsContent);

  // Generate handlers.ts
  const handlersContent = `// Route handlers for ${routeName}
import type { RequestContext } from "@typokit/types";

export function list${pascalName}(ctx: RequestContext): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function get${pascalName}(ctx: RequestContext): Response {
  const id = ctx.params["id"];
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function create${pascalName}(ctx: RequestContext): Response {
  return new Response(JSON.stringify({ created: true }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
`;
  tree.write(`${routeDir}/handlers.ts`, handlersContent);

  // Generate middleware.ts
  const middlewareContent = `// Route middleware for ${routeName}
import type { MiddlewareFn } from "@typokit/types";

export const ${routeName}Middleware: MiddlewareFn[] = [];
`;
  tree.write(`${routeDir}/middleware.ts`, middlewareContent);
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
