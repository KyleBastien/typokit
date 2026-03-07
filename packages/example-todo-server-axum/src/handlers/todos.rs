// Todo route handlers — implementing the full TodosRoutes contract.

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::app::AppState;
use crate::error::AppError;
use crate::models::{CreateTodoInput, PublicTodo, UpdateTodoInput};
use crate::services;

#[derive(Debug, Deserialize)]
pub struct ListTodosQuery {
    pub page: Option<u32>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    pub completed: Option<bool>,
}

/// GET /todos — list todos with pagination and optional filters.
pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListTodosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);

    let result = services::todos::list(
        &state.pool,
        page,
        page_size,
        query.user_id.as_deref(),
        query.completed,
    )
    .await?;
    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// POST /todos — create a new todo.
pub async fn create(
    State(state): State<AppState>,
    Json(input): Json<CreateTodoInput>,
) -> Result<(StatusCode, Json<PublicTodo>), AppError> {
    let todo = services::todos::create(&state.pool, input).await?;
    Ok((StatusCode::CREATED, Json(todo)))
}

/// GET /todos/:id — get a todo by ID.
pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PublicTodo>, AppError> {
    let todo = services::todos::get_by_id(&state.pool, &id).await?;
    Ok(Json(todo))
}

/// PUT /todos/:id — update a todo.
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateTodoInput>,
) -> Result<Json<PublicTodo>, AppError> {
    let todo = services::todos::update(&state.pool, &id, input).await?;
    Ok(Json(todo))
}

/// DELETE /todos/:id — delete a todo.
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    services::todos::delete(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}
