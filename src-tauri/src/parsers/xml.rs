//! XML parsing functions for JUnit test results

use serde::{Deserialize, Serialize};

// ============ Test Result Types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub name: String,
    pub classname: String,
    pub time_seconds: f64,
    pub status: String, // "passed", "failed", "skipped"
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSuiteResult {
    pub name: String,
    pub tests: u32,
    pub failures: u32,
    pub errors: u32,
    pub skipped: u32,
    pub time_seconds: f64,
    pub test_cases: Vec<TestResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextestResults {
    pub suites: Vec<TestSuiteResult>,
    pub total_tests: u32,
    pub total_passed: u32,
    pub total_failed: u32,
    pub total_skipped: u32,
    pub total_time_seconds: f64,
}

/// Parse JUnit XML content into structured test results
pub fn parse_junit_xml(content: &str) -> Result<NextestResults, String> {
    let mut suites = Vec::new();
    let mut total_tests = 0u32;
    let mut total_passed = 0u32;
    let mut total_failed = 0u32;
    let mut total_skipped = 0u32;
    let mut total_time = 0.0f64;

    let lines: Vec<&str> = content.lines().collect();
    let mut current_suite: Option<TestSuiteResult> = None;

    for line in &lines {
        let trimmed = line.trim();

        // Parse testsuite element
        if trimmed.starts_with("<testsuite ") {
            let name = extract_xml_attr(trimmed, "name").unwrap_or_default();
            let tests = extract_xml_attr(trimmed, "tests")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let failures = extract_xml_attr(trimmed, "failures")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let errors = extract_xml_attr(trimmed, "errors")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let skipped = extract_xml_attr(trimmed, "skipped")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let time_seconds = extract_xml_attr(trimmed, "time")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);

            current_suite = Some(TestSuiteResult {
                name,
                tests,
                failures,
                errors,
                skipped,
                time_seconds,
                test_cases: Vec::new(),
            });
        }

        // Parse testcase element
        if trimmed.starts_with("<testcase ") {
            if let Some(ref mut suite) = current_suite {
                let name = extract_xml_attr(trimmed, "name").unwrap_or_default();
                let classname = extract_xml_attr(trimmed, "classname").unwrap_or_default();
                let time_seconds = extract_xml_attr(trimmed, "time")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);

                // Status will be updated if we find failure/skipped elements
                let status = "passed".to_string();

                suite.test_cases.push(TestResult {
                    name,
                    classname,
                    time_seconds,
                    status,
                    failure_message: None,
                });
            }
        }

        // Parse failure element
        if trimmed.starts_with("<failure") {
            if let Some(ref mut suite) = current_suite {
                if let Some(test_case) = suite.test_cases.last_mut() {
                    test_case.status = "failed".to_string();
                    test_case.failure_message = extract_xml_attr(trimmed, "message");
                }
            }
        }

        // Parse skipped element
        if trimmed.starts_with("<skipped") {
            if let Some(ref mut suite) = current_suite {
                if let Some(test_case) = suite.test_cases.last_mut() {
                    test_case.status = "skipped".to_string();
                }
            }
        }

        // End of testsuite
        if trimmed == "</testsuite>" {
            if let Some(suite) = current_suite.take() {
                total_tests += suite.tests;
                total_failed += suite.failures + suite.errors;
                total_skipped += suite.skipped;
                total_passed += suite
                    .tests
                    .saturating_sub(suite.failures + suite.errors + suite.skipped);
                total_time += suite.time_seconds;
                suites.push(suite);
            }
        }
    }

    Ok(NextestResults {
        suites,
        total_tests,
        total_passed,
        total_failed,
        total_skipped,
        total_time_seconds: total_time,
    })
}

/// Extract an attribute value from an XML element line
pub fn extract_xml_attr(line: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = line.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = line[value_start..].find('"') {
            let raw_value = &line[value_start..value_start + end];
            return Some(decode_xml_entities(raw_value));
        }
    }
    None
}

