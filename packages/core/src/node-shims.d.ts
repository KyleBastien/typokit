// Minimal type declarations for Node.js modules used by cluster support.
// Keeps @typokit/core free of a hard @types/node dependency.

declare module "node:cluster" {
  interface Worker {
    on(event: "listening", cb: (address: { port: number }) => void): Worker;
    on(event: "exit", cb: () => void): Worker;
    disconnect(): void;
    isDead(): boolean;
    process: { kill(signal: string): void };
  }

  const isPrimary: boolean;
  function fork(env?: Record<string, string>): Worker;

  export { isPrimary, fork };
  export type { Worker };
  export default { isPrimary, fork };
}

declare module "node:os" {
  function availableParallelism(): number;
  function cpus(): { model: string }[];
  export { availableParallelism, cpus };
}

// Minimal timer globals for cluster shutdown logic
declare function setTimeout(cb: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
