use std::collections::BTreeMap;
use serde::{Serialize, Deserialize};
use swc_ecma_ast::*;

// ─── Type Representation for Route Contract Parameters ───────

/// Rich type info extracted from RouteContract type parameters
#[derive(Debug, Clone)]
pub enum RouteTypeInfo {
    Void,
    Primitive(String),
    Named(String),
    Generic(String, Vec<RouteTypeInfo>),
    Array(Box<RouteTypeInfo>),
    ObjectLiteral(Vec<RouteObjectProp>),
    Union(Vec<RouteTypeInfo>),
    StringLiteral(String),
    NumberLiteral(f64),
    BooleanLiteral(bool),
}

#[derive(Debug, Clone)]
pub struct RouteObjectProp {
    pub name: String,
    pub type_info: RouteTypeInfo,
    pub optional: bool,
}

// ─── Route Entry ─────────────────────────────────────────────

/// A parsed route entry from a route contract interface
#[derive(Debug, Clone)]
pub struct RouteEntry {
    pub method: String,
    pub path: String,
    pub segments: Vec<PathSegment>,
    pub handler_ref: String,
    pub params_type: RouteTypeInfo,
    pub query_type: RouteTypeInfo,
    pub body_type: RouteTypeInfo,
    pub response_type: RouteTypeInfo,
}

/// A segment in a route path
#[derive(Debug, Clone)]
pub enum PathSegment {
    Static(String),
    Param(String),
    Wildcard(String),
}

// ─── Compiled Route Tree ─────────────────────────────────────

/// Handler entry in the compiled route table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteHandlerEntry {
    #[serde(rename = "ref")]
    pub ref_str: String,
    pub middleware: Vec<String>,
}

/// A compiled radix tree node (matches @typokit/types CompiledRoute)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteNode {
    pub segment: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "paramName")]
    pub param_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<BTreeMap<String, RouteNode>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "paramChild")]
    pub param_child: Option<Box<RouteNode>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "wildcardChild")]
    pub wildcard_child: Option<Box<RouteNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handlers: Option<BTreeMap<String, RouteHandlerEntry>>,
}

impl RouteNode {
    pub fn new(segment: &str) -> Self {
        Self {
            segment: segment.to_string(),
            param_name: None,
            children: None,
            param_child: None,
            wildcard_child: None,
            handlers: None,
        }
    }
}

// ─── Route Contract Extraction ───────────────────────────────

/// Extract route contracts from a parsed TypeScript module.
/// Looks for interfaces with string literal property keys matching "METHOD /path".
pub fn extract_route_contracts(module: &Module) -> Vec<RouteEntry> {
    let mut entries = Vec::new();

    for item in &module.body {
        let iface = match item {
            ModuleItem::Stmt(Stmt::Decl(Decl::TsInterface(iface))) => iface,
            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
                if let Decl::TsInterface(iface) = &export.decl {
                    iface
                } else {
                    continue;
                }
            }
            _ => continue,
        };

        let iface_name = iface.id.sym.to_string();

        for member in &iface.body.body {
            if let TsTypeElement::TsPropertySignature(prop) = member {
                let key_str = match &*prop.key {
                    Expr::Lit(Lit::Str(s)) => s.value.to_string_lossy().to_string(),
                    _ => continue,
                };

                let (method, path) = match parse_route_key(&key_str) {
                    Some(v) => v,
                    None => continue,
                };

                let (params_type, query_type, body_type, response_type) =
                    extract_route_contract_type_params(prop);

                let segments = parse_path_segments(&path);
                let handler_ref = format!("{}#{}", iface_name, key_str);

                entries.push(RouteEntry {
                    method,
                    path,
                    segments,
                    handler_ref,
                    params_type,
                    query_type,
                    body_type,
                    response_type,
                });
            }
        }
    }

    entries
}

fn parse_route_key(key: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = key.splitn(2, ' ').collect();
    if parts.len() != 2 {
        return None;
    }
    let method = parts[0].to_uppercase();
    let path = parts[1].to_string();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" => {}
        _ => return None,
    }
    Some((method, path))
}

/// Parse a URL path into segments
pub fn parse_path_segments(path: &str) -> Vec<PathSegment> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.starts_with(':') {
                PathSegment::Param(s[1..].to_string())
            } else if s.starts_with('*') {
                PathSegment::Wildcard(
                    if s.len() > 1 { s[1..].to_string() } else { "wildcard".to_string() },
                )
            } else {
                PathSegment::Static(s.to_string())
            }
        })
        .collect()
}

