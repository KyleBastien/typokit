mod parser;
mod type_extractor;
mod route_compiler;
mod openapi_generator;
mod schema_differ;
mod test_stub_generator;
mod typia_bridge;
mod output_pipeline;
mod rust_codegen;

use std::collections::HashMap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

/// Property metadata matching @typokit/types PropertyMetadata shape
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsPropertyMetadata {
    #[napi(js_name = "type")]
    pub type_str: String,
    pub optional: bool,
}

/// Type metadata matching @typokit/types TypeMetadata shape
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsTypeMetadata {
    pub name: String,
    pub properties: HashMap<String, JsPropertyMetadata>,
}

/// Parse TypeScript source files and extract type metadata.
///
/// Returns a SchemaTypeMap (Record<string, TypeMetadata>) mapping type names
/// to their extracted metadata including property types, optionality, and JSDoc tags.
#[napi]
pub fn parse_and_extract_types(file_paths: Vec<String>) -> Result<HashMap<String, JsTypeMetadata>> {
    let internal_result = parser::parse_and_extract_types(&file_paths)
        .map_err(|e| Error::from_reason(e))?;

    let mut result: HashMap<String, JsTypeMetadata> = HashMap::new();

    for (name, metadata) in internal_result {
        let mut properties: HashMap<String, JsPropertyMetadata> = HashMap::new();
        for (prop_name, prop) in metadata.properties {
            properties.insert(
                prop_name,
                JsPropertyMetadata {
                    type_str: prop.type_str,
                    optional: prop.optional,
                },
            );
        }
        result.insert(
            name.clone(),
            JsTypeMetadata {
                name: metadata.name,
                properties,
            },
        );
    }

    Ok(result)
}

/// Compile route contracts from TypeScript files into a radix tree.
/// Returns TypeScript source code for the compiled route table.
#[napi]
pub fn compile_routes(file_paths: Vec<String>) -> Result<String> {
    let mut all_entries = Vec::new();

    for path in &file_paths {
        let source = std::fs::read_to_string(path)
            .map_err(|e| Error::from_reason(format!("Failed to read file {}: {}", path, e)))?;
        let parsed = parser::parse_typescript(path, &source)
            .map_err(|e| Error::from_reason(e))?;
        let entries = route_compiler::extract_route_contracts(&parsed.module);
        all_entries.extend(entries);
    }

    let tree = route_compiler::build_radix_tree(&all_entries)
        .map_err(|e| Error::from_reason(e))?;

    Ok(route_compiler::serialize_to_typescript(&tree))
}

/// Generate an OpenAPI 3.1.0 specification from route contracts and type definitions.
/// Returns the OpenAPI spec as a JSON string.
#[napi]
pub fn generate_open_api(
    route_file_paths: Vec<String>,
    type_file_paths: Vec<String>,
) -> Result<String> {
    let mut all_entries = Vec::new();

    for path in &route_file_paths {
        let source = std::fs::read_to_string(path)
            .map_err(|e| Error::from_reason(format!("Failed to read file {}: {}", path, e)))?;
        let parsed = parser::parse_typescript(path, &source)
            .map_err(|e| Error::from_reason(e))?;
        let entries = route_compiler::extract_route_contracts(&parsed.module);
        all_entries.extend(entries);
    }

    let internal_type_map = parser::parse_and_extract_types(&type_file_paths)
        .map_err(|e| Error::from_reason(e))?;

    Ok(openapi_generator::generate_openapi(&all_entries, &internal_type_map))
}

// ─── Schema Change (napi object) ─────────────────────────────

/// A single schema change (matches @typokit/types SchemaChange)
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsSchemaChange {
    #[napi(js_name = "type")]
    pub change_type: String,
    pub entity: String,
    pub field: Option<String>,
    pub details: Option<HashMap<String, String>>,
}

/// A migration draft (matches @typokit/types MigrationDraft)
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsMigrationDraft {
    pub name: String,
    pub sql: String,
    pub destructive: bool,
    pub changes: Vec<JsSchemaChange>,
}

/// Diff two schema versions and produce a migration draft.
///
/// Compares old_types against new_types to detect added/removed/modified
/// entities and fields. Generates SQL DDL stubs for the changes.
#[napi]
pub fn diff_schemas(
    old_types: HashMap<String, JsTypeMetadata>,
    new_types: HashMap<String, JsTypeMetadata>,
    migration_name: String,
) -> JsMigrationDraft {
    let old_internal = js_types_to_internal(&old_types);
    let new_internal = js_types_to_internal(&new_types);

    let draft = schema_differ::diff_schemas(&old_internal, &new_internal, &migration_name);

    JsMigrationDraft {
        name: draft.name,
        sql: draft.sql,
        destructive: draft.destructive,
        changes: draft
            .changes
            .into_iter()
            .map(|c| JsSchemaChange {
                change_type: c.change_type,
                entity: c.entity,
                field: c.field,
                details: c.details,
            })
            .collect(),
    }
}

/// Generate contract test scaffolding from route contract files.
///
/// Parses route contracts from the given files and generates TypeScript
/// test stubs with describe/it blocks for each route.
#[napi]
pub fn generate_test_stubs(file_paths: Vec<String>) -> Result<String> {
    let mut all_entries = Vec::new();

    for path in &file_paths {
        let source = std::fs::read_to_string(path)
            .map_err(|e| Error::from_reason(format!("Failed to read file {}: {}", path, e)))?;
        let parsed = parser::parse_typescript(path, &source)
            .map_err(|e| Error::from_reason(e))?;
        let entries = route_compiler::extract_route_contracts(&parsed.module);
        all_entries.extend(entries);
    }

    Ok(test_stub_generator::generate_test_stubs(&all_entries))
}

