mod parser;
mod type_extractor;
mod route_compiler;
mod openapi_generator;

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
