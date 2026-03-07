use std::collections::{BTreeMap, BTreeSet, HashMap};

use typokit_transform_native::route_compiler::{PathSegment, RouteEntry};
use typokit_transform_native::type_extractor::TypeMetadata;
use super::GeneratedOutput;

/// Info about a handler action derived from a route.
struct HandlerAction {
    action: String,
    has_path_param: bool,
}

/// Resolved entity information for handler generation.
struct EntityInfo {
    /// PascalCase entity name (e.g., "User")
    name: String,
    /// snake_case entity name (e.g., "user")
    snake_name: String,
    /// Whether this entity has @table annotation (repository functions exist)
    is_table: bool,
    /// Rust type for the ID field in extractors (e.g., "String", "i64")
    id_type: String,
    /// Input struct name for create/update (e.g., "UserWithoutId")
    input_struct: String,
}

/// Generate per-entity handler files and a handlers/mod.rs from routes.
///
/// Produces:
/// - `src/handlers/{entity}.rs` per entity with handler functions (overwrite: false)
/// - `src/handlers/mod.rs` with pub mod declarations (overwrite: true)
pub fn generate_handlers(
    type_map: &HashMap<String, TypeMetadata>,
    routes: &[RouteEntry],
) -> Vec<GeneratedOutput> {
    let mut outputs = Vec::new();

    let entity_groups = group_routes_by_entity(routes);

    let mut module_names: Vec<String> = Vec::new();

    for (module_name, raw_prefix, actions) in &entity_groups {
        module_names.push(module_name.clone());
        let entity_info = resolve_entity_info(raw_prefix, type_map);
        let content = generate_entity_handler_file(&entity_info, actions);
        outputs.push(GeneratedOutput {
            path: format!("src/handlers/{}.rs", module_name),
            content,
            overwrite: false,
        });
    }

    module_names.sort();
    outputs.push(generate_handlers_mod(&module_names));

    outputs
}

/// Group routes by entity module and collect handler actions.
///
/// Returns Vec of (module_name, raw_prefix, actions).
/// Uses BTreeMap for deterministic ordering.
fn group_routes_by_entity(
    routes: &[RouteEntry],
) -> Vec<(String, String, Vec<HandlerAction>)> {
    let mut groups: BTreeMap<String, (String, Vec<HandlerAction>)> = BTreeMap::new();

    let mut sorted_routes: Vec<&RouteEntry> = routes.iter().collect();
    sorted_routes.sort_by(|a, b| {
        a.handler_ref
            .cmp(&b.handler_ref)
            .then(a.method.cmp(&b.method))
    });

    for route in sorted_routes {
        let (module_name, raw_prefix) = derive_module_info(&route.handler_ref);
        let action = derive_action_name(route);
        let has_path_param = route
            .segments
            .iter()
            .any(|s| matches!(s, PathSegment::Param(_)));

        groups
            .entry(module_name)
            .or_insert_with(|| (raw_prefix, Vec::new()))
            .1
            .push(HandlerAction {
                action,
                has_path_param,
            });
    }

    groups
        .into_iter()
        .map(|(module, (prefix, actions))| (module, prefix, actions))
        .collect()
}

/// Derive module name and raw prefix from a handler_ref string.
///
/// "UsersRoutes#GET /users" → module = "users", prefix = "Users"
fn derive_module_info(handler_ref: &str) -> (String, String) {
    let contract_name = handler_ref.split('#').next().unwrap_or(handler_ref);
    let raw_prefix = contract_name
        .strip_suffix("Routes")
        .or_else(|| contract_name.strip_suffix("Route"))
        .unwrap_or(contract_name)
        .to_string();
    let module_name = to_snake_case(&raw_prefix);
    (module_name, raw_prefix)
}

/// Derive handler action name from route method and path.
///
/// Follows REST conventions identical to router.rs.
fn derive_action_name(route: &RouteEntry) -> String {
    let has_param = route
        .segments
        .iter()
        .any(|s| matches!(s, PathSegment::Param(_)));
    match (route.method.as_str(), has_param) {
        ("GET", false) => "list".to_string(),
        ("GET", true) => "get_by_id".to_string(),
        ("POST", false) => "create".to_string(),
        ("PUT", true) | ("PATCH", true) => "update".to_string(),
        ("DELETE", true) => "delete".to_string(),
        (method, _) => method.to_lowercase(),
    }
}