/// Validator input for a single type (passed to Typia bridge callback)
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsTypeValidatorInput {
    pub name: String,
    pub properties: HashMap<String, JsPropertyMetadata>,
}

/// Prepare type metadata for Typia validator generation.
///
/// Converts parsed type metadata into a format suitable for passing
/// to the @typokit/transform-typia bridge callback.
#[napi]
pub fn prepare_validator_inputs(
    type_file_paths: Vec<String>,
) -> Result<Vec<JsTypeValidatorInput>> {
    let internal_types = parser::parse_and_extract_types(&type_file_paths)
        .map_err(|e| Error::from_reason(e))?;

    let inputs = typia_bridge::prepare_validator_inputs(&internal_types);

    Ok(inputs
        .into_iter()
        .map(|input| {
            let mut properties = HashMap::new();
            for (name, prop) in input.properties {
                properties.insert(
                    name,
                    JsPropertyMetadata {
                        type_str: prop.type_str,
                        optional: prop.optional,
                    },
                );
            }
            JsTypeValidatorInput {
                name: input.name,
                properties,
            }
        })
        .collect())
}

/// Collect validator code results into a file path map.
///
/// Maps type names to their output file paths under .typokit/validators/.
#[napi]
pub fn collect_validator_outputs(
    results: Vec<Vec<String>>,
) -> HashMap<String, String> {
    let pairs: Vec<(String, String)> = results
        .into_iter()
        .filter_map(|pair| {
            if pair.len() == 2 {
                Some((pair[0].clone(), pair[1].clone()))
            } else {
                None
            }
        })
        .collect();

    typia_bridge::collect_validator_outputs(&pairs)
}

/// Result of running the full output pipeline
#[napi(object)]
#[derive(Debug, Clone)]
pub struct JsPipelineResult {
    /// SHA-256 content hash of all input source files
    pub content_hash: String,
    /// Extracted type metadata (SchemaTypeMap-compatible)
    pub types: HashMap<String, JsTypeMetadata>,
    /// Compiled route table as TypeScript source
    pub compiled_routes: String,
    /// OpenAPI 3.1.0 spec as JSON string
    pub openapi_spec: String,
    /// Generated contract test stubs as TypeScript source
    pub test_stubs: String,
    /// Validator inputs ready for Typia bridge callback
    pub validator_inputs: Vec<JsTypeValidatorInput>,
}

/// Compute a SHA-256 content hash of the given file paths and their contents.
///
/// Used for cache invalidation: if the hash matches a previous build, outputs
/// can be reused without regeneration.
#[napi]
pub fn compute_content_hash(file_paths: Vec<String>) -> Result<String> {
    output_pipeline::compute_content_hash(&file_paths)
        .map_err(|e| Error::from_reason(e))
}

/// Run the full output pipeline: parse types, compile routes, generate OpenAPI,
/// generate test stubs, and prepare validator inputs.
///
/// Returns all generated outputs plus a content hash for caching.
/// Validators are returned as inputs — the caller should pass them to
/// the Typia bridge callback and then call collectValidatorOutputs.
#[napi]
pub fn run_pipeline(
    type_file_paths: Vec<String>,
    route_file_paths: Vec<String>,
) -> Result<JsPipelineResult> {
    let result = output_pipeline::run_pipeline(&type_file_paths, &route_file_paths)
        .map_err(|e| Error::from_reason(e))?;

    // Convert internal types to JS types
    let mut types: HashMap<String, JsTypeMetadata> = HashMap::new();
    for (name, meta) in result.types {
        let mut properties: HashMap<String, JsPropertyMetadata> = HashMap::new();
        for (prop_name, prop) in meta.properties {
            properties.insert(
                prop_name,
                JsPropertyMetadata {
                    type_str: prop.type_str,
                    optional: prop.optional,
                },
            );
        }
        types.insert(
            name.clone(),
            JsTypeMetadata {
                name: meta.name,
                properties,
            },
        );
    }

    let validator_inputs: Vec<JsTypeValidatorInput> = result
        .validator_inputs
        .into_iter()
        .map(|input| {
            let mut properties = HashMap::new();
            for (name, prop) in input.properties {
                properties.insert(
                    name,
                    JsPropertyMetadata {
                        type_str: prop.type_str,
                        optional: prop.optional,
                    },
                );
            }
            JsTypeValidatorInput {
                name: input.name,
                properties,
            }
        })
        .collect();

    Ok(JsPipelineResult {
        content_hash: result.content_hash,
        types,
        compiled_routes: result.compiled_routes,
        openapi_spec: result.openapi_spec,
        test_stubs: result.test_stubs,
        validator_inputs,
    })
}

/// Helper to convert JsTypeMetadata to internal TypeMetadata
fn js_types_to_internal(
    js_types: &HashMap<String, JsTypeMetadata>,
) -> HashMap<String, type_extractor::TypeMetadata> {
    let mut result = HashMap::new();
    for (name, meta) in js_types {
        let mut properties = HashMap::new();
        for (prop_name, prop) in &meta.properties {
            properties.insert(
                prop_name.clone(),
                type_extractor::PropertyMetadata {
                    type_str: prop.type_str.clone(),
                    optional: prop.optional,
                    jsdoc: None,
                },
            );
        }
        result.insert(
            name.clone(),
            type_extractor::TypeMetadata {
                name: meta.name.clone(),
                properties,
                jsdoc: None,
            },
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_and_extract_types_nonexistent_file() {
        let result = parse_and_extract_types(vec!["nonexistent.ts".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_compile_routes_nonexistent_file() {
        let result = compile_routes(vec!["nonexistent.ts".to_string()]);
        assert!(result.is_err());
    }
}