fn extract_route_contract_type_params(
    prop: &TsPropertySignature,
) -> (RouteTypeInfo, RouteTypeInfo, RouteTypeInfo, RouteTypeInfo) {
    let default = (
        RouteTypeInfo::Void,
        RouteTypeInfo::Void,
        RouteTypeInfo::Void,
        RouteTypeInfo::Void,
    );

    let type_ann = match &prop.type_ann {
        Some(ann) => &ann.type_ann,
        None => return default,
    };

    if let TsType::TsTypeRef(type_ref) = &**type_ann {
        let name = match &type_ref.type_name {
            TsEntityName::Ident(ident) => ident.sym.to_string(),
            _ => return default,
        };

        if name != "RouteContract" {
            return default;
        }

        if let Some(type_params) = &type_ref.type_params {
            let infos: Vec<RouteTypeInfo> = type_params
                .params
                .iter()
                .map(|p| ts_type_to_route_info(p))
                .collect();

            return (
                infos.first().cloned().unwrap_or(RouteTypeInfo::Void),
                infos.get(1).cloned().unwrap_or(RouteTypeInfo::Void),
                infos.get(2).cloned().unwrap_or(RouteTypeInfo::Void),
                infos.get(3).cloned().unwrap_or(RouteTypeInfo::Void),
            );
        }
    }

    default
}

/// Convert a TsType AST node to a RouteTypeInfo representation
pub fn ts_type_to_route_info(ts_type: &TsType) -> RouteTypeInfo {
    match ts_type {
        TsType::TsKeywordType(kw) => match kw.kind {
            TsKeywordTypeKind::TsVoidKeyword => RouteTypeInfo::Void,
            TsKeywordTypeKind::TsStringKeyword => RouteTypeInfo::Primitive("string".into()),
            TsKeywordTypeKind::TsNumberKeyword => RouteTypeInfo::Primitive("number".into()),
            TsKeywordTypeKind::TsBooleanKeyword => RouteTypeInfo::Primitive("boolean".into()),
            TsKeywordTypeKind::TsAnyKeyword => RouteTypeInfo::Primitive("any".into()),
            TsKeywordTypeKind::TsUnknownKeyword => RouteTypeInfo::Primitive("unknown".into()),
            TsKeywordTypeKind::TsNeverKeyword => RouteTypeInfo::Primitive("never".into()),
            TsKeywordTypeKind::TsNullKeyword => RouteTypeInfo::Primitive("null".into()),
            TsKeywordTypeKind::TsUndefinedKeyword => RouteTypeInfo::Primitive("undefined".into()),
            _ => RouteTypeInfo::Primitive("unknown".into()),
        },
        TsType::TsTypeRef(type_ref) => {
            let name = match &type_ref.type_name {
                TsEntityName::Ident(ident) => ident.sym.to_string(),
                TsEntityName::TsQualifiedName(qn) => qualified_name_to_string(qn),
            };

            if let Some(params) = &type_ref.type_params {
                let args: Vec<RouteTypeInfo> =
                    params.params.iter().map(|p| ts_type_to_route_info(p)).collect();

                // Normalize Array<T> to Array(T)
                if name == "Array" && args.len() == 1 {
                    return RouteTypeInfo::Array(Box::new(args.into_iter().next().unwrap()));
                }

                RouteTypeInfo::Generic(name, args)
            } else {
                RouteTypeInfo::Named(name)
            }
        }
        TsType::TsArrayType(arr) => {
            RouteTypeInfo::Array(Box::new(ts_type_to_route_info(&arr.elem_type)))
        }
        TsType::TsTypeLit(type_lit) => {
            let props = type_lit
                .members
                .iter()
                .filter_map(|m| {
                    if let TsTypeElement::TsPropertySignature(prop) = m {
                        let name = match &*prop.key {
                            Expr::Ident(ident) => ident.sym.to_string(),
                            _ => return None,
                        };
                        let type_info = prop
                            .type_ann
                            .as_ref()
                            .map(|ann| ts_type_to_route_info(&ann.type_ann))
                            .unwrap_or(RouteTypeInfo::Primitive("unknown".into()));
                        Some(RouteObjectProp {
                            name,
                            type_info,
                            optional: prop.optional,
                        })
                    } else {
                        None
                    }
                })
                .collect();
            RouteTypeInfo::ObjectLiteral(props)
        }
        TsType::TsUnionOrIntersectionType(TsUnionOrIntersectionType::TsUnionType(union)) => {
            RouteTypeInfo::Union(
                union.types.iter().map(|t| ts_type_to_route_info(t)).collect(),
            )
        }
        TsType::TsLitType(lit) => match &lit.lit {
            TsLit::Str(s) => RouteTypeInfo::StringLiteral(s.value.to_string_lossy().to_string()),
            TsLit::Number(n) => RouteTypeInfo::NumberLiteral(n.value),
            TsLit::Bool(b) => RouteTypeInfo::BooleanLiteral(b.value),
            _ => RouteTypeInfo::Primitive("unknown".into()),
        },
        TsType::TsParenthesizedType(paren) => ts_type_to_route_info(&paren.type_ann),
        _ => RouteTypeInfo::Primitive("unknown".into()),
    }
}

