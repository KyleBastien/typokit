// Minimal Web API type declarations for Bun platform adapter.
// These types are available in Bun natively, but we declare them here
// so the package compiles under Node16 moduleResolution without DOM lib.

declare class URL {
  constructor(url: string, base?: string);
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
}

declare class URLSearchParams {
  entries(): IterableIterator<[string, string]>;
}

declare class Headers {
  constructor();
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  forEach(callback: (value: string, key: string) => void): void;
}

declare class Request {
  constructor(input: string, init?: RequestInit);
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | null;
}

declare class Response {
  constructor(body?: string | null, init?: ResponseInit);
  readonly status: number;
  readonly headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

interface ResponseInit {
  status?: number;
  headers?: Record<string, string> | Headers;
}