/// Resolve entity info from the raw prefix (e.g., "Users") using type_map.
fn resolve_entity_info(
    raw_prefix: &str,
    type_map: &HashMap<String, TypeMetadata>,
) -> EntityInfo {
    let entity_name = resolve_entity_name(raw_prefix, type_map);
    let snake_name = to_snake_case(&entity_name);

    let (is_table, id_type) = if let Some(meta) = type_map.get(&entity_name) {
        (is_table_entity(meta), find_id_type(meta))
    } else {
        (false, "String".to_string())
    };

    let input_struct = format!("{}WithoutId", entity_name);

    EntityInfo {
        name: entity_name,
        snake_name,
        is_table,
        id_type,
        input_struct,
    }
}

/// Find entity name in type_map from the raw prefix (e.g., "Users" → "User").
fn resolve_entity_name(raw_prefix: &str, type_map: &HashMap<String, TypeMetadata>) -> String {
    // Exact match
    if type_map.contains_key(raw_prefix) {
        return raw_prefix.to_string();
    }

    // Singular: strip trailing 's'
    if let Some(singular) = raw_prefix.strip_suffix('s') {
        if !singular.is_empty() && type_map.contains_key(singular) {
            return singular.to_string();
        }
    }

    // "ies" → "y" (e.g., "Categories" → "Category")
    if let Some(stem) = raw_prefix.strip_suffix("ies") {
        let singular = format!("{}y", stem);
        if type_map.contains_key(&singular) {
            return singular;
        }
    }

    // Fallback: best-effort singular
    raw_prefix
        .strip_suffix('s')
        .filter(|s| !s.is_empty())
        .unwrap_or(raw_prefix)
        .to_string()
}

/// Check if a TypeMetadata has the @table JSDoc annotation.
fn is_table_entity(meta: &TypeMetadata) -> bool {
    meta.jsdoc
        .as_ref()
        .map(|j| j.contains_key("table"))
        .unwrap_or(false)
}

/// Find the Rust type for the @id property (used in Path<T> extractor).
fn find_id_type(meta: &TypeMetadata) -> String {
    // Explicit @id annotation
    for (_name, prop) in &meta.properties {
        if prop
            .jsdoc
            .as_ref()
            .map(|j| j.contains_key("id"))
            .unwrap_or(false)
        {
            return id_rust_type(&prop.type_str);
        }
    }
    // Fall back to property named "id"
    if let Some(prop) = meta.properties.get("id") {
        return id_rust_type(&prop.type_str);
    }
    "String".to_string()
}

/// Map TS type to Rust type for ID fields in handler extractors.
fn id_rust_type(type_str: &str) -> String {
    match type_str {
        "string" => "String".to_string(),
        "number" => "i64".to_string(),
        _ => "String".to_string(),
    }
}

// ─────────────────────────── File Generation ─────────────────────────────────

/// Generate handler file content for a single entity.
fn generate_entity_handler_file(entity: &EntityInfo, actions: &[HandlerAction]) -> String {
    let mut output = String::new();

    // Deduplicate actions (e.g., PUT + PATCH both produce "update")
    let mut seen = BTreeSet::new();
    let unique_actions: Vec<&HandlerAction> = actions
        .iter()
        .filter(|a| seen.insert(a.action.clone()))
        .collect();

    output.push_str("// AUTO-GENERATED by @typokit/transform-native\n");
    output.push_str("// This file will NOT be overwritten — edit freely.\n\n");

    // Determine needed imports
    let needs_path = unique_actions.iter().any(|a| a.has_path_param);
    let needs_query = unique_actions.iter().any(|a| a.action == "list");
    let needs_json = unique_actions
        .iter()
        .any(|a| matches!(a.action.as_str(), "create" | "update" | "list" | "get_by_id"));
    let needs_status_code = unique_actions
        .iter()
        .any(|a| matches!(a.action.as_str(), "create" | "delete"));

    // Axum imports
    output.push_str("use axum::extract::State;\n");
    if needs_path {
        output.push_str("use axum::extract::Path;\n");
    }
    if needs_query {
        output.push_str("use axum::extract::Query;\n");
    }
    if needs_status_code {
        output.push_str("use axum::http::StatusCode;\n");
    }
    if needs_json {
        output.push_str("use axum::Json;\n");
    }

    // Crate imports
    output.push_str("use crate::app::AppState;\n");
    if entity.is_table {
        output.push_str("use crate::db::repository;\n");
    }
    output.push_str("use crate::error::AppError;\n");
    if needs_json {
        output.push_str("use crate::models;\n");
    }

    // ListQuery struct for list endpoints
    if needs_query {
        output.push_str("\n/// Pagination query parameters for list endpoints.\n");
        output.push_str("#[derive(Debug, serde::Deserialize)]\n");
        output.push_str("pub struct ListQuery {\n");
        output.push_str("    pub page: Option<u32>,\n");
        output.push_str("    pub page_size: Option<u32>,\n");
        output.push_str("}\n");
    }

    // Handler functions
    for action in &unique_actions {
        output.push('\n');
        match action.action.as_str() {
            "list" => output.push_str(&generate_list_handler(entity)),
            "create" => output.push_str(&generate_create_handler(entity)),
            "get_by_id" => output.push_str(&generate_get_by_id_handler(entity)),
            "update" => output.push_str(&generate_update_handler(entity)),
            "delete" => output.push_str(&generate_delete_handler(entity)),
            other => output.push_str(&generate_fallback_handler(other)),
        }
    }

    output
}

