// Todo service layer — business logic between handlers and repository.

use sqlx::postgres::PgPool;

use crate::db::repository;
use crate::error::AppError;
use crate::models::{
    CreateTodoInput, PaginatedResponse, PaginationMeta, PublicTodo, Todo, UpdateTodoInput,
};

fn to_public(todo: Todo) -> PublicTodo {
    PublicTodo {
        id: todo.id,
        title: todo.title,
        description: todo.description,
        completed: todo.completed,
        user_id: todo.user_id,
        created_at: todo.created_at,
        updated_at: todo.updated_at,
    }
}

pub async fn list(
    pool: &PgPool,
    page: u32,
    page_size: u32,
    user_id: Option<&str>,
    completed: Option<bool>,
) -> Result<PaginatedResponse<PublicTodo>, AppError> {
    let total = repository::count_todos(pool, user_id, completed)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    let todos = repository::find_todos_filtered(pool, page, page_size, user_id, completed)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    let total_pages = ((total as f64) / (page_size as f64)).ceil() as u32;

    Ok(PaginatedResponse {
        data: todos.into_iter().map(to_public).collect(),
        pagination: PaginationMeta {
            total,
            page,
            page_size,
            total_pages: total_pages.max(1),
        },
    })
}

pub async fn get_by_id(pool: &PgPool, id: &str) -> Result<PublicTodo, AppError> {
    let todo = repository::find_todo_by_id(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("Todo {} not found", id)))?;

    Ok(to_public(todo))
}

pub async fn create(pool: &PgPool, input: CreateTodoInput) -> Result<PublicTodo, AppError> {
    // Validate that the referenced user exists
    repository::find_user_by_id(pool, &input.user_id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| {
            AppError::bad_request(format!("User {} does not exist", input.user_id))
        })?;

    let todo = repository::create_todo(pool, &input)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(to_public(todo))
}

pub async fn update(
    pool: &PgPool,
    id: &str,
    input: UpdateTodoInput,
) -> Result<PublicTodo, AppError> {
    repository::find_todo_by_id(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("Todo {} not found", id)))?;

    let todo = repository::update_todo(pool, id, &input)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("Todo {} not found", id)))?;

    Ok(to_public(todo))
}

pub async fn delete(pool: &PgPool, id: &str) -> Result<(), AppError> {
    repository::find_todo_by_id(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .ok_or_else(|| AppError::not_found(format!("Todo {} not found", id)))?;

    repository::delete_todo(pool, id)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}
