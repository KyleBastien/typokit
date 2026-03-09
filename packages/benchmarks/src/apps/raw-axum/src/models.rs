use serde::{Deserialize, Serialize};

/// Matches the TypeScript BenchmarkResponseShape exactly.
#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkResponseShape {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub priority: i64,
    pub tags: Vec<String>,
    pub author: Author,
    pub metadata: Metadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Author {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

/// Static fixture response matching the TypeScript BENCHMARK_RESPONSE constant.
pub fn benchmark_response() -> BenchmarkResponseShape {
    BenchmarkResponseShape {
        id: 1,
        title: "Benchmark Test Item".into(),
        status: "active".into(),
        priority: 5,
        tags: vec![
            "performance".into(),
            "benchmark".into(),
            "test".into(),
        ],
        author: Author {
            name: "TypoKit Benchmarks".into(),
            email: "bench@typokit.dev".into(),
        },
        metadata: Metadata {
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            version: 1,
        },
        description: Some(
            "A standard benchmark test item used across all framework comparisons.".into(),
        ),
    }
}

/// Request body for POST /validate, matching CreateBenchmarkItemBody.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CreateBenchmarkItemBody {
    pub title: String,
    pub status: String,
    pub priority: i64,
    pub tags: Vec<String>,
    pub author: AuthorInput,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthorInput {
    pub name: String,
    pub email: String,
}

/// Validation errors returned for invalid request bodies.
#[derive(Debug, Serialize)]
pub struct ValidationErrorResponse {
    pub error: u16,
    pub message: String,
    pub fields: Vec<FieldError>,
}

#[derive(Debug, Serialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

/// Validate CreateBenchmarkItemBody against the shared schema rules.
pub fn validate_body(body: &CreateBenchmarkItemBody) -> Result<(), Vec<FieldError>> {
    let mut errors = Vec::new();

    if body.title.is_empty() || body.title.len() > 255 {
        errors.push(FieldError {
            field: "title".into(),
            message: "title must be between 1 and 255 characters".into(),
        });
    }

    if !matches!(body.status.as_str(), "active" | "archived" | "draft") {
        errors.push(FieldError {
            field: "status".into(),
            message: "status must be one of: active, archived, draft".into(),
        });
    }

    if body.priority < 1 || body.priority > 10 {
        errors.push(FieldError {
            field: "priority".into(),
            message: "priority must be between 1 and 10".into(),
        });
    }

    if body.tags.len() > 10 {
        errors.push(FieldError {
            field: "tags".into(),
            message: "tags must have at most 10 items".into(),
        });
    }

    if body.author.name.is_empty() || body.author.name.len() > 100 {
        errors.push(FieldError {
            field: "author.name".into(),
            message: "author.name must be between 1 and 100 characters".into(),
        });
    }

    if !body.author.email.contains('@') {
        errors.push(FieldError {
            field: "author.email".into(),
            message: "author.email must be a valid email address".into(),
        });
    }

    if let Some(ref desc) = body.description {
        if desc.len() > 2000 {
            errors.push(FieldError {
                field: "description".into(),
                message: "description must be at most 2000 characters".into(),
            });
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Startup response shape.
#[derive(Debug, Serialize)]
pub struct StartupResponse {
    pub uptime: f64,
}
