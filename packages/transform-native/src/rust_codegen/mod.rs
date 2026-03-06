//! Rust code generation module for TypoKit.
//!
//! Generates a complete Axum server (structs, router, sqlx DB layer, handlers)
//! from TypeScript schemas extracted by the TypoKit build pipeline.

pub mod database;
pub mod router;
pub mod structs;

use std::collections::HashMap;
use crate::route_compiler::RouteEntry;
use crate::type_extractor::TypeMetadata;

/// A single generated output file
#[derive(Debug, Clone)]
pub struct GeneratedOutput {
    /// Relative path for the generated file (e.g., ".typokit/models/user.rs")
    pub path: String,
    /// Generated file content
    pub content: String,
    /// Whether to overwrite an existing file at this path
    pub overwrite: bool,
}

/// Generate all Rust code from the extracted TypeScript schema types and routes.
///
/// Generates Rust struct files with serde derives, an Axum router file
/// with typed handler registrations, and a sqlx database layer with
/// CRUD repository functions and SQL migrations.
pub fn generate(
    type_map: &HashMap<String, TypeMetadata>,
    routes: &[RouteEntry],
) -> Vec<GeneratedOutput> {
    let mut outputs = structs::generate_structs(type_map);
    outputs.extend(router::generate_router(routes));
    outputs.extend(database::generate_database(type_map));
    outputs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::type_extractor::PropertyMetadata;

    #[test]
    fn test_generate_returns_outputs() {
        let mut type_map = HashMap::new();
        let mut properties = HashMap::new();
        properties.insert(
            "id".to_string(),
            PropertyMetadata {
                type_str: "string".to_string(),
                optional: false,
                jsdoc: None,
            },
        );
        type_map.insert(
            "User".to_string(),
            TypeMetadata {
                name: "User".to_string(),
                properties,
                jsdoc: None,
            },
        );

        let routes = vec![];
        let outputs = generate(&type_map, &routes);
        assert!(!outputs.is_empty());
        assert!(outputs.iter().any(|o| o.path.contains("user.rs")));
        assert!(outputs.iter().any(|o| o.path.ends_with("mod.rs")));
    }

    #[test]
    fn test_generate_includes_router_output() {
        let type_map = HashMap::new();
        let routes = vec![];
        let outputs = generate(&type_map, &routes);
        assert!(outputs.iter().any(|o| o.path == ".typokit/router.rs"));
    }
}
