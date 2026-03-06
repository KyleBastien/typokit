mod rust_codegen;

use std::collections::HashMap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use typokit_transform_native::{parser, route_compiler};

/// A single generated Rust code output file
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsRustGeneratedOutput {
    /// Relative path for the generated file (e.g., ".typokit/models/user.rs")
    pub path: String,
    /// Generated file content
    pub content: String,
    /// Whether to overwrite an existing file at this path
    pub overwrite: bool,
}

/// Generate Rust (Axum) server code from TypeScript schema type files and route contract files.
///
/// Parses type definitions and route contracts from the given files, then generates
/// a complete Axum server: structs, router, sqlx DB layer, handlers, services,
/// middleware, and project scaffold (Cargo.toml, main.rs, lib.rs, app.rs, error.rs).
///
/// Returns an array of GeneratedOutput objects specifying the file path, content,
/// and whether to overwrite existing files.
#[napi]
pub fn generate_rust_codegen(
    type_file_paths: Vec<String>,
    route_file_paths: Vec<String>,
) -> Result<Vec<JsRustGeneratedOutput>> {
    // 1. Parse and extract types (with full JSDoc metadata)
    let type_map = parser::parse_and_extract_types(&type_file_paths)
        .map_err(|e| Error::from_reason(e))?;

    // 2. Extract route entries from route contract files
    let mut all_route_entries = Vec::new();
    for path in &route_file_paths {
        let source = std::fs::read_to_string(path)
            .map_err(|e| Error::from_reason(format!("Failed to read file {}: {}", path, e)))?;
        let parsed = parser::parse_typescript(path, &source)
            .map_err(|e| Error::from_reason(e))?;
        let entries = route_compiler::extract_route_contracts(&parsed.module);
        all_route_entries.extend(entries);
    }

    // 3. Generate Rust codegen outputs
    let outputs = rust_codegen::generate(&type_map, &all_route_entries);

    Ok(outputs
        .into_iter()
        .map(|o| JsRustGeneratedOutput {
            path: o.path,
            content: o.content,
            overwrite: o.overwrite,
        })
        .collect())
}

/// Compute a SHA-256 content hash of the given file paths and their contents.
///
/// Used for cache invalidation: if the hash matches a previous build, outputs
/// can be reused without regeneration.
#[napi]
pub fn compute_content_hash(file_paths: Vec<String>) -> Result<String> {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    let mut sorted_paths = file_paths.clone();
    sorted_paths.sort();

    for path in &sorted_paths {
        let content = std::fs::read_to_string(path)
            .map_err(|e| Error::from_reason(format!("Failed to read file {}: {}", path, e)))?;
        hasher.update(path.as_bytes());
        hasher.update(content.as_bytes());
    }

    Ok(hex::encode(hasher.finalize()))
}
