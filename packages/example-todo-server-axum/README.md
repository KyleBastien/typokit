# @typokit/example-todo-server-axum

A complete reference application demonstrating the TypoKit **Rust codegen target**.

TypeScript schemas from `@typokit/example-todo-schema` are compiled via
`typokit build --target rust` into a fully working **Axum** web server backed by
**PostgreSQL** and **sqlx**.

## Architecture

```
.typokit/          ← Generated code (regenerated on every build)
  models/          ← Rust structs with serde + validator + sqlx derives
  db/              ← PgPool connection & CRUD repository functions
  router.rs        ← Axum Router with typed route registrations
  app.rs           ← AppState (shared PgPool)
  error.rs         ← AppError enum → HTTP status codes
  migrations/      ← SQL migration files

src/               ← User-written code (never overwritten)
  handlers/        ← Axum handler functions (extract → service → respond)
  services/        ← Business logic layer (validation, transforms)
  middleware/      ← Auth middleware stub
  main.rs          ← Tokio entrypoint
  lib.rs           ← Module bridge (#[path] to .typokit/)
```

## Prerequisites

- [Rust](https://rustup.rs/) (1.85+ for edition 2024)
- [PostgreSQL](https://www.postgresql.org/) 16+
- The `sqlx` CLI (optional, for running migrations):
  ```bash
  cargo install sqlx-cli --no-default-features --features postgres
  ```

## Setup

1. **Create the database:**

   ```bash
   createdb typokit_todo_axum
   ```

2. **Set the connection string:**

   ```bash
   cp .env.example .env
   # or set directly:
   export DATABASE_URL=postgresql://localhost/typokit_todo_axum
   ```

3. **Run migrations:**

   ```bash
   psql $DATABASE_URL -f .typokit/migrations/000000000001_create_users.sql
   psql $DATABASE_URL -f .typokit/migrations/000000000002_create_todos.sql
   ```

4. **Build and run:**

   ```bash
   cargo build
   cargo run
   ```

   The server starts on `http://localhost:3000`.

## API Endpoints

Endpoints match the TypeScript `example-todo-server` identically:

### Users

| Method | Path          | Description       |
|--------|---------------|-------------------|
| GET    | /users        | List users        |
| POST   | /users        | Create a user     |
| GET    | /users/:id    | Get user by ID    |
| PUT    | /users/:id    | Update a user     |
| DELETE | /users/:id    | Soft-delete user  |

### Todos

| Method | Path          | Description       |
|--------|---------------|-------------------|
| GET    | /todos        | List todos        |
| POST   | /todos        | Create a todo     |
| GET    | /todos/:id    | Get todo by ID    |
| PUT    | /todos/:id    | Update a todo     |
| DELETE | /todos/:id    | Delete a todo     |

## Examples

```bash
# Create a user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "displayName": "Alice"}'

# List users with pagination
curl "http://localhost:3000/users?page=1&pageSize=10"

# Create a todo (replace USER_ID with actual ID)
curl -X POST http://localhost:3000/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy groceries", "userId": "USER_ID"}'

# List todos filtered by user
curl "http://localhost:3000/todos?userId=USER_ID"

# Update a todo
curl -X PUT http://localhost:3000/todos/TODO_ID \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'

# Delete a todo
curl -X DELETE http://localhost:3000/todos/TODO_ID
```

## Generating from Schema

To regenerate the `.typokit/` directory from TypeScript sources:

```bash
npx typokit build --target rust --out packages/example-todo-server-axum
```

This reads the route contracts and entity types from `@typokit/example-todo-schema`
and emits all files under `.typokit/`. User code in `src/` is never overwritten.
