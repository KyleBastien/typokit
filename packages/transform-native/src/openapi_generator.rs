use std::collections::{BTreeMap, HashMap, HashSet};
use serde_json::{json, Value};
use crate::route_compiler::{RouteEntry, RouteTypeInfo, PathSegment};
use crate::type_extractor::TypeMetadata;

/// Generate an OpenAPI 3.1.0 specification from route entries and type metadata.
pub fn generate_openapi(
    entries: &[RouteEntry],
    type_map: &HashMap<String, TypeMetadata>,
) -> String {
    let mut paths: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
    let mut referenced_schemas: HashSet<String> = HashSet::new();

    for entry in entries {
        let openapi_path = convert_path_to_openapi(&entry.path);
        let method_lower = entry.method.to_lowercase();
        let path_item = paths.entry(openapi_path).or_default();
        let operation = build_operation(entry, &mut referenced_schemas);
        path_item.insert(method_lower, operation);
    }

    let schemas = build_component_schemas(type_map, &referenced_schemas);

    let paths_value: serde_json::Map<String, Value> = paths
        .into_iter()
        .map(|(path, methods)| {
            let methods_obj: serde_json::Map<String, Value> = methods.into_iter().collect();
            (path, Value::Object(methods_obj))
        })
        .collect();

    let mut spec = json!({
        "openapi": "3.1.0",
        "info": {
            "title": "API",
            "version": "1.0.0"
        },
        "paths": Value::Object(paths_value)
    });

    if !schemas.is_empty() {
        let schemas_obj: serde_json::Map<String, Value> = schemas.into_iter().collect();
        spec["components"] = json!({
            "schemas": Value::Object(schemas_obj)
        });
    }

    serde_json::to_string_pretty(&spec).unwrap()
}

