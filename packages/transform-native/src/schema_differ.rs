use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::type_extractor::TypeMetadata;

/// A single schema change (matches @typokit/types SchemaChange)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaChange {
    #[serde(rename = "type")]
    pub change_type: String, // "add" | "remove" | "modify"
    pub entity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, String>>,
}

/// A migration draft (matches @typokit/types MigrationDraft)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationDraft {
    pub name: String,
    pub sql: String,
    pub destructive: bool,
    pub changes: Vec<SchemaChange>,
}

/// Diff two SchemaTypeMap versions and produce a MigrationDraft.
///
/// Compares old_types against new_types to detect:
/// - Added entities (new types not in old)
/// - Removed entities (old types not in new)
/// - Added fields (new properties on existing types)
/// - Removed fields (old properties missing from new types)
/// - Modified fields (property type changed)
pub fn diff_schemas(
    old_types: &HashMap<String, TypeMetadata>,
    new_types: &HashMap<String, TypeMetadata>,
    migration_name: &str,
) -> MigrationDraft {
    let mut changes: Vec<SchemaChange> = Vec::new();
    let mut sql_parts: Vec<String> = Vec::new();
    let mut destructive = false;

    // Detect added entities
    for (name, meta) in new_types {
        if !old_types.contains_key(name) {
            changes.push(SchemaChange {
                change_type: "add".to_string(),
                entity: name.clone(),
                field: None,
                details: None,
            });
            sql_parts.push(generate_create_table_sql(name, meta));
        }
    }

    // Detect removed entities
    for name in old_types.keys() {
        if !new_types.contains_key(name) {
            changes.push(SchemaChange {
                change_type: "remove".to_string(),
                entity: name.clone(),
                field: None,
                details: None,
            });
            sql_parts.push(format!(
                "-- DESTRUCTIVE: requires review\nDROP TABLE IF EXISTS \"{}\";",
                to_table_name(name)
            ));
            destructive = true;
        }
    }

    // Detect field-level changes on existing entities
    for (name, new_meta) in new_types {
        if let Some(old_meta) = old_types.get(name) {
            let table = to_table_name(name);

            // Added fields
            for (field_name, new_prop) in &new_meta.properties {
                if !old_meta.properties.contains_key(field_name) {
                    changes.push(SchemaChange {
                        change_type: "add".to_string(),
                        entity: name.clone(),
                        field: Some(field_name.clone()),
                        details: None,
                    });
                    let col_type = ts_type_to_sql(&new_prop.type_str);
                    let nullable = if new_prop.optional { "" } else { " NOT NULL" };
                    sql_parts.push(format!(
                        "ALTER TABLE \"{}\" ADD COLUMN \"{}\" {}{};",
                        table, field_name, col_type, nullable
                    ));
                }
            }

            // Removed fields
            for field_name in old_meta.properties.keys() {
                if !new_meta.properties.contains_key(field_name) {
                    changes.push(SchemaChange {
                        change_type: "remove".to_string(),
                        entity: name.clone(),
                        field: Some(field_name.clone()),
                        details: None,
                    });
                    sql_parts.push(format!(
                        "-- DESTRUCTIVE: requires review\nALTER TABLE \"{}\" DROP COLUMN \"{}\";",
                        table, field_name
                    ));
                    destructive = true;
                }
            }

            // Modified fields (type changed)
            for (field_name, new_prop) in &new_meta.properties {
                if let Some(old_prop) = old_meta.properties.get(field_name) {
                    if old_prop.type_str != new_prop.type_str {
                        let mut details = HashMap::new();
                        details.insert("oldType".to_string(), old_prop.type_str.clone());
                        details.insert("newType".to_string(), new_prop.type_str.clone());
                        changes.push(SchemaChange {
                            change_type: "modify".to_string(),
                            entity: name.clone(),
                            field: Some(field_name.clone()),
                            details: Some(details),
                        });
                        let col_type = ts_type_to_sql(&new_prop.type_str);
                        sql_parts.push(format!(
                            "-- DESTRUCTIVE: requires review\nALTER TABLE \"{}\" ALTER COLUMN \"{}\" TYPE {};",
                            table, field_name, col_type
                        ));
                        destructive = true;
                    }
                }
            }
        }
    }

    let sql = if sql_parts.is_empty() {
        "-- No changes detected".to_string()
    } else {
        sql_parts.join("\n\n")
    };

    MigrationDraft {
        name: migration_name.to_string(),
        sql,
        destructive,
        changes,
    }
}

/// Convert a PascalCase type name to a snake_case table name
fn to_table_name(name: &str) -> String {
    let mut result = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            result.push('_');
        }
        result.push(ch.to_ascii_lowercase());
    }
    result
}

/// Map TypeScript type strings to SQL column types
fn ts_type_to_sql(ts_type: &str) -> String {
    match ts_type {
        "string" => "TEXT".to_string(),
        "number" => "INTEGER".to_string(),
        "boolean" => "BOOLEAN".to_string(),
        "bigint" => "BIGINT".to_string(),
        t if t.ends_with("[]") => "JSONB".to_string(),
        t if t.starts_with("Record<") => "JSONB".to_string(),
        t if t.contains('|') => "TEXT".to_string(), // union types → TEXT
        _ => "TEXT".to_string(), // default fallback
    }
}