fn qualified_name_to_string(qn: &TsQualifiedName) -> String {
    let left = match &qn.left {
        TsEntityName::Ident(ident) => ident.sym.to_string(),
        TsEntityName::TsQualifiedName(qn) => qualified_name_to_string(qn),
    };
    format!("{}.{}", left, qn.right.sym)
}

// ─── Radix Tree Construction ─────────────────────────────────

/// Build a radix tree from route entries.
/// Returns an error on ambiguous routes (conflicting param names at same level).
pub fn build_radix_tree(entries: &[RouteEntry]) -> Result<RouteNode, String> {
    let mut root = RouteNode::new("");

    for entry in entries {
        insert_route(
            &mut root,
            &entry.segments,
            0,
            &entry.method,
            &RouteHandlerEntry {
                ref_str: entry.handler_ref.clone(),
                middleware: vec![],
            },
        )?;
    }

    Ok(root)
}

fn insert_route(
    node: &mut RouteNode,
    segments: &[PathSegment],
    index: usize,
    method: &str,
    handler: &RouteHandlerEntry,
) -> Result<(), String> {
    if index >= segments.len() {
        let handlers = node.handlers.get_or_insert_with(BTreeMap::new);
        if handlers.contains_key(method) {
            return Err(format!(
                "Duplicate route: {} handler already defined at this path",
                method
            ));
        }
        handlers.insert(method.to_string(), handler.clone());
        return Ok(());
    }

    match &segments[index] {
        PathSegment::Static(name) => {
            let children = node.children.get_or_insert_with(BTreeMap::new);
            let child = children
                .entry(name.clone())
                .or_insert_with(|| RouteNode::new(name));
            insert_route(child, segments, index + 1, method, handler)
        }
        PathSegment::Param(param_name) => {
            if let Some(existing) = &node.param_child {
                let existing_name = existing.param_name.as_ref().unwrap();
                if existing_name != param_name {
                    return Err(format!(
                        "Ambiguous route: param ':{}' conflicts with existing param ':{}' at the same path level",
                        param_name, existing_name
                    ));
                }
            }

            if node.param_child.is_none() {
                let mut param_node = RouteNode::new("");
                param_node.param_name = Some(param_name.clone());
                node.param_child = Some(Box::new(param_node));
            }

            insert_route(
                node.param_child.as_mut().unwrap(),
                segments,
                index + 1,
                method,
                handler,
            )
        }
        PathSegment::Wildcard(param_name) => {
            if node.wildcard_child.is_some() {
                return Err(format!(
                    "Ambiguous route: wildcard '*{}' conflicts with existing wildcard at the same path level",
                    param_name
                ));
            }

            let mut wildcard_node = RouteNode::new("");
            wildcard_node.param_name = Some(param_name.clone());
            let handlers = wildcard_node.handlers.get_or_insert_with(BTreeMap::new);
            handlers.insert(method.to_string(), handler.clone());
            node.wildcard_child = Some(Box::new(wildcard_node));
            Ok(())
        }
    }
}

// ─── TypeScript Serialization ────────────────────────────────

