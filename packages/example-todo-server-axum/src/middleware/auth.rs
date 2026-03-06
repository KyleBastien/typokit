// Auth middleware stub — validates Bearer token from Authorization header.
//
// In production, replace the token parsing logic with proper JWT validation.

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};

/// Middleware that checks for an Authorization header with a Bearer token.
///
/// Usage in router:
/// ```
/// use axum::middleware;
/// Router::new()
///     .route("/protected", get(handler))
///     .layer(middleware::from_fn(auth::require_auth))
/// ```
pub async fn require_auth(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    match auth_header {
        Some(value) if value.starts_with("Bearer ") => {
            // Token present — pass through.
            // In production: validate JWT and extract claims here.
            Ok(next.run(request).await)
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
