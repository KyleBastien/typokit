#!/usr/bin/env node
// @typokit/cli — CLI binary entry point

import { run } from "./index.js";

const g = globalThis as Record<string, unknown>;
const proc = g["process"] as { argv: string[]; exit(code: number): void };

run(proc.argv).then(
  (code) => proc.exit(code),
  (err) => {
    const stderr = (
      proc as unknown as Record<string, { write(s: string): void }>
    )["stderr"];
    if (stderr?.write) {
      stderr.write(
        `[error] ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    proc.exit(1);
  },
);
