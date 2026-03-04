// Ambient type declarations for fetch API (available in Node 18+, Bun, Deno, browsers)
// We don't add DOM lib or @types/node to keep the package platform-agnostic.

declare class Headers {
  constructor(init?: Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
  forEach(callback: (value: string, key: string) => void): void;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly searchParams: URLSearchParams;
  toString(): string;
}

declare class URLSearchParams {
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  get(name: string): string | null;
  toString(): string;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

declare function fetch(url: string, init?: RequestInit): Promise<ResponseLike>;
