use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;

/// A no-op middleware that passes the request through unchanged.
/// Used to measure middleware chain overhead.
pub async fn noop_middleware(request: Request, next: Next) -> Response {
    next.run(request).await
}
