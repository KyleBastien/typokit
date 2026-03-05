// @typokit/cli — Structured CLI logger

export interface CliLogger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  verbose(message: string): void;
  step(label: string, message: string): void;
}

export function createLogger(options: { verbose?: boolean }): CliLogger {
  const isVerbose = options.verbose ?? false;

  const write = (prefix: string, message: string): void => {
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as
      | {
          stderr: { write(s: string): void };
          stdout: { write(s: string): void };
        }
      | undefined;
    const out = proc?.stderr ?? { write: () => {} };
    out.write(`${prefix} ${message}\n`);
  };

  return {
    info(message: string) {
      write("[info]", message);
    },
    success(message: string) {
      write("[ok]", message);
    },
    warn(message: string) {
      write("[warn]", message);
    },
    error(message: string) {
      write("[error]", message);
    },
    verbose(message: string) {
      if (isVerbose) {
        write("[verbose]", message);
      }
    },
    step(label: string, message: string) {
      write(`[${label}]`, message);
    },
  };
}
