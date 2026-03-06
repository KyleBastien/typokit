//! Rust code generation module for TypoKit.
//!
//! Generates a complete Axum server (structs, router, sqlx DB layer, handlers)
//! from TypeScript schemas extracted by the TypoKit build pipeline.

pub mod structs;

use std::collections::HashMap;
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

/// Generate all Rust code from the extracted TypeScript schema types.
///
/// Currently generates Rust struct files with serde derives. Future stories
/// will add router, database layer, handlers, and project scaffold generation.
pub fn generate(type_map: &HashMap<String, TypeMetadata>) -> Vec<GeneratedOutput> {
    structs::generate_structs(type_map)
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

        let outputs = generate(&type_map);
        assert!(!outputs.is_empty());
        assert!(outputs.iter().any(|o| o.path.contains("user.rs")));
        assert!(outputs.iter().any(|o| o.path.ends_with("mod.rs")));
    }
}