fn generate_list_handler(entity: &EntityInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "/// List all {}s with pagination.\n",
        entity.snake_name
    ));
    s.push_str("pub async fn list(\n");
    s.push_str("    State(state): State<AppState>,\n");
    s.push_str("    Query(query): Query<ListQuery>,\n");
    s.push_str(&format!(
        ") -> Result<Json<Vec<models::{}>>, AppError> {{\n",
        entity.name
    ));
    s.push_str("    let page = query.page.unwrap_or(1);\n");
    s.push_str("    let page_size = query.page_size.unwrap_or(20);\n");

    if entity.is_table {
        s.push_str(&format!(
            "    let results = repository::find_all_{}(&state.pool, page, page_size).await?;\n",
            entity.snake_name
        ));
        s.push_str("    Ok(Json(results))\n");
    } else {
        s.push_str("    // TODO: Implement list logic\n");
        s.push_str("    let _ = (state, page, page_size);\n");
        s.push_str("    Ok(Json(vec![]))\n");
    }

    s.push_str("}\n");
    s
}

fn generate_create_handler(entity: &EntityInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!("/// Create a new {}.\n", entity.snake_name));
    s.push_str("pub async fn create(\n");
    s.push_str("    State(state): State<AppState>,\n");
    s.push_str(&format!(
        "    Json(input): Json<models::{}>,\n",
        entity.input_struct
    ));
    s.push_str(&format!(
        ") -> Result<(StatusCode, Json<models::{}>), AppError> {{\n",
        entity.name
    ));

    if entity.is_table {
        s.push_str(&format!(
            "    let created = repository::create_{}(&state.pool, &input).await?;\n",
            entity.snake_name
        ));
        s.push_str("    Ok((StatusCode::CREATED, Json(created)))\n");
    } else {
        s.push_str("    // TODO: Implement create logic\n");
        s.push_str("    let _ = (state, input);\n");
        s.push_str("    todo!()\n");
    }

    s.push_str("}\n");
    s
}

fn generate_get_by_id_handler(entity: &EntityInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!("/// Get a {} by ID.\n", entity.snake_name));
    s.push_str("pub async fn get_by_id(\n");
    s.push_str("    State(state): State<AppState>,\n");
    s.push_str(&format!(
        "    Path(id): Path<{}>,\n",
        entity.id_type
    ));
    s.push_str(&format!(
        ") -> Result<Json<models::{}>, AppError> {{\n",
        entity.name
    ));

    if entity.is_table {
        s.push_str(&format!(
            "    match repository::find_{}_by_id(&state.pool, &id).await? {{\n",
            entity.snake_name
        ));
        s.push_str("        Some(entity) => Ok(Json(entity)),\n");
        s.push_str(&format!(
            "        None => Err(AppError::NotFound(\"{} not found\".to_string())),\n",
            entity.name
        ));
        s.push_str("    }\n");
    } else {
        s.push_str("    // TODO: Implement get_by_id logic\n");
        s.push_str("    let _ = (state, id);\n");
        s.push_str("    todo!()\n");
    }

    s.push_str("}\n");
    s
}

