use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::type_extractor::TypeMetadata;

/// Metadata passed to JS callback for a single type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeValidatorInput {
    pub name: String,
    pub properties: HashMap<String, PropertyInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyInput {
    #[serde(rename = "type")]
    pub type_str: String,
    pub optional: bool,
}

/// Prepare type metadata for the Typia bridge JS callback.
///
/// Converts internal TypeMetadata into a serializable format that can be
/// passed across the napi-rs boundary to @typokit/transform-typia.
pub fn prepare_validator_inputs(
    types: &HashMap<String, TypeMetadata>,
) -> Vec<TypeValidatorInput> {
    let mut inputs: Vec<TypeValidatorInput> = Vec::new();

    // Sort by name for deterministic output
    let mut names: Vec<&String> = types.keys().collect();
    names.sort();

    for name in names {
        let meta = &types[name];
        let mut properties = HashMap::new();

        for (prop_name, prop) in &meta.properties {
            properties.insert(
                prop_name.clone(),
                PropertyInput {
                    type_str: prop.type_str.clone(),
                    optional: prop.optional,
                },
            );
        }

        inputs.push(TypeValidatorInput {
            name: name.clone(),
            properties,
        });
    }

    inputs
}

/// Collect validator results from the JS callback into a file output map.
///
/// Maps type names to their generated validator file paths and code,
/// suitable for writing to .typokit/validators/.
pub fn collect_validator_outputs(
    results: &[(String, String)],
) -> HashMap<String, String> {
    let mut output = HashMap::new();
    for (type_name, code) in results {
        let file_path = format!(".typokit/validators/{}.ts", to_file_name(type_name));
        output.insert(file_path, code.clone());
    }
    output
}

/// Convert PascalCase to kebab-case for file names
fn to_file_name(name: &str) -> String {
    let mut result = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            result.push('-');
        }
        result.push(ch.to_ascii_lowercase());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::type_extractor::PropertyMetadata;

    fn make_type(name: &str, props: Vec<(&str, &str, bool)>) -> TypeMetadata {
        let mut properties = HashMap::new();
        for (pname, ptype, optional) in props {
            properties.insert(
                pname.to_string(),
                PropertyMetadata {
                    type_str: ptype.to_string(),
                    optional,
                    jsdoc: None,
                },
            );
        }
        TypeMetadata {
            name: name.to_string(),
            properties,
            jsdoc: None,
        }
    }

    #[test]
    fn test_prepare_validator_inputs() {
        let mut types = HashMap::new();
        types.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("name", "string", false),
            ("age", "number", true),
        ]));

        let inputs = prepare_validator_inputs(&types);

        assert_eq!(inputs.len(), 1);
        assert_eq!(inputs[0].name, "User");
        assert_eq!(inputs[0].properties.len(), 3);
        assert_eq!(inputs[0].properties["id"].type_str, "string");
        assert!(!inputs[0].properties["id"].optional);
        assert!(inputs[0].properties["age"].optional);
    }

    #[test]
    fn test_prepare_validator_inputs_multiple_types() {
        let mut types = HashMap::new();
        types.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
        ]));
        types.insert("Post".to_string(), make_type("Post", vec![
            ("id", "string", false),
            ("title", "string", false),
        ]));

        let inputs = prepare_validator_inputs(&types);

        assert_eq!(inputs.len(), 2);
        // Should be sorted alphabetically
        assert_eq!(inputs[0].name, "Post");
        assert_eq!(inputs[1].name, "User");
    }

    #[test]
    fn test_collect_validator_outputs() {
        let results = vec![
            ("User".to_string(), "export function validateUser(input: unknown) { /* ... */ }".to_string()),
            ("Post".to_string(), "export function validatePost(input: unknown) { /* ... */ }".to_string()),
        ];

        let output = collect_validator_outputs(&results);

        assert_eq!(output.len(), 2);
        assert!(output.contains_key(".typokit/validators/user.ts"));
        assert!(output.contains_key(".typokit/validators/post.ts"));
        assert!(output[".typokit/validators/user.ts"].contains("validateUser"));
    }

    #[test]
    fn test_to_file_name() {
        assert_eq!(to_file_name("User"), "user");
        assert_eq!(to_file_name("BlogPost"), "blog-post");
        assert_eq!(to_file_name("APIKey"), "a-p-i-key");
    }

    #[test]
    fn test_prepare_empty_types() {
        let types = HashMap::new();
        let inputs = prepare_validator_inputs(&types);
        assert!(inputs.is_empty());
    }

    #[test]
    fn test_collect_empty_results() {
        let results: Vec<(String, String)> = Vec::new();
        let output = collect_validator_outputs(&results);
        assert!(output.is_empty());
    }
}
