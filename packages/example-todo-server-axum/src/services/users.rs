// User service layer — business logic between handlers and repository.

use sqlx::postgres::PgPool;

use crate::db::repository;
use crate::error::AppError;
use crate::models::{
    CreateUserInput, PaginatedResponse, PaginationMeta, PublicUser, UpdateUserInput, User,
};

fn to_public(user: User) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
    }
}

pub async fn list(
    pool: &PgPool,
    page: u32,
    page_size: u32,
) -> Result<PaginatedResponse<PublicUser>, AppError> {
    let total = repository::count_users(pool)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    let users = repository::find_all_users(pool, page, page_size)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedResponse {
        data: users.into_iter().map(to_public).collect(),
        pagination: PaginationMeta {
            total,
            page,
            page_size,
            total_pages: total_pages.max(1),
        },
    })
}

pub async fn get_by_id(pool: &PgPool, id: &str) -> Result<PublicUser, AppError> {
    let user = repository::find_user_by_id(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("User {} not found", id)))?;

    Ok(to_public(user))
}

pub async fn create(pool: &PgPool, input: CreateUserInput) -> Result<PublicUser, AppError> {
    // Check for duplicate email
    let existing = repository::find_user_by_email(pool, &input.email)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    if existing.is_some() {
        return Err(AppError::conflict(format!(
            "User with email {} already exists",
            input.email
        )));
    }

    let user = repository::create_user(pool, &input)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(to_public(user))
}

pub async fn update(
    pool: &PgPool,
    id: &str,
    input: UpdateUserInput,
) -> Result<PublicUser, AppError> {
    // Check user exists
    repository::find_user_by_id(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("User {} not found", id)))?;

    // Check email uniqueness if changing email
    if let Some(ref email) = input.email {
        let existing = repository::find_user_by_email(pool, email)
            .await
            .map_err(|e| AppError::internal(e.to_string()))?;

        if let Some(dup) = existing {
            if dup.id != id {
                return Err(AppError::conflict(format!(
                    "User with email {} already exists",
                    email
                )));
            }
        }
    }

    let user = repository::update_user(pool, id, &input)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("User {} not found", id)))?;

    Ok(to_public(user))
}