/// Decode XML entities in a string
pub fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ XML Entity Decoding Tests ============

    #[test]
    fn test_decode_xml_entities_all_entities() {
        let input = "&amp; &lt; &gt; &quot; &apos;";
        assert_eq!(decode_xml_entities(input), "& < > \" '");
    }

    #[test]
    fn test_decode_xml_entities_no_entities() {
        let input = "plain text";
        assert_eq!(decode_xml_entities(input), "plain text");
    }

    #[test]
    fn test_decode_xml_entities_mixed() {
        let input = "Hello &amp; World";
        assert_eq!(decode_xml_entities(input), "Hello & World");
    }

    #[test]
    fn test_decode_xml_entities_multiple_same() {
        let input = "&amp;&amp;&amp;";
        assert_eq!(decode_xml_entities(input), "&&&");
    }

    // ============ XML Attribute Extraction Tests ============

    #[test]
    fn test_extract_xml_attr_basic() {
        let line = r#"<testcase name="test_foo" classname="my_crate" time="0.001">"#;
        assert_eq!(extract_xml_attr(line, "name"), Some("test_foo".to_string()));
        assert_eq!(
            extract_xml_attr(line, "classname"),
            Some("my_crate".to_string())
        );
        assert_eq!(extract_xml_attr(line, "time"), Some("0.001".to_string()));
    }

    #[test]
    fn test_extract_xml_attr_decodes_entities() {
        let line = r#"<failure message="assertion &apos;x == y&apos; failed">"#;
        assert_eq!(
            extract_xml_attr(line, "message"),
            Some("assertion 'x == y' failed".to_string())
        );
    }

    #[test]
    fn test_extract_xml_attr_empty_value() {
        let line = r#"<testcase name="" time="0.001">"#;
        assert_eq!(extract_xml_attr(line, "name"), Some("".to_string()));
    }

    #[test]
    fn test_extract_xml_attr_missing() {
        let line = r#"<testcase name="test_foo">"#;
        assert!(extract_xml_attr(line, "missing").is_none());
    }

    // ============ JUnit XML Parsing Tests ============

    #[test]
    fn test_parse_junit_xml_empty() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>"#;
        let result = parse_junit_xml(xml).unwrap();
        assert!(result.suites.is_empty());
        assert_eq!(result.total_tests, 0);
    }

    #[test]
    fn test_parse_junit_xml_passing_tests() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="my_crate" tests="2" failures="0" errors="0" skipped="0" time="0.01">
    <testcase name="test_one" classname="my_crate" time="0.005"/>
    <testcase name="test_two" classname="my_crate" time="0.005"/>
</testsuite>"#;
        let result = parse_junit_xml(xml).unwrap();
        assert_eq!(result.suites.len(), 1);
        assert_eq!(result.total_tests, 2);
        assert_eq!(result.total_passed, 2);
        assert_eq!(result.total_failed, 0);
    }

    #[test]
    fn test_parse_junit_xml_with_failures() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="my_crate" tests="2" failures="1" errors="0" skipped="0" time="0.01">
    <testcase name="test_pass" classname="my_crate" time="0.005"/>
    <testcase name="test_fail" classname="my_crate" time="0.005">
        <failure message="assertion failed"/>
    </testcase>
</testsuite>"#;
        let result = parse_junit_xml(xml).unwrap();
        assert_eq!(result.suites.len(), 1);
        assert_eq!(result.total_tests, 2);
        assert_eq!(result.total_passed, 1);
        assert_eq!(result.total_failed, 1);

        let failed_test = &result.suites[0].test_cases[1];
        assert_eq!(failed_test.name, "test_fail");
        assert_eq!(failed_test.status, "failed");
        assert_eq!(
            failed_test.failure_message,
            Some("assertion failed".to_string())
        );
    }

    #[test]
    fn test_parse_junit_xml_with_skipped() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="my_crate" tests="2" failures="0" errors="0" skipped="1" time="0.01">
    <testcase name="test_pass" classname="my_crate" time="0.005"/>
    <testcase name="test_skip" classname="my_crate" time="0.0">
        <skipped/>
    </testcase>
</testsuite>"#;
        let result = parse_junit_xml(xml).unwrap();
        assert_eq!(result.total_tests, 2);
        assert_eq!(result.total_passed, 1);
        assert_eq!(result.total_skipped, 1);

        let skipped_test = &result.suites[0].test_cases[1];
        assert_eq!(skipped_test.status, "skipped");
    }
}