fn generate_update_handler(entity: &EntityInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!("/// Update a {} by ID.\n", entity.snake_name));
    s.push_str("pub async fn update(\n");
    s.push_str("    State(state): State<AppState>,\n");
    s.push_str(&format!(
        "    Path(id): Path<{}>,\n",
        entity.id_type
    ));
    s.push_str(&format!(
        "    Json(input): Json<models::{}>,\n",
        entity.input_struct
    ));
    s.push_str(&format!(
        ") -> Result<Json<models::{}>, AppError> {{\n",
        entity.name
    ));

    if entity.is_table {
        s.push_str(&format!(
            "    match repository::update_{}(&state.pool, &id, &input).await? {{\n",
            entity.snake_name
        ));
        s.push_str("        Some(entity) => Ok(Json(entity)),\n");
        s.push_str(&format!(
            "        None => Err(AppError::NotFound(\"{} not found\".to_string())),\n",
            entity.name
        ));
        s.push_str("    }\n");
    } else {
        s.push_str("    // TODO: Implement update logic\n");
        s.push_str("    let _ = (state, id, input);\n");
        s.push_str("    todo!()\n");
    }

    s.push_str("}\n");
    s
}

fn generate_delete_handler(entity: &EntityInfo) -> String {
    let mut s = String::new();
    s.push_str(&format!("/// Delete a {} by ID.\n", entity.snake_name));
    s.push_str("pub async fn delete(\n");
    s.push_str("    State(state): State<AppState>,\n");
    s.push_str(&format!(
        "    Path(id): Path<{}>,\n",
        entity.id_type
    ));
    s.push_str(") -> Result<StatusCode, AppError> {\n");

    if entity.is_table {
        s.push_str(&format!(
            "    match repository::delete_{}(&state.pool, &id).await? {{\n",
            entity.snake_name
        ));
        s.push_str("        Some(_) => Ok(StatusCode::NO_CONTENT),\n");
        s.push_str(&format!(
            "        None => Err(AppError::NotFound(\"{} not found\".to_string())),\n",
            entity.name
        ));
        s.push_str("    }\n");
    } else {
        s.push_str("    // TODO: Implement delete logic\n");
        s.push_str("    let _ = (state, id);\n");
        s.push_str("    todo!()\n");
    }

    s.push_str("}\n");
    s
}

fn generate_fallback_handler(action: &str) -> String {
    let mut s = String::new();
    s.push_str(&format!("/// {} handler stub.\n", action));
    s.push_str(&format!("pub async fn {}(\n", action));
    s.push_str("    State(_state): State<AppState>,\n");
    s.push_str(") -> Result<StatusCode, AppError> {\n");
    s.push_str(&format!("    // TODO: Implement {} logic\n", action));
    s.push_str("    todo!()\n");
    s.push_str("}\n");
    s
}

/// Generate the `src/handlers/mod.rs` with pub mod declarations.
fn generate_handlers_mod(module_names: &[String]) -> GeneratedOutput {
    let mut output = String::new();
    output.push_str("// AUTO-GENERATED by @typokit/transform-native — DO NOT EDIT\n\n");

    for name in module_names {
        output.push_str(&format!("pub mod {};\n", name));
    }

    GeneratedOutput {
        path: "src/handlers/mod.rs".to_string(),
        content: output,
        overwrite: true,
    }
}