fn convert_path_to_openapi(path: &str) -> String {
    path.split('/')
        .map(|s| {
            if s.starts_with(':') {
                format!("{{{}}}", &s[1..])
            } else if s.starts_with('*') {
                format!("{{{}}}", if s.len() > 1 { &s[1..] } else { "wildcard" })
            } else {
                s.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn generate_operation_id(method: &str, path: &str) -> String {
    let clean_path = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.starts_with(':') || s.starts_with('*') {
                capitalize(&s[1..])
            } else {
                capitalize(s)
            }
        })
        .collect::<String>();

    format!("{}{}", method.to_lowercase(), clean_path)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn build_operation(entry: &RouteEntry, referenced_schemas: &mut HashSet<String>) -> Value {
    let mut op = json!({
        "operationId": generate_operation_id(&entry.method, &entry.path),
        "responses": {
            "200": build_response(&entry.response_type, referenced_schemas)
        }
    });

    // Build parameters
    let mut params: Vec<Value> = Vec::new();

    // Path parameters from segments
    for seg in &entry.segments {
        if let PathSegment::Param(name) = seg {
            params.push(json!({
                "name": name,
                "in": "path",
                "required": true,
                "schema": { "type": "string" }
            }));
        }
    }

    // Query parameters from object literal types
    if let RouteTypeInfo::ObjectLiteral(props) = &entry.query_type {
        for prop in props {
            params.push(json!({
                "name": &prop.name,
                "in": "query",
                "required": !prop.optional,
                "schema": type_info_to_schema(&prop.type_info, referenced_schemas)
            }));
        }
    } else if !matches!(entry.query_type, RouteTypeInfo::Void) {
        collect_schema_refs(&entry.query_type, referenced_schemas);
    }

    if !params.is_empty() {
        op["parameters"] = json!(params);
    }

    // Request body
    if !matches!(entry.body_type, RouteTypeInfo::Void) {
        op["requestBody"] = json!({
            "required": true,
            "content": {
                "application/json": {
                    "schema": type_info_to_schema(&entry.body_type, referenced_schemas)
                }
            }
        });
    }

    op
}

fn build_response(type_info: &RouteTypeInfo, referenced_schemas: &mut HashSet<String>) -> Value {
    if matches!(type_info, RouteTypeInfo::Void) {
        return json!({
            "description": "No content"
        });
    }

    json!({
        "description": "Successful response",
        "content": {
            "application/json": {
                "schema": type_info_to_schema(type_info, referenced_schemas)
            }
        }
    })
}

/// Convert RouteTypeInfo to JSON Schema value
fn type_info_to_schema(type_info: &RouteTypeInfo, referenced_schemas: &mut HashSet<String>) -> Value {
    match type_info {
        RouteTypeInfo::Void => json!({}),
        RouteTypeInfo::Primitive(name) => match name.as_str() {
            "string" => json!({ "type": "string" }),
            "number" => json!({ "type": "number" }),
            "boolean" => json!({ "type": "boolean" }),
            "null" => json!({ "type": "null" }),
            "any" | "unknown" => json!({}),
            _ => json!({}),
        },
        RouteTypeInfo::Named(name) => {
            referenced_schemas.insert(name.clone());
            json!({ "$ref": format!("#/components/schemas/{}", name) })
        }
        RouteTypeInfo::Generic(name, args) => {
            let schema_name = format_generic_schema_name(name, args);
            referenced_schemas.insert(name.clone());
            for arg in args {
                collect_schema_refs(arg, referenced_schemas);
            }
            json!({ "$ref": format!("#/components/schemas/{}", schema_name) })
        }
        RouteTypeInfo::Array(inner) => {
            json!({
                "type": "array",
                "items": type_info_to_schema(inner, referenced_schemas)
            })
        }
        RouteTypeInfo::ObjectLiteral(props) => {
            let mut properties = serde_json::Map::new();
            let mut required: Vec<String> = Vec::new();

            for prop in props {
                properties.insert(
                    prop.name.clone(),
                    type_info_to_schema(&prop.type_info, referenced_schemas),
                );
                if !prop.optional {
                    required.push(prop.name.clone());
                }
            }

            let mut schema = json!({
                "type": "object",
                "properties": Value::Object(properties)
            });
            if !required.is_empty() {
                schema["required"] = json!(required);
            }
            schema
        }
        RouteTypeInfo::Union(types) => {
            json!({
                "oneOf": types.iter()
                    .map(|t| type_info_to_schema(t, referenced_schemas))
                    .collect::<Vec<_>>()
            })
        }
        RouteTypeInfo::StringLiteral(val) => {
            json!({ "type": "string", "const": val })
        }
        RouteTypeInfo::NumberLiteral(val) => {
            json!({ "type": "number", "const": val })
        }
        RouteTypeInfo::BooleanLiteral(val) => {
            json!({ "type": "boolean", "const": val })
        }
    }
}

fn format_generic_schema_name(name: &str, args: &[RouteTypeInfo]) -> String {
    let arg_names: Vec<String> = args.iter().map(type_info_short_name).collect();
    format!("{}_{}", name, arg_names.join("_"))
}

fn type_info_short_name(info: &RouteTypeInfo) -> String {
    match info {
        RouteTypeInfo::Named(n) => n.clone(),
        RouteTypeInfo::Primitive(n) => n.clone(),
        RouteTypeInfo::Generic(n, args) => format_generic_schema_name(n, args),
        RouteTypeInfo::Array(inner) => format!("{}Array", type_info_short_name(inner)),
        _ => "unknown".to_string(),
    }
}

fn collect_schema_refs(type_info: &RouteTypeInfo, referenced_schemas: &mut HashSet<String>) {
    match type_info {
        RouteTypeInfo::Named(name) => {
            referenced_schemas.insert(name.clone());
        }
        RouteTypeInfo::Generic(name, args) => {
            referenced_schemas.insert(name.clone());
            for arg in args {
                collect_schema_refs(arg, referenced_schemas);
            }
        }
        RouteTypeInfo::Array(inner) => collect_schema_refs(inner, referenced_schemas),
        RouteTypeInfo::ObjectLiteral(props) => {
            for prop in props {
                collect_schema_refs(&prop.type_info, referenced_schemas);
            }
        }
        RouteTypeInfo::Union(types) => {
            for t in types {
                collect_schema_refs(t, referenced_schemas);
            }
        }
        _ => {}
    }
}

/// Build component schemas from the type map for all referenced types
fn build_component_schemas(
    type_map: &HashMap<String, TypeMetadata>,
    referenced: &HashSet<String>,
) -> BTreeMap<String, Value> {
    let mut schemas = BTreeMap::new();

    for name in referenced {
        if let Some(metadata) = type_map.get(name) {
            let mut properties = serde_json::Map::new();
            let mut required: Vec<String> = Vec::new();

            for (prop_name, prop) in &metadata.properties {
                properties.insert(
                    prop_name.clone(),
                    ts_type_string_to_schema(&prop.type_str),
                );
                if !prop.optional {
                    required.push(prop_name.clone());
                }
            }

            let mut schema = json!({
                "type": "object",
                "properties": Value::Object(properties)
            });
            if !required.is_empty() {
                required.sort();
                schema["required"] = json!(required);
            }
            schemas.insert(name.clone(), schema);
        }
    }

    schemas
}

/// Convert a stringified TypeScript type to a basic JSON Schema
fn ts_type_string_to_schema(type_str: &str) -> Value {
    match type_str {
        "string" => json!({ "type": "string" }),
        "number" => json!({ "type": "number" }),
        "boolean" => json!({ "type": "boolean" }),
        "null" => json!({ "type": "null" }),
        "any" | "unknown" => json!({}),
        s if s.ends_with("[]") => {
            json!({
                "type": "array",
                "items": ts_type_string_to_schema(&s[..s.len() - 2])
            })
        }
        s if s.starts_with('"') && s.ends_with('"') => {
            json!({ "type": "string", "const": &s[1..s.len() - 1] })
        }
        s if s.contains(" | ") => {
            let types: Vec<Value> = s
                .split(" | ")
                .map(|t| ts_type_string_to_schema(t.trim()))
                .collect();
            json!({ "oneOf": types })
        }
        _ => {
            // Assume it's a named type reference
            json!({ "$ref": format!("#/components/schemas/{}", type_str) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::route_compiler::{RouteEntry, RouteTypeInfo, RouteObjectProp, parse_path_segments};
    use crate::type_extractor::PropertyMetadata;

    #[test]
    fn test_generate_openapi_basic() {
        let entries = vec![make_entry("GET", "/users")];
        let type_map = HashMap::new();
        let spec = generate_openapi(&entries, &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        assert_eq!(parsed["openapi"], "3.1.0");
        assert!(parsed["paths"]["/users"]["get"].is_object());
    }

    #[test]
    fn test_generate_openapi_path_params() {
        let entries = vec![make_entry("GET", "/users/:id")];
        let type_map = HashMap::new();
        let spec = generate_openapi(&entries, &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        // Path should use {id} format
        assert!(parsed["paths"]["/users/{id}"]["get"].is_object());
        let params = &parsed["paths"]["/users/{id}"]["get"]["parameters"];
        assert_eq!(params[0]["name"], "id");
        assert_eq!(params[0]["in"], "path");
        assert_eq!(params[0]["required"], true);
    }

    #[test]
    fn test_generate_openapi_query_params() {
        let mut entry = make_entry("GET", "/users");
        entry.query_type = RouteTypeInfo::ObjectLiteral(vec![
            RouteObjectProp {
                name: "page".into(),
                type_info: RouteTypeInfo::Primitive("number".into()),
                optional: true,
            },
            RouteObjectProp {
                name: "pageSize".into(),
                type_info: RouteTypeInfo::Primitive("number".into()),
                optional: true,
            },
        ]);

        let type_map = HashMap::new();
        let spec = generate_openapi(&[entry], &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        let params = &parsed["paths"]["/users"]["get"]["parameters"];
        assert_eq!(params.as_array().unwrap().len(), 2);
        assert_eq!(params[0]["name"], "page");
        assert_eq!(params[0]["in"], "query");
        assert_eq!(params[0]["required"], false);
    }

    #[test]
    fn test_generate_openapi_request_body() {
        let mut entry = make_entry("POST", "/users");
        entry.body_type = RouteTypeInfo::Named("CreateUserInput".into());

        let type_map = HashMap::new();
        let spec = generate_openapi(&[entry], &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        let body = &parsed["paths"]["/users"]["post"]["requestBody"];
        assert_eq!(body["required"], true);
        assert!(body["content"]["application/json"]["schema"]["$ref"]
            .as_str()
            .unwrap()
            .contains("CreateUserInput"));
    }

    #[test]
    fn test_generate_openapi_response_type_with_schema() {
        let mut entry = make_entry("GET", "/users");
        entry.response_type = RouteTypeInfo::Named("PublicUser".into());

        let mut type_map = HashMap::new();
        type_map.insert(
            "PublicUser".into(),
            TypeMetadata {
                name: "PublicUser".into(),
                properties: {
                    let mut props = HashMap::new();
                    props.insert(
                        "id".into(),
                        PropertyMetadata {
                            type_str: "string".into(),
                            optional: false,
                            jsdoc: None,
                        },
                    );
                    props.insert(
                        "name".into(),
                        PropertyMetadata {
                            type_str: "string".into(),
                            optional: false,
                            jsdoc: None,
                        },
                    );
                    props
                },
                jsdoc: None,
            },
        );

        let spec = generate_openapi(&[entry], &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        // Check response references the schema
        let schema = &parsed["paths"]["/users"]["get"]["responses"]["200"]["content"]
            ["application/json"]["schema"];
        assert!(schema["$ref"].as_str().unwrap().contains("PublicUser"));

        // Check component schema exists
        let component = &parsed["components"]["schemas"]["PublicUser"];
        assert_eq!(component["type"], "object");
        assert!(component["properties"]["id"].is_object());
        assert!(component["properties"]["name"].is_object());
    }

    #[test]
    fn test_generate_openapi_validates_structure() {
        let entries = vec![
            make_entry("GET", "/users"),
            make_entry("POST", "/users"),
            make_entry("GET", "/users/:id"),
        ];
        let type_map = HashMap::new();
        let spec = generate_openapi(&entries, &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        // Basic OpenAPI 3.1 structure validation
        assert_eq!(parsed["openapi"], "3.1.0");
        assert!(parsed["info"]["title"].is_string());
        assert!(parsed["info"]["version"].is_string());
        assert!(parsed["paths"].is_object());
    }

    #[test]
    fn test_generate_openapi_operation_ids() {
        let entries = vec![
            make_entry("GET", "/users"),
            make_entry("POST", "/users"),
            make_entry("GET", "/users/:id"),
        ];
        let type_map = HashMap::new();
        let spec = generate_openapi(&entries, &type_map);
        let parsed: Value = serde_json::from_str(&spec).unwrap();

        assert_eq!(
            parsed["paths"]["/users"]["get"]["operationId"],
            "getUsers"
        );
        assert_eq!(
            parsed["paths"]["/users"]["post"]["operationId"],
            "postUsers"
        );
        assert_eq!(
            parsed["paths"]["/users/{id}"]["get"]["operationId"],
            "getUsersId"
        );
    }

    fn make_entry(method: &str, path: &str) -> RouteEntry {
        let segments = parse_path_segments(path);
        RouteEntry {
            method: method.to_string(),
            path: path.to_string(),
            segments,
            handler_ref: format!("test#{} {}", method, path),
            params_type: RouteTypeInfo::Void,
            query_type: RouteTypeInfo::Void,
            body_type: RouteTypeInfo::Void,
            response_type: RouteTypeInfo::Void,
        }
    }
}
