// @typokit/testing — Test Client

import type { TypoKitApp } from "@typokit/core";
import type { RouteContract } from "@typokit/types";

// ─── Response Type ───────────────────────────────────────────

/** Response returned by test client methods */
export interface TestResponse<TBody = unknown> {
  status: number;
  body: TBody;
  headers: Record<string, string>;
}

// ─── Request Options ─────────────────────────────────────────

/** Options for test client request methods */
export interface TestRequestOptions {
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
}

/** Type-safe request options using a RouteContract */
export interface TypedRequestOptions<TContract extends RouteContract> {
  body?: TContract["body"] extends void ? never : TContract["body"];
  query?: TContract["query"] extends void ? never : TContract["query"];
  headers?: Record<string, string>;
}

// ─── Test Client Interface ───────────────────────────────────

/** A test client for making typed HTTP requests against a TypoKit app */
export interface TestClient {
  /** Send a GET request */
  get<TResponse = unknown>(
    path: string,
    options?: TestRequestOptions,
  ): Promise<TestResponse<TResponse>>;

  /** Send a POST request */
  post<TResponse = unknown>(
    path: string,
    options?: TestRequestOptions,
  ): Promise<TestResponse<TResponse>>;

  /** Send a PUT request */
  put<TResponse = unknown>(
    path: string,
    options?: TestRequestOptions,
  ): Promise<TestResponse<TResponse>>;

  /** Send a PATCH request */
  patch<TResponse = unknown>(
    path: string,
    options?: TestRequestOptions,
  ): Promise<TestResponse<TResponse>>;

  /** Send a DELETE request */
  delete<TResponse = unknown>(
    path: string,
    options?: TestRequestOptions,
  ): Promise<TestResponse<TResponse>>;

  /** Send a contract-typed request */
  request<TContract extends RouteContract>(
    method: string,
    path: string,
    options?: TypedRequestOptions<TContract>,
  ): Promise<TestResponse<TContract["response"]>>;

  /** Shut down the test server */
  close(): Promise<void>;

  /** The base URL the test server is listening on */
  baseUrl: string;
}

// ─── Internal Helpers ────────────────────────────────────────

/** Build a URL with query parameters */
function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | string[]>,
): string {
  let url = `${base}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          params.append(key, v);
        }
      } else {
        params.append(key, value);
      }
    }
    url += `?${params.toString()}`;
  }
  return url;
}

/** Parse response headers into a flat Record */
function parseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** Execute an HTTP request and return a TestResponse */
async function executeRequest<TResponse>(
  baseUrl: string,
  method: string,
  path: string,
  options: TestRequestOptions = {},
): Promise<TestResponse<TResponse>> {
  const url = buildUrl(baseUrl, path, options.query);

  const headers: Record<string, string> = { ...options.headers };
  let bodyStr: string | undefined;

  if (options.body !== undefined) {
    if (!headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    bodyStr =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: bodyStr,
  });

  const responseHeaders = parseHeaders(response.headers);

  const contentType = response.headers.get("content-type") ?? "";
  let body: TResponse;
  if (contentType.includes("application/json")) {
    body = (await response.json()) as TResponse;
  } else {
    body = (await response.text()) as unknown as TResponse;
  }

  return {
    status: response.status,
    body,
    headers: responseHeaders,
  };
}

// ─── createTestClient ────────────────────────────────────────

/**
 * Create a test client for a TypoKit application.
 *
 * Starts the app on a random port and returns a typed HTTP client.
 * Call `client.close()` when done to shut down the server.
 *
 * ```ts
 * const client = await createTestClient(app);
 * const res = await client.get<{ message: string }>("/hello");
 * expect(res.status).toBe(200);
 * await client.close();
 * ```
 */
export async function createTestClient(app: TypoKitApp): Promise<TestClient> {
  // Start on port 0 for auto-assigned random port
  await app.listen(0);

  // Get the actual port from the underlying server
  const nativeServer = app.getNativeServer() as {
    address(): { port: number } | string | null;
  };
  const addr = nativeServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to determine server port");
  }
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const client: TestClient = {
    baseUrl,

    get<TResponse = unknown>(
      path: string,
      options?: TestRequestOptions,
    ): Promise<TestResponse<TResponse>> {
      return executeRequest<TResponse>(baseUrl, "GET", path, options);
    },

    post<TResponse = unknown>(
      path: string,
      options?: TestRequestOptions,
    ): Promise<TestResponse<TResponse>> {
      return executeRequest<TResponse>(baseUrl, "POST", path, options);
    },

    put<TResponse = unknown>(
      path: string,
      options?: TestRequestOptions,
    ): Promise<TestResponse<TResponse>> {
      return executeRequest<TResponse>(baseUrl, "PUT", path, options);
    },

    patch<TResponse = unknown>(
      path: string,
      options?: TestRequestOptions,
    ): Promise<TestResponse<TResponse>> {
      return executeRequest<TResponse>(baseUrl, "PATCH", path, options);
    },

    delete<TResponse = unknown>(
      path: string,
      options?: TestRequestOptions,
    ): Promise<TestResponse<TResponse>> {
      return executeRequest<TResponse>(baseUrl, "DELETE", path, options);
    },

    request<TContract extends RouteContract>(
      method: string,
      path: string,
      options?: TypedRequestOptions<TContract>,
    ): Promise<TestResponse<TContract["response"]>> {
      return executeRequest(baseUrl, method, path, options as TestRequestOptions);
    },

    async close(): Promise<void> {
      await app.close();
    },
  };

  return client;
}