/// Convert a camelCase or PascalCase string to snake_case.
fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use typokit_transform_native::route_compiler::{PathSegment, RouteEntry, RouteTypeInfo};
    use typokit_transform_native::type_extractor::PropertyMetadata;

    fn make_route(method: &str, path: &str, handler_ref: &str) -> RouteEntry {
        let segments = path
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| {
                if let Some(param) = s.strip_prefix(':') {
                    PathSegment::Param(param.to_string())
                } else {
                    PathSegment::Static(s.to_string())
                }
            })
            .collect();

        RouteEntry {
            method: method.to_string(),
            path: path.to_string(),
            segments,
            handler_ref: handler_ref.to_string(),
            params_type: RouteTypeInfo::Void,
            query_type: RouteTypeInfo::Void,
            body_type: RouteTypeInfo::Void,
            response_type: RouteTypeInfo::Void,
        }
    }

    fn make_table_entity(name: &str) -> (String, TypeMetadata) {
        let mut jsdoc = HashMap::new();
        jsdoc.insert("table".to_string(), String::new());

        let mut properties = HashMap::new();
        let mut id_jsdoc = HashMap::new();
        id_jsdoc.insert("id".to_string(), String::new());
        id_jsdoc.insert("generated".to_string(), "uuid".to_string());
        properties.insert(
            "id".to_string(),
            PropertyMetadata {
                type_str: "string".to_string(),
                optional: false,
                jsdoc: Some(id_jsdoc),
            },
        );
        properties.insert(
            "name".to_string(),
            PropertyMetadata {
                type_str: "string".to_string(),
                optional: false,
                jsdoc: None,
            },
        );

        (
            name.to_string(),
            TypeMetadata {
                name: name.to_string(),
                properties,
                jsdoc: Some(jsdoc),
            },
        )
    }

    #[test]
    fn test_generate_handlers_basic_crud() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("POST", "/users", "UsersRoutes#POST /users"),
            make_route("GET", "/users/:id", "UsersRoutes#GET /users/:id"),
            make_route("PUT", "/users/:id", "UsersRoutes#PUT /users/:id"),
            make_route("DELETE", "/users/:id", "UsersRoutes#DELETE /users/:id"),
        ];

        let outputs = generate_handlers(&type_map, &routes);

        assert_eq!(outputs.len(), 2); // users.rs + mod.rs

        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();
        assert!(!handler.overwrite);
        assert!(handler.content.contains("pub async fn list("));
        assert!(handler.content.contains("pub async fn create("));
        assert!(handler.content.contains("pub async fn get_by_id("));
        assert!(handler.content.contains("pub async fn update("));
        assert!(handler.content.contains("pub async fn delete("));

        let mod_file = outputs
            .iter()
            .find(|o| o.path == "src/handlers/mod.rs")
            .unwrap();
        assert!(mod_file.overwrite);
        assert!(mod_file.content.contains("pub mod users;"));
    }

    #[test]
    fn test_handler_calls_repository() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("POST", "/users", "UsersRoutes#POST /users"),
            make_route("GET", "/users/:id", "UsersRoutes#GET /users/:id"),
            make_route("PUT", "/users/:id", "UsersRoutes#PUT /users/:id"),
            make_route("DELETE", "/users/:id", "UsersRoutes#DELETE /users/:id"),
        ];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("repository::find_all_user"));
        assert!(handler.content.contains("repository::create_user"));
        assert!(handler.content.contains("repository::find_user_by_id"));
        assert!(handler.content.contains("repository::update_user"));
        assert!(handler.content.contains("repository::delete_user"));
    }

    #[test]
    fn test_list_handler_uses_query_extractor() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("Todo");
        type_map.insert(name, meta);

        let routes = vec![make_route("GET", "/todos", "TodosRoutes#GET /todos")];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/todos.rs")
            .unwrap();

        assert!(handler.content.contains("Query(query): Query<ListQuery>"));
        assert!(handler.content.contains("pub struct ListQuery"));
        assert!(handler.content.contains("page: Option<u32>"));
        assert!(handler.content.contains("page_size: Option<u32>"));
    }

    #[test]
    fn test_create_handler_returns_status_created() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route("POST", "/users", "UsersRoutes#POST /users")];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("StatusCode::CREATED"));
        assert!(handler.content.contains("Json<models::UserWithoutId>"));
    }

    #[test]
    fn test_get_by_id_returns_not_found() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route(
            "GET",
            "/users/:id",
            "UsersRoutes#GET /users/:id",
        )];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("Path(id): Path<String>"));
        assert!(handler.content.contains("AppError::NotFound"));
        assert!(handler.content.contains("User not found"));
    }

    #[test]
    fn test_update_handler_returns_not_found() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route(
            "PUT",
            "/users/:id",
            "UsersRoutes#PUT /users/:id",
        )];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("repository::update_user"));
        assert!(handler.content.contains("AppError::NotFound"));
        assert!(handler
            .content
            .contains("Json(input): Json<models::UserWithoutId>"));
    }

    #[test]
    fn test_delete_handler_returns_no_content() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route(
            "DELETE",
            "/users/:id",
            "UsersRoutes#DELETE /users/:id",
        )];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("StatusCode::NO_CONTENT"));
        assert!(handler.content.contains("repository::delete_user"));
    }

    #[test]
    fn test_all_handlers_use_state_extractor() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("POST", "/users", "UsersRoutes#POST /users"),
            make_route("GET", "/users/:id", "UsersRoutes#GET /users/:id"),
            make_route("PUT", "/users/:id", "UsersRoutes#PUT /users/:id"),
            make_route("DELETE", "/users/:id", "UsersRoutes#DELETE /users/:id"),
        ];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        // Count occurrences of State(state): State<AppState>
        let state_count = handler
            .content
            .matches("State(state): State<AppState>")
            .count();
        assert_eq!(state_count, 5, "All 5 handlers should use State extractor");
    }

    #[test]
    fn test_multiple_entities() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);
        let (name, meta) = make_table_entity("Todo");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("GET", "/todos", "TodosRoutes#GET /todos"),
            make_route("POST", "/todos", "TodosRoutes#POST /todos"),
        ];

        let outputs = generate_handlers(&type_map, &routes);

        assert!(outputs.iter().any(|o| o.path == "src/handlers/users.rs"));
        assert!(outputs.iter().any(|o| o.path == "src/handlers/todos.rs"));

        let mod_file = outputs
            .iter()
            .find(|o| o.path == "src/handlers/mod.rs")
            .unwrap();
        assert!(mod_file.content.contains("pub mod todos;"));
        assert!(mod_file.content.contains("pub mod users;"));
    }

    #[test]
    fn test_overwrite_flags() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route("GET", "/users", "UsersRoutes#GET /users")];

        let outputs = generate_handlers(&type_map, &routes);

        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();
        assert!(
            !handler.overwrite,
            "Entity handler files should NOT be overwritten"
        );

        let mod_file = outputs
            .iter()
            .find(|o| o.path == "src/handlers/mod.rs")
            .unwrap();
        assert!(
            mod_file.overwrite,
            "handlers/mod.rs should be overwritten"
        );
    }

    #[test]
    fn test_output_is_deterministic() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("DELETE", "/users/:id", "UsersRoutes#DELETE /users/:id"),
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("POST", "/users", "UsersRoutes#POST /users"),
        ];

        let output1 = generate_handlers(&type_map, &routes);
        let output2 = generate_handlers(&type_map, &routes);

        assert_eq!(output1.len(), output2.len());
        for (a, b) in output1.iter().zip(output2.iter()) {
            assert_eq!(a.path, b.path);
            assert_eq!(a.content, b.content);
        }
    }

    #[test]
    fn test_non_table_entity_no_repository() {
        let type_map = HashMap::new();

        let routes = vec![make_route("GET", "/health", "HealthRoutes#GET /health")];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/health.rs")
            .unwrap();

        assert!(!handler.content.contains("repository::"));
        assert!(handler.content.contains("TODO"));
    }

    #[test]
    fn test_resolve_entity_name_singular() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        assert_eq!(resolve_entity_name("Users", &type_map), "User");
    }

    #[test]
    fn test_resolve_entity_name_exact() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("Users");
        type_map.insert(name, meta);

        assert_eq!(resolve_entity_name("Users", &type_map), "Users");
    }

    #[test]
    fn test_resolve_entity_name_ies_to_y() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("Category");
        type_map.insert(name, meta);

        assert_eq!(resolve_entity_name("Categories", &type_map), "Category");
    }

    #[test]
    fn test_resolve_entity_name_fallback() {
        let type_map = HashMap::new();

        // Not in type_map — falls back to best-effort singular
        assert_eq!(resolve_entity_name("Widgets", &type_map), "Widget");
    }

    #[test]
    fn test_handler_auto_generated_header() {
        let type_map = HashMap::new();
        let routes = vec![make_route("GET", "/users", "UsersRoutes#GET /users")];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();
        assert!(handler.content.contains("AUTO-GENERATED"));
        assert!(handler.content.contains("will NOT be overwritten"));
    }

    #[test]
    fn test_mod_auto_generated_header() {
        let type_map = HashMap::new();
        let routes = vec![make_route("GET", "/users", "UsersRoutes#GET /users")];

        let outputs = generate_handlers(&type_map, &routes);
        let mod_file = outputs
            .iter()
            .find(|o| o.path == "src/handlers/mod.rs")
            .unwrap();
        assert!(mod_file.content.contains("AUTO-GENERATED"));
    }

    #[test]
    fn test_derive_module_info() {
        let (module, prefix) = derive_module_info("UsersRoutes#GET /users");
        assert_eq!(module, "users");
        assert_eq!(prefix, "Users");

        let (module, prefix) = derive_module_info("TodosRoutes#POST /todos");
        assert_eq!(module, "todos");
        assert_eq!(prefix, "Todos");
    }

    #[test]
    fn test_handler_imports_complete() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("POST", "/users", "UsersRoutes#POST /users"),
            make_route("GET", "/users/:id", "UsersRoutes#GET /users/:id"),
        ];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("use axum::extract::State;"));
        assert!(handler.content.contains("use axum::extract::Path;"));
        assert!(handler.content.contains("use axum::extract::Query;"));
        assert!(handler.content.contains("use axum::Json;"));
        assert!(handler.content.contains("use axum::http::StatusCode;"));
        assert!(handler.content.contains("use crate::app::AppState;"));
        assert!(handler.content.contains("use crate::db::repository;"));
        assert!(handler.content.contains("use crate::error::AppError;"));
        assert!(handler.content.contains("use crate::models;"));
    }

    #[test]
    fn test_empty_routes_only_mod() {
        let type_map = HashMap::new();
        let routes: Vec<RouteEntry> = vec![];

        let outputs = generate_handlers(&type_map, &routes);

        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].path, "src/handlers/mod.rs");
    }

    #[test]
    fn test_id_type_number() {
        let mut type_map = HashMap::new();
        let mut jsdoc = HashMap::new();
        jsdoc.insert("table".to_string(), String::new());

        let mut properties = HashMap::new();
        let mut id_jsdoc = HashMap::new();
        id_jsdoc.insert("id".to_string(), String::new());
        properties.insert(
            "id".to_string(),
            PropertyMetadata {
                type_str: "number".to_string(),
                optional: false,
                jsdoc: Some(id_jsdoc),
            },
        );

        type_map.insert(
            "User".to_string(),
            TypeMetadata {
                name: "User".to_string(),
                properties,
                jsdoc: Some(jsdoc),
            },
        );

        let routes = vec![make_route(
            "GET",
            "/users/:id",
            "UsersRoutes#GET /users/:id",
        )];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("Path(id): Path<i64>"));
    }

    #[test]
    fn test_patch_maps_to_update() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![make_route(
            "PATCH",
            "/users/:id",
            "UsersRoutes#PATCH /users/:id",
        )];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        assert!(handler.content.contains("pub async fn update("));
        assert!(handler.content.contains("repository::update_user"));
    }

    #[test]
    fn test_put_and_patch_deduplicates_to_single_update() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("PUT", "/users/:id", "UsersRoutes#PUT /users/:id"),
            make_route("PATCH", "/users/:id", "UsersRoutes#PATCH /users/:id"),
        ];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/users.rs")
            .unwrap();

        // Should only have one update handler, not two
        let update_count = handler.content.matches("pub async fn update(").count();
        assert_eq!(update_count, 1, "Should deduplicate PUT+PATCH to single update");
    }

    #[test]
    fn test_non_table_entity_has_no_repository_import() {
        let type_map = HashMap::new();
        let routes = vec![make_route("GET", "/health", "HealthRoutes#GET /health")];

        let outputs = generate_handlers(&type_map, &routes);
        let handler = outputs
            .iter()
            .find(|o| o.path == "src/handlers/health.rs")
            .unwrap();

        assert!(!handler.content.contains("use crate::db::repository;"));
    }

    #[test]
    fn test_mod_rs_sorted_alphabetically() {
        let mut type_map = HashMap::new();
        let (name, meta) = make_table_entity("User");
        type_map.insert(name, meta);
        let (name, meta) = make_table_entity("Todo");
        type_map.insert(name, meta);

        let routes = vec![
            make_route("GET", "/users", "UsersRoutes#GET /users"),
            make_route("GET", "/todos", "TodosRoutes#GET /todos"),
        ];

        let outputs = generate_handlers(&type_map, &routes);
        let mod_file = outputs
            .iter()
            .find(|o| o.path == "src/handlers/mod.rs")
            .unwrap();

        let todos_pos = mod_file.content.find("pub mod todos;").unwrap();
        let users_pos = mod_file.content.find("pub mod users;").unwrap();
        assert!(
            todos_pos < users_pos,
            "Module names should be sorted alphabetically"
        );
    }
}
