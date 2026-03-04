use std::collections::HashMap;
use std::fs;
use swc_common::{
    comments::SingleThreadedComments,
    sync::Lrc,
    FileName, SourceMap,
};
use swc_ecma_ast::EsVersion;
use swc_ecma_parser::{lexer::Lexer, Parser, Syntax, TsSyntax, StringInput};

use crate::type_extractor::TypeMetadata;

/// Parsed result for a single TypeScript file
pub struct ParsedFile {
    pub path: String,
    pub module: swc_ecma_ast::Module,
    pub comments: SingleThreadedComments,
}

/// Parse a TypeScript source string into an AST with comments
pub fn parse_typescript(path: &str, source: &str) -> Result<ParsedFile, String> {
    let cm: Lrc<SourceMap> = Default::default();
    let comments = SingleThreadedComments::default();

    let fm = cm.new_source_file(Lrc::new(FileName::Custom(path.to_string())), source.to_string());

    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: false,
            decorators: true,
            ..Default::default()
        }),
        EsVersion::latest(),
        StringInput::from(&*fm),
        Some(&comments),
    );

    let mut parser = Parser::new_from(lexer);
    let module = parser.parse_module().map_err(|e| format!("Parse error in {}: {:?}", path, e))?;

    Ok(ParsedFile {
        path: path.to_string(),
        module,
        comments,
    })
}

/// Parse multiple TypeScript files and extract type metadata from all of them
pub fn parse_and_extract_types(file_paths: &[String]) -> Result<HashMap<String, TypeMetadata>, String> {
    let mut schema_map: HashMap<String, TypeMetadata> = HashMap::new();

    for path in file_paths {
        let source = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", path, e))?;

        let parsed = parse_typescript(path, &source)?;
        let types = crate::type_extractor::extract_types(&parsed.module, &parsed.comments);

        for (name, metadata) in types {
            schema_map.insert(name, metadata);
        }
    }

    Ok(schema_map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_interface() {
        let source = r#"
            interface User {
                id: string;
                name: string;
            }
        "#;
        let result = parse_typescript("test.ts", source);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_with_jsdoc() {
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
        let result = parse_typescript("test.ts", source);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_invalid_syntax() {
        let source = "interface { invalid }";
        let result = parse_typescript("test.ts", source);
        assert!(result.is_err());
    }
}
