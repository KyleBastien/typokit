use std::collections::HashMap;
use std::fs;
use sha2::{Sha256, Digest};

use crate::parser;
use crate::route_compiler;
use crate::openapi_generator;
use crate::test_stub_generator;
use crate::typia_bridge;
use crate::type_extractor::TypeMetadata;

/// Result of running the full output pipeline
#[derive(Debug, Clone)]
pub struct PipelineResult {
    /// Content hash of all input source files
    pub content_hash: String,
    /// Extracted type metadata (SchemaTypeMap-compatible)
    pub types: HashMap<String, TypeMetadata>,
    /// Compiled route table as TypeScript source
    pub compiled_routes: String,
    /// OpenAPI 3.1.0 spec as JSON string
    pub openapi_spec: String,
    /// Generated contract test stubs as TypeScript source
    pub test_stubs: String,
    /// Validator inputs ready for Typia bridge callback
    pub validator_inputs: Vec<typia_bridge::TypeValidatorInput>,
}

/// Compute a SHA-256 content hash of the given file paths.
///
/// The hash is computed over sorted file paths and their contents to ensure
/// deterministic results regardless of input order. Returns a hex-encoded hash string.
pub fn compute_content_hash(file_paths: &[String]) -> Result<String, String> {
    let mut hasher = Sha256::new();

    // Sort paths for deterministic ordering
    let mut sorted: Vec<&String> = file_paths.iter().collect();
    sorted.sort();

    for path in sorted {
        // Include the path itself in the hash for rename detection
        hasher.update(path.as_bytes());
        let content = fs::read(path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
        hasher.update(&content);
    }

    let hash = hasher.finalize();
    Ok(hex::encode(hash))
}

/// Run the full output pipeline: parse types, compile routes, generate OpenAPI,
/// generate test stubs, and prepare validator inputs.
///
/// Returns a PipelineResult containing all generated outputs plus a content hash
/// that can be used for caching.
pub fn run_pipeline(
    type_file_paths: &[String],
    route_file_paths: &[String],
) -> Result<PipelineResult, String> {
    // 1. Compute content hash of all input files
    let mut all_paths: Vec<String> = Vec::new();
    all_paths.extend_from_slice(type_file_paths);
    all_paths.extend_from_slice(route_file_paths);
    let content_hash = compute_content_hash(&all_paths)?;

    // 2. Parse and extract types
    let types = parser::parse_and_extract_types(type_file_paths)?;

    // 3. Compile route contracts into radix tree
    let mut all_route_entries = Vec::new();
    for path in route_file_paths {
        let source = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;
        let parsed = parser::parse_typescript(path, &source)?;
        let entries = route_compiler::extract_route_contracts(&parsed.module);
        all_route_entries.extend(entries);
    }

    let tree = route_compiler::build_radix_tree(&all_route_entries)?;
    let compiled_routes = route_compiler::serialize_to_typescript(&tree);

    // 4. Generate OpenAPI spec
    let openapi_spec = openapi_generator::generate_openapi(&all_route_entries, &types);

    // 5. Generate test stubs
    let test_stubs = test_stub_generator::generate_test_stubs(&all_route_entries);

    // 6. Prepare validator inputs
    let validator_inputs = typia_bridge::prepare_validator_inputs(&types);

    Ok(PipelineResult {
        content_hash,
        types,
        compiled_routes,
        openapi_spec,
        test_stubs,
        validator_inputs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn create_temp_file(content: &str) -> String {
        let dir = std::env::temp_dir();
        let file_name = format!(
            "typokit-pipeline-test-{}-{}.ts",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = dir.join(file_name);
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path.to_string_lossy().to_string()
    }

    fn cleanup(path: &str) {
        let _ = fs::remove_file(path);
    }

    #[test]
    fn test_content_hash_deterministic() {
        let f1 = create_temp_file("interface A { id: string; }");
        let f2 = create_temp_file("interface B { id: string; }");

        let hash1 = compute_content_hash(&[f1.clone(), f2.clone()]).unwrap();
        let hash2 = compute_content_hash(&[f2.clone(), f1.clone()]).unwrap();
        // Same files in different order should produce same hash
        assert_eq!(hash1, hash2);

        cleanup(&f1);
        cleanup(&f2);
    }

    #[test]
    fn test_content_hash_changes_on_modification() {
        let f = create_temp_file("interface A { id: string; }");
        let hash1 = compute_content_hash(&[f.clone()]).unwrap();

        fs::write(&f, "interface A { id: string; name: string; }").unwrap();
        let hash2 = compute_content_hash(&[f.clone()]).unwrap();

        assert_ne!(hash1, hash2);
        cleanup(&f);
    }

    #[test]
    fn test_run_pipeline() {
        let type_file = create_temp_file(
            r#"
/**
 * @table users
 */
interface User {
    /** @id @generated */
    id: string;
    name: string;
    email: string;
    age?: number;
}
"#,
        );

        let route_file = create_temp_file(
            r#"
interface UsersRoutes {
    "GET /users": RouteContract<void, void, void, void>;
    "POST /users": RouteContract<void, void, void, void>;
    "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
}
"#,
        );

        let result = run_pipeline(&[type_file.clone()], &[route_file.clone()]).unwrap();

        // Content hash is computed
        assert!(!result.content_hash.is_empty());
        assert_eq!(result.content_hash.len(), 64); // SHA-256 hex

        // Types are extracted
        assert!(result.types.contains_key("User"));

        // Routes are compiled
        assert!(result.compiled_routes.contains("routeTree"));
        assert!(result.compiled_routes.contains("users"));

        // OpenAPI spec is generated
        assert!(result.openapi_spec.contains("3.1.0"));
        assert!(result.openapi_spec.contains("/users"));

        // Test stubs are generated
        assert!(result.test_stubs.contains("GET /users"));
        assert!(result.test_stubs.contains("POST /users"));

        // Validator inputs are prepared
        assert_eq!(result.validator_inputs.len(), 1);
        assert_eq!(result.validator_inputs[0].name, "User");

        cleanup(&type_file);
        cleanup(&route_file);
    }

    #[test]
    fn test_run_pipeline_empty_routes() {
        let type_file = create_temp_file(
            r#"
interface User {
    id: string;
    name: string;
}
"#,
        );

        let result = run_pipeline(&[type_file.clone()], &[]).unwrap();

        assert!(result.types.contains_key("User"));
        assert!(result.compiled_routes.contains("routeTree"));
        assert_eq!(result.validator_inputs.len(), 1);

        cleanup(&type_file);
    }

    #[test]
    fn test_run_pipeline_nonexistent_file() {
        let result = run_pipeline(&["nonexistent.ts".to_string()], &[]);
        assert!(result.is_err());
    }
}
