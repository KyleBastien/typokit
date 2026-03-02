use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use swc_common::comments::{Comment, CommentKind, SingleThreadedComments, Comments};
use swc_common::Spanned;
use swc_ecma_ast::*;

/// Metadata about a single property in a type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyMetadata {
    #[serde(rename = "type")]
    pub type_str: String,
    pub optional: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jsdoc: Option<HashMap<String, String>>,
}

/// Metadata about a single extracted type (matches @typokit/types TypeMetadata)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMetadata {
    pub name: String,
    pub properties: HashMap<String, PropertyMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jsdoc: Option<HashMap<String, String>>,
}

/// Extract all JSDoc tags from a comment block
fn parse_jsdoc_tags(comment: &str) -> HashMap<String, String> {
    let mut tags: HashMap<String, String> = HashMap::new();

    for line in comment.lines() {
        let trimmed = line.trim().trim_start_matches('*').trim();
        // Find all @tag occurrences on this line
        let mut rest = trimmed;
        while let Some(at_pos) = rest.find('@') {
            rest = &rest[at_pos + 1..];
            let parts: Vec<&str> = rest.splitn(2, char::is_whitespace).collect();
            let tag_name = parts[0].to_string();
            let tag_value_str = parts.get(1).map(|s| s.trim()).unwrap_or("");
            // The tag value is everything up to the next @tag or end of line
            let value = if let Some(next_at) = tag_value_str.find('@') {
                tag_value_str[..next_at].trim().to_string()
            } else {
                tag_value_str.to_string()
            };
            tags.insert(tag_name, value);
            // Advance rest past this tag's value to find next @
            rest = parts.get(1).map(|s| *s).unwrap_or("");
        }
    }

    tags
}

/// Get leading comments for a span position
fn get_leading_comments(comments: &SingleThreadedComments, span: &dyn Spanned) -> Vec<Comment> {
    let lo = span.span().lo;
    comments.get_leading(lo).unwrap_or_default()
}

