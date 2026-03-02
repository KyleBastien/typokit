// Minimal type declarations for Node.js APIs used by transform-native
// Avoids adding @types/node as a dependency

declare module "module" {
  export function createRequire(url: string | URL): (id: string) => unknown;
}

interface ImportMeta {
  url: string;
}