/// Generate CREATE TABLE SQL from a TypeMetadata
fn generate_create_table_sql(name: &str, meta: &TypeMetadata) -> String {
    let table = to_table_name(name);
    let mut columns: Vec<String> = Vec::new();

    // Sort keys for deterministic output
    let mut keys: Vec<&String> = meta.properties.keys().collect();
    keys.sort();

    for key in keys {
        let prop = &meta.properties[key];
        let col_type = ts_type_to_sql(&prop.type_str);
        let nullable = if prop.optional { "" } else { " NOT NULL" };
        columns.push(format!("  \"{}\" {}{}", key, col_type, nullable));
    }

    format!(
        "CREATE TABLE \"{}\" (\n{}\n);",
        table,
        columns.join(",\n")
    )
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
    fn test_diff_added_entity() {
        let old = HashMap::new();
        let mut new = HashMap::new();
        new.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("name", "string", false),
        ]));

        let draft = diff_schemas(&old, &new, "add_user");

        assert_eq!(draft.name, "add_user");
        assert!(!draft.destructive);
        assert_eq!(draft.changes.len(), 1);
        assert_eq!(draft.changes[0].change_type, "add");
        assert_eq!(draft.changes[0].entity, "User");
        assert!(draft.changes[0].field.is_none());
        assert!(draft.sql.contains("CREATE TABLE"));
        assert!(draft.sql.contains("user"));
    }

    #[test]
    fn test_diff_removed_entity() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
        ]));
        let new = HashMap::new();

        let draft = diff_schemas(&old, &new, "remove_user");

        assert!(draft.destructive);
        assert_eq!(draft.changes.len(), 1);
        assert_eq!(draft.changes[0].change_type, "remove");
        assert_eq!(draft.changes[0].entity, "User");
        assert!(draft.sql.contains("DROP TABLE"));
        assert!(draft.sql.contains("DESTRUCTIVE"));
    }

    #[test]
    fn test_diff_added_field() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
        ]));
        let mut new = HashMap::new();
        new.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("email", "string", false),
        ]));

        let draft = diff_schemas(&old, &new, "add_email");

        assert!(!draft.destructive);
        let add_changes: Vec<_> = draft.changes.iter()
            .filter(|c| c.change_type == "add" && c.field.is_some())
            .collect();
        assert_eq!(add_changes.len(), 1);
        assert_eq!(add_changes[0].field.as_ref().unwrap(), "email");
        assert!(draft.sql.contains("ADD COLUMN"));
    }

    #[test]
    fn test_diff_removed_field() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("email", "string", false),
        ]));
        let mut new = HashMap::new();
        new.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
        ]));

        let draft = diff_schemas(&old, &new, "remove_email");

        assert!(draft.destructive);
        let remove_changes: Vec<_> = draft.changes.iter()
            .filter(|c| c.change_type == "remove" && c.field.is_some())
            .collect();
        assert_eq!(remove_changes.len(), 1);
        assert_eq!(remove_changes[0].field.as_ref().unwrap(), "email");
        assert!(draft.sql.contains("DROP COLUMN"));
    }

    #[test]
    fn test_diff_modified_field_type() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("age", "string", false),
        ]));
        let mut new = HashMap::new();
        new.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("age", "number", false),
        ]));

        let draft = diff_schemas(&old, &new, "modify_age");

        assert!(draft.destructive);
        let modify_changes: Vec<_> = draft.changes.iter()
            .filter(|c| c.change_type == "modify")
            .collect();
        assert_eq!(modify_changes.len(), 1);
        assert_eq!(modify_changes[0].field.as_ref().unwrap(), "age");
        let details = modify_changes[0].details.as_ref().unwrap();
        assert_eq!(details["oldType"], "string");
        assert_eq!(details["newType"], "number");
        assert!(draft.sql.contains("ALTER COLUMN"));
    }

    #[test]
    fn test_diff_no_changes() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
        ]));
        let new = old.clone();

        let draft = diff_schemas(&old, &new, "no_changes");

        assert!(!draft.destructive);
        assert!(draft.changes.is_empty());
        assert!(draft.sql.contains("No changes"));
    }

    #[test]
    fn test_diff_multiple_changes() {
        let mut old = HashMap::new();
        old.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("name", "string", false),
        ]));

        let mut new = HashMap::new();
        new.insert("User".to_string(), make_type("User", vec![
            ("id", "string", false),
            ("email", "string", false),
        ]));
        new.insert("Post".to_string(), make_type("Post", vec![
            ("id", "string", false),
            ("title", "string", false),
        ]));

        let draft = diff_schemas(&old, &new, "multi_change");

        // Should have: add Post entity, add email field, remove name field
        assert!(draft.changes.len() >= 3);
        assert!(draft.destructive); // removing 'name' is destructive
    }

    #[test]
    fn test_to_table_name() {
        assert_eq!(to_table_name("User"), "user");
        assert_eq!(to_table_name("BlogPost"), "blog_post");
        assert_eq!(to_table_name("APIKey"), "a_p_i_key");
    }

    #[test]
    fn test_ts_type_to_sql() {
        assert_eq!(ts_type_to_sql("string"), "TEXT");
        assert_eq!(ts_type_to_sql("number"), "INTEGER");
        assert_eq!(ts_type_to_sql("boolean"), "BOOLEAN");
        assert_eq!(ts_type_to_sql("string[]"), "JSONB");
        assert_eq!(ts_type_to_sql("Record<string, unknown>"), "JSONB");
        assert_eq!(ts_type_to_sql("\"active\" | \"inactive\""), "TEXT");
    }
}
