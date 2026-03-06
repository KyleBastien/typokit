// User route handlers — implementing the full UsersRoutes contract.

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::app::AppState;
use crate::error::AppError;
use crate::models::{CreateUserInput, PublicUser, UpdateUserInput, UserStatus};
use crate::services;

#[derive(Debug, Deserialize)]
pub struct ListUsersQuery {
    pub page: Option<u32>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
}

/// GET /users — list users with pagination.
pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);

    let result = services::users::list(&state.pool, page, page_size).await?;
    Ok(Json(serde_json::to_value(result).unwrap()))
}

/// POST /users — create a new user.
pub async fn create(
    State(state): State<AppState>,
    Json(input): Json<CreateUserInput>,
) -> Result<(StatusCode, Json<PublicUser>), AppError> {
    let user = services::users::create(&state.pool, input).await?;
    Ok((StatusCode::CREATED, Json(user)))
}

/// GET /users/:id — get a user by ID.
pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PublicUser>, AppError> {
    let user = services::users::get_by_id(&state.pool, &id).await?;
    Ok(Json(user))
}

/// PUT /users/:id — update a user.
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateUserInput>,
) -> Result<Json<PublicUser>, AppError> {
    let user = services::users::update(&state.pool, &id, input).await?;
    Ok(Json(user))
}

/// DELETE /users/:id — soft-delete a user (sets status to deleted).
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    // Soft delete: set status to "deleted" (matching TypeScript example)
    services::users::update(
        &state.pool,
        &id,
        UpdateUserInput {
            email: None,
            display_name: None,
            status: Some(UserStatus::Deleted),
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
