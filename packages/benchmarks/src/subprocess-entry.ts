// subprocess-entry.ts — Generic server launcher for benchmark subprocess mode.
// Starts a benchmark app, prints the port to stdout, and keeps running until killed.
// Usage: <runtime> run src/subprocess-entry.ts <app-name>
// Output: BENCHMARK_PORT=<port> on stdout

interface AppModule {
  start: (
    dbPath?: string,
  ) => Promise<{ port: number; close: () => Promise<void> }>;
}

const appName = process.argv[2];
if (!appName) {
  console.error("Usage: subprocess-entry.ts <app-name>");
  process.exit(1);
}

const mod = (await import(`./apps/${appName}.ts`)) as AppModule;
const handle = await mod.start();

// Signal the port to the parent process
console.log(`BENCHMARK_PORT=${String(handle.port)}`);

const shutdown = async (): Promise<void> => {
  await handle.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Keep alive until parent signals
process.stdin.resume();
process.stdin.on("end", () => void shutdown());
