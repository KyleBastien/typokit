mod parser;
mod type_extractor;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_and_extract_types_nonexistent_file() {
        let result = parse_and_extract_types(vec!["nonexistent.ts".to_string()]);
        assert!(result.is_err());
    }
}
