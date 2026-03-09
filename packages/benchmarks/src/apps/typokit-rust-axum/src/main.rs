mod db;
mod handlers;
mod middleware;
mod models;

use std::sync::{Arc, Mutex};

use axum::routing::{get, post};
use axum::Router;

use crate::db::open_db;
use crate::middleware::noop_middleware;

/// Shared application state passed to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
}

fn get_port() -> u16 {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--port" {
            if let Some(port_str) = args.get(i + 1) {
                return port_str.parse().expect("Invalid port number");
            }
        }
        i += 1;
    }
    std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000)
}

fn get_db_path() -> String {
    std::env::var("DB_PATH").unwrap_or_else(|_| "benchmark.sqlite".to_string())
}

#[tokio::main]
async fn main() {
    handlers::init_start_time();

    let db_path = get_db_path();
    let conn = open_db(&db_path);
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
    };

    // Build the /middleware route with 5 no-op layers
    let middleware_router = Router::new()
        .route("/middleware", get(handlers::get_middleware))
        .layer(axum::middleware::from_fn(noop_middleware))
        .layer(axum::middleware::from_fn(noop_middleware))
        .layer(axum::middleware::from_fn(noop_middleware))
        .layer(axum::middleware::from_fn(noop_middleware))
        .layer(axum::middleware::from_fn(noop_middleware));

    let app = Router::new()
        .route("/json", get(handlers::get_json))
        .route("/validate", post(handlers::post_validate))
        .route("/db/{id}", get(handlers::get_db))
        .route("/startup", get(handlers::get_startup))
        .merge(middleware_router)
        .with_state(state);

    let port = get_port();
    let addr = format!("0.0.0.0:{port}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|_| panic!("Failed to bind to {addr}"));

    eprintln!("TypoKit Axum benchmark listening on {addr}");

    axum::serve(listener, app).await.expect("Server error");
}