/// Convert a TypeScript type annotation to a string representation
fn ts_type_to_string(ts_type: &TsType) -> String {
    match ts_type {
        TsType::TsKeywordType(kw) => match kw.kind {
            TsKeywordTypeKind::TsStringKeyword => "string".to_string(),
            TsKeywordTypeKind::TsNumberKeyword => "number".to_string(),
            TsKeywordTypeKind::TsBooleanKeyword => "boolean".to_string(),
            TsKeywordTypeKind::TsVoidKeyword => "void".to_string(),
            TsKeywordTypeKind::TsNullKeyword => "null".to_string(),
            TsKeywordTypeKind::TsUndefinedKeyword => "undefined".to_string(),
            TsKeywordTypeKind::TsAnyKeyword => "any".to_string(),
            TsKeywordTypeKind::TsUnknownKeyword => "unknown".to_string(),
            TsKeywordTypeKind::TsNeverKeyword => "never".to_string(),
            TsKeywordTypeKind::TsBigIntKeyword => "bigint".to_string(),
            TsKeywordTypeKind::TsSymbolKeyword => "symbol".to_string(),
            TsKeywordTypeKind::TsObjectKeyword => "object".to_string(),
            _ => "unknown".to_string(),
        },
        TsType::TsTypeRef(type_ref) => {
            let name = match &type_ref.type_name {
                TsEntityName::Ident(ident) => ident.sym.to_string(),
                TsEntityName::TsQualifiedName(qn) => format!("{}.{}", ts_entity_name_to_string(&TsEntityName::TsQualifiedName(qn.clone())), ""),
            };
            if let Some(type_params) = &type_ref.type_params {
                let params: Vec<String> = type_params.params.iter().map(|p| ts_type_to_string(p)).collect();
                format!("{}<{}>", name, params.join(", "))
            } else {
                name
            }
        }
        TsType::TsArrayType(arr) => format!("{}[]", ts_type_to_string(&arr.elem_type)),
        TsType::TsUnionOrIntersectionType(u) => match u {
            TsUnionOrIntersectionType::TsUnionType(union) => {
                let types: Vec<String> = union.types.iter().map(|t| ts_type_to_string(t)).collect();
                types.join(" | ")
            }
            TsUnionOrIntersectionType::TsIntersectionType(inter) => {
                let types: Vec<String> = inter.types.iter().map(|t| ts_type_to_string(t)).collect();
                types.join(" & ")
            }
        },
        TsType::TsLitType(lit) => match &lit.lit {
            TsLit::Str(s) => format!("\"{}\"", s.value.to_string_lossy()),
            TsLit::Number(n) => n.value.to_string(),
            TsLit::Bool(b) => b.value.to_string(),
            _ => "unknown".to_string(),
        },
        TsType::TsParenthesizedType(paren) => format!("({})", ts_type_to_string(&paren.type_ann)),
        TsType::TsOptionalType(opt) => format!("{}?", ts_type_to_string(&opt.type_ann)),
        TsType::TsTupleType(tuple) => {
            let elems: Vec<String> = tuple.elem_types.iter().map(|e| ts_type_to_string(&e.ty)).collect();
            format!("[{}]", elems.join(", "))
        }
        TsType::TsFnOrConstructorType(_) => "Function".to_string(),
        TsType::TsTypeLit(_) => "object".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Helper to convert TsEntityName to string
fn ts_entity_name_to_string(name: &TsEntityName) -> String {
    match name {
        TsEntityName::Ident(ident) => ident.sym.to_string(),
        TsEntityName::TsQualifiedName(qn) => {
            format!("{}.{}", ts_entity_name_to_string(&qn.left), qn.right.sym)
        }
    }
}

/// Extract type metadata from all interfaces in a module
pub fn extract_types(module: &Module, comments: &SingleThreadedComments) -> HashMap<String, TypeMetadata> {
    let mut types: HashMap<String, TypeMetadata> = HashMap::new();

    for item in &module.body {
        match item {
            ModuleItem::Stmt(Stmt::Decl(Decl::TsInterface(iface))) => {
                let metadata = extract_interface(iface, comments);
                types.insert(metadata.name.clone(), metadata);
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
                if let Decl::TsInterface(iface) = &export.decl {
                    let metadata = extract_interface(iface, comments);
                    types.insert(metadata.name.clone(), metadata);
                }
            }
            _ => {}
        }
    }

    types
}

/// Extract metadata from a single interface declaration
fn extract_interface(iface: &TsInterfaceDecl, comments: &SingleThreadedComments) -> TypeMetadata {
    let name = iface.id.sym.to_string();

    // Extract interface-level JSDoc tags
    let leading = get_leading_comments(comments, iface);
    let iface_jsdoc = extract_jsdoc_from_comments(&leading);

    let mut properties: HashMap<String, PropertyMetadata> = HashMap::new();

    for member in &iface.body.body {
        if let TsTypeElement::TsPropertySignature(prop) = member {
            let prop_name = match &*prop.key {
                Expr::Ident(ident) => ident.sym.to_string(),
                _ => continue,
            };

            let type_str = prop
                .type_ann
                .as_ref()
                .map(|ann| ts_type_to_string(&ann.type_ann))
                .unwrap_or_else(|| "unknown".to_string());

            let optional = prop.optional;

            // Extract property-level JSDoc tags
            let prop_leading = get_leading_comments(comments, prop);
            let prop_jsdoc = extract_jsdoc_from_comments(&prop_leading);

            properties.insert(
                prop_name,
                PropertyMetadata {
                    type_str,
                    optional,
                    jsdoc: if prop_jsdoc.is_empty() { None } else { Some(prop_jsdoc) },
                },
            );
        }
    }

    TypeMetadata {
        name,
        properties,
        jsdoc: if iface_jsdoc.is_empty() { None } else { Some(iface_jsdoc) },
    }
}

/// Extract JSDoc tags from comment list
fn extract_jsdoc_from_comments(comments: &[Comment]) -> HashMap<String, String> {
    let mut tags = HashMap::new();
    for comment in comments {
        if comment.kind == CommentKind::Block {
            let parsed = parse_jsdoc_tags(&comment.text);
            tags.extend(parsed);
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_typescript;

    #[test]
    fn test_extract_simple_interface() {
        let source = r#"
interface User {
    id: string;
    name: string;
    age: number;
    active: boolean;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        assert!(types.contains_key("User"));
        let user = &types["User"];
        assert_eq!(user.name, "User");
        assert_eq!(user.properties.len(), 4);
        assert_eq!(user.properties["id"].type_str, "string");
        assert_eq!(user.properties["age"].type_str, "number");
        assert_eq!(user.properties["active"].type_str, "boolean");
        assert!(!user.properties["id"].optional);
    }

    #[test]
    fn test_extract_optional_properties() {
        let source = r#"
interface Profile {
    bio?: string;
    avatar?: string;
    required: number;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        let profile = &types["Profile"];
        assert!(profile.properties["bio"].optional);
        assert!(profile.properties["avatar"].optional);
        assert!(!profile.properties["required"].optional);
    }

    #[test]
    fn test_extract_jsdoc_table_tag() {
        let source = r#"
/**
 * @table users
 */
interface User {
    /** @id */
    id: string;
    name: string;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        let user = &types["User"];
        let jsdoc = user.jsdoc.as_ref().unwrap();
        assert_eq!(jsdoc["table"], "users");

        let id_jsdoc = user.properties["id"].jsdoc.as_ref().unwrap();
        assert!(id_jsdoc.contains_key("id"));
    }

    #[test]
    fn test_extract_all_jsdoc_tags() {
        let source = r#"
/**
 * @table users
 */
interface User {
    /** @id @generated */
    id: string;
    /** @format email @unique */
    email: string;
    /** @minLength 2 @maxLength 100 */
    name: string;
    /** @default now() @onUpdate now() */
    updatedAt: string;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        let user = &types["User"];
        let id_jsdoc = user.properties["id"].jsdoc.as_ref().unwrap();
        assert!(id_jsdoc.contains_key("id"));
        assert!(id_jsdoc.contains_key("generated"));

        let email_jsdoc = user.properties["email"].jsdoc.as_ref().unwrap();
        assert_eq!(email_jsdoc["format"], "email");
        assert!(email_jsdoc.contains_key("unique"));

        let name_jsdoc = user.properties["name"].jsdoc.as_ref().unwrap();
        assert_eq!(name_jsdoc["minLength"], "2");
        assert_eq!(name_jsdoc["maxLength"], "100");

        let updated_jsdoc = user.properties["updatedAt"].jsdoc.as_ref().unwrap();
        assert_eq!(updated_jsdoc["default"], "now()");
        assert_eq!(updated_jsdoc["onUpdate"], "now()");
    }

    #[test]
    fn test_extract_exported_interface() {
        let source = r#"
export interface Post {
    id: string;
    title: string;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        assert!(types.contains_key("Post"));
        assert_eq!(types["Post"].properties.len(), 2);
    }

    #[test]
    fn test_extract_complex_types() {
        let source = r#"
interface Complex {
    tags: string[];
    metadata: Record<string, unknown>;
    status: "active" | "inactive";
    nested?: Array<string>;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        let complex = &types["Complex"];
        assert_eq!(complex.properties["tags"].type_str, "string[]");
        assert_eq!(complex.properties["metadata"].type_str, "Record<string, unknown>");
        assert_eq!(complex.properties["status"].type_str, "\"active\" | \"inactive\"");
    }

    #[test]
    fn test_extract_multiple_interfaces() {
        let source = r#"
interface User {
    id: string;
}
interface Post {
    id: string;
    authorId: string;
}
"#;
        let parsed = parse_typescript("test.ts", source).unwrap();
        let types = extract_types(&parsed.module, &parsed.comments);

        assert_eq!(types.len(), 2);
        assert!(types.contains_key("User"));
        assert!(types.contains_key("Post"));
    }
}