/// Serialize the compiled route tree as TypeScript code.
pub fn serialize_to_typescript(root: &RouteNode) -> String {
    let json = serde_json::to_string_pretty(root).unwrap();
    format!(
        "// AUTO-GENERATED by @typokit/transform-native — DO NOT EDIT\n\
         import type {{ CompiledRouteTable }} from \"@typokit/types\";\n\
         \n\
         export const routeTree: CompiledRouteTable = {} as const;\n",
        json
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_typescript;

    #[test]
    fn test_extract_route_contracts_basic() {
        let source = r#"
interface UsersRoutes {
    "GET /users": RouteContract<void, void, void, PublicUser[]>;
    "POST /users": RouteContract<void, void, CreateUserInput, PublicUser>;
    "GET /users/:id": RouteContract<{ id: string }, void, void, PublicUser>;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let entries = extract_route_contracts(&parsed.module);

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].method, "GET");
        assert_eq!(entries[0].path, "/users");
        assert_eq!(entries[1].method, "POST");
        assert_eq!(entries[1].path, "/users");
        assert_eq!(entries[2].method, "GET");
        assert_eq!(entries[2].path, "/users/:id");
    }

    #[test]
    fn test_extract_route_contracts_with_query_params() {
        let source = r#"
interface UsersRoutes {
    "GET /users": RouteContract<void, { page?: number; pageSize?: number }, void, void>;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let entries = extract_route_contracts(&parsed.module);

        assert_eq!(entries.len(), 1);
        match &entries[0].query_type {
            RouteTypeInfo::ObjectLiteral(props) => {
                assert_eq!(props.len(), 2);
                assert_eq!(props[0].name, "page");
                assert!(props[0].optional);
                assert_eq!(props[1].name, "pageSize");
                assert!(props[1].optional);
            }
            _ => panic!("Expected ObjectLiteral for query type"),
        }
    }

    #[test]
    fn test_extract_route_contracts_exported_interface() {
        let source = r#"
export interface HealthRoutes {
    "GET /health": RouteContract<void, void, void, { status: string }>;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let entries = extract_route_contracts(&parsed.module);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].method, "GET");
        assert_eq!(entries[0].path, "/health");
        assert!(entries[0].handler_ref.contains("HealthRoutes"));
    }

    #[test]
    fn test_extract_ignores_non_route_interfaces() {
        let source = r#"
interface User {
    id: string;
    name: string;
}
interface UsersRoutes {
    "GET /users": RouteContract<void, void, void, void>;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let entries = extract_route_contracts(&parsed.module);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/users");
    }

    #[test]
    fn test_build_radix_tree_basic() {
        let entries = vec![
            make_entry("GET", "/users"),
            make_entry("POST", "/users"),
            make_entry("GET", "/users/:id"),
            make_entry("GET", "/health"),
        ];

        let tree = build_radix_tree(&entries).unwrap();

        assert_eq!(tree.segment, "");
        let children = tree.children.as_ref().unwrap();
        assert!(children.contains_key("users"));
        assert!(children.contains_key("health"));

        let users = &children["users"];
        let handlers = users.handlers.as_ref().unwrap();
        assert!(handlers.contains_key("GET"));
        assert!(handlers.contains_key("POST"));

        let param_child = users.param_child.as_ref().unwrap();
        assert_eq!(param_child.param_name, Some("id".to_string()));
    }

    #[test]
    fn test_build_radix_tree_nested_params() {
        let entries = vec![make_entry("GET", "/users/:userId/posts/:postId")];

        let tree = build_radix_tree(&entries).unwrap();

        let users = &tree.children.as_ref().unwrap()["users"];
        let user_param = users.param_child.as_ref().unwrap();
        assert_eq!(user_param.param_name, Some("userId".to_string()));

        let posts = &user_param.children.as_ref().unwrap()["posts"];
        let post_param = posts.param_child.as_ref().unwrap();
        assert_eq!(post_param.param_name, Some("postId".to_string()));
    }

    #[test]
    fn test_build_radix_tree_ambiguous_params() {
        let entries = vec![
            make_entry("GET", "/users/:id"),
            make_entry("GET", "/users/:userId/posts"),
        ];

        let result = build_radix_tree(&entries);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Ambiguous"));
    }

    #[test]
    fn test_build_radix_tree_wildcard() {
        let entries = vec![make_entry("GET", "/files/*path")];

        let tree = build_radix_tree(&entries).unwrap();
        let files = &tree.children.as_ref().unwrap()["files"];
        let wildcard = files.wildcard_child.as_ref().unwrap();
        assert_eq!(wildcard.param_name, Some("path".to_string()));
    }

    #[test]
    fn test_build_radix_tree_static_and_param_coexist() {
        let entries = vec![
            make_entry("GET", "/users/me"),
            make_entry("GET", "/users/:id"),
        ];

        let tree = build_radix_tree(&entries).unwrap();
        let users = &tree.children.as_ref().unwrap()["users"];

        // Static "me" child
        assert!(users.children.as_ref().unwrap().contains_key("me"));
        // Param child
        assert!(users.param_child.is_some());
    }

    #[test]
    fn test_serialize_to_typescript() {
        let entries = vec![make_entry("GET", "/health")];
        let tree = build_radix_tree(&entries).unwrap();
        let ts = serialize_to_typescript(&tree);

        assert!(ts.contains("AUTO-GENERATED"));
        assert!(ts.contains("CompiledRouteTable"));
        assert!(ts.contains("routeTree"));
        assert!(ts.contains("health"));
    }

    #[test]
    fn test_duplicate_handler_error() {
        let entries = vec![make_entry("GET", "/users"), make_entry("GET", "/users")];

        let result = build_radix_tree(&entries);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Duplicate"));
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
