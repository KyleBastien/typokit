use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::models::{
    benchmark_response, validate_body, CreateBenchmarkItemBody, StartupResponse,
    ValidationErrorResponse,
};
use crate::AppState;

static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Initialize the startup timer (call once from main).
pub fn init_start_time() {
    START_TIME.get_or_init(std::time::Instant::now);
}

/// GET /json — returns the static benchmark response shape.
pub async fn get_json() -> Json<serde_json::Value> {
    Json(serde_json::to_value(benchmark_response()).unwrap())
}

/// POST /validate — validates the request body against the shared schema.
pub async fn post_validate(
    Json(body): Json<CreateBenchmarkItemBody>,
) -> Result<Json<CreateBenchmarkItemBody>, impl IntoResponse> {
    match validate_body(&body) {
        Ok(()) => Ok(Json(body)),
        Err(fields) => Err((
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                error: 400,
                message: "Validation failed".into(),
                fields,
            }),
        )),
    }
}

/// GET /db/{id} — fetches a benchmark item from SQLite by ID.
pub async fn get_db(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let db = state.db.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap();
        crate::db::get_item_by_id(&conn, id)
    })
    .await
    .unwrap();

    match result {
        Some(item) => Ok(Json(serde_json::to_value(item).unwrap())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": 404,
                "message": format!("Item {id} not found")
            })),
        )),
    }
}

/// GET /middleware — returns the static response (middleware layers applied externally).
pub async fn get_middleware() -> Json<serde_json::Value> {
    Json(serde_json::to_value(benchmark_response()).unwrap())
}

/// GET /startup — returns process uptime.
pub async fn get_startup() -> Json<StartupResponse> {
    let uptime = START_TIME
        .get()
        .map(|t| t.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    Json(StartupResponse { uptime })
}
