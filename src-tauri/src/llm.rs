use reqwest::Client;
use serde::{Deserialize, Serialize};

pub const DEFAULT_NVIDIA_BASE_URL: &str = "https://integrate.api.nvidia.com";

/// 模型選型記錄：
/// - `meta/llama-3.1-8b-instruct`: NVIDIA Hosted 已下架 (410 Gone)。
/// - `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4`: 推理旗艦模型，延遲與成本過高，且會輸出思考過程，留待 M3。
/// - `nvidia/nemotron-3-embed-1b`: Embedding 向量模型，不適用於 Chat Completion 抽取任務。
/// - `z-ai/glm-5.3-flash` (目前採用): 中英文理解精確、格式穩定（無推理過程洩漏）、低延遲，為 Pilot 最佳首選。
pub const DEFAULT_MODEL: &str = "z-ai/glm-5.3-flash";
pub const SYSTEM_PROMPT: &str = "你的任務是判斷使用者輸入中是否包含想建立的部門名稱。如果有，只回覆部門名稱本身（例如：行銷部），不要加任何其他文字。如果沒有明確的部門建立意圖，只回覆 NONE。";

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

pub trait NimClient: Send + Sync {
    fn chat_completion(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
    ) -> impl std::future::Future<Output = Result<String, String>> + Send;
}

#[derive(Debug, Clone)]
pub struct ReqwestNimClient {
    client: Client,
    base_url: String,
    model: String,
}

impl Default for ReqwestNimClient {
    fn default() -> Self {
        Self {
            client: Client::new(),
            base_url: DEFAULT_NVIDIA_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
        }
    }
}

impl ReqwestNimClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.into(),
            model: model.into(),
        }
    }
}

impl NimClient for ReqwestNimClient {
    async fn chat_completion(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
    ) -> Result<String, String> {
        let endpoint = format!(
            "{}/v1/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        let req_body = ChatCompletionRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_message.to_string(),
                },
            ],
            temperature: 0.0,
            max_tokens: 512,
        };

        let resp = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&req_body)
            .send()
            .await
            .map_err(|e| format!("NVIDIA API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "NVIDIA API returned error status {}: {}",
                status, err_body
            ));
        }

        let completion: ChatCompletionResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse NVIDIA API response JSON: {}", e))?;

        let content = completion
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .unwrap_or_default();

        Ok(content)
    }
}

pub fn parse_nvidia_api_key(raw: Option<&str>) -> Option<String> {
    raw.map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .map(|k| k.to_string())
}

#[cfg(test)]
thread_local! {
    pub(crate) static TEST_NVIDIA_API_KEY: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
}

pub fn get_nvidia_api_key() -> Option<String> {
    #[cfg(test)]
    {
        TEST_NVIDIA_API_KEY.with(|key| {
            if let Some(ref k) = *key.borrow() {
                Some(k.clone())
            } else {
                parse_nvidia_api_key(std::env::var("NVIDIA_API_KEY").ok().as_deref())
            }
        })
    }
    #[cfg(not(test))]
    {
        parse_nvidia_api_key(std::env::var("NVIDIA_API_KEY").ok().as_deref())
    }
}

pub fn parse_department_response(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let stripped = trimmed.trim_end_matches('.').trim();
    if stripped.eq_ignore_ascii_case("none") {
        return None;
    }
    Some(trimmed.to_string())
}

pub async fn execute_detect_department_intent<C: NimClient>(
    client: &C,
    api_key: Option<&str>,
    user_message: &str,
) -> Result<Option<String>, String> {
    let key = match api_key {
        Some(k) if !k.trim().is_empty() => k.trim(),
        _ => return Ok(None),
    };

    let trimmed_msg = user_message.trim();
    if trimmed_msg.is_empty() {
        return Ok(None);
    }

    let raw_response = client
        .chat_completion(key, SYSTEM_PROMPT, trimmed_msg)
        .await?;

    Ok(parse_department_response(&raw_response))
}

#[tauri::command]
#[specta::specta]
pub async fn detect_department_intent<R: tauri::Runtime>(
    _app_handle: tauri::AppHandle<R>,
    user_message: String,
) -> Result<Option<String>, String> {
    let api_key = get_nvidia_api_key();
    let client = ReqwestNimClient::default();
    execute_detect_department_intent(&client, api_key.as_deref(), &user_message).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub struct MockNimClient {
        pub response: Result<String, String>,
    }

    impl NimClient for MockNimClient {
        async fn chat_completion(
            &self,
            _api_key: &str,
            _system_prompt: &str,
            _user_message: &str,
        ) -> Result<String, String> {
            self.response.clone()
        }
    }

    #[tokio::test]
    async fn test_tc_llm_01_detect_department_name_success() {
        // Given: A valid NVIDIA API key and a mock client returning "行銷部"
        let mock_client = MockNimClient {
            response: Ok("行銷部".to_string()),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "我想建立一個行銷部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Successfully returns Some("行銷部")
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("行銷部".to_string()));
    }

    #[tokio::test]
    async fn test_tc_llm_02_detect_department_trims_whitespace_and_newlines() {
        // Given: A mock client returning department name surrounded by whitespaces and newlines
        let mock_client = MockNimClient {
            response: Ok("  \n  研發部 \t \n".to_string()),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "請幫我設立研發部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns trimmed department name Some("研發部")
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("研發部".to_string()));
    }

    #[tokio::test]
    async fn test_tc_llm_03_detect_department_uppercase_none_returns_none() {
        // Given: A mock client returning uppercase "NONE"
        let mock_client = MockNimClient {
            response: Ok("NONE".to_string()),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "今天天氣真好";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns Ok(None)
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_04_detect_department_none_case_insensitive_and_trailing_period() {
        // Given: Various forms of NONE (lowercase, mixed case, trailing dot)
        let variations = vec!["none", "None", "nOnE", "NONE.", "none.", "  None.  "];

        for val in variations {
            let mock_client = MockNimClient {
                response: Ok(val.to_string()),
            };
            let api_key = Some("nvapi-valid-test-key");
            let user_msg = "你好，請給我一份報表";

            // When: execute_detect_department_intent is executed
            let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

            // Then: Each variation must return Ok(None)
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), None, "Failed for variation: {}", val);
        }
    }

    #[tokio::test]
    async fn test_tc_llm_05_detect_department_empty_response_returns_none() {
        // Given: A mock client returning empty string or whitespace only
        let empty_variations = vec!["", "   ", "\n\t  "];

        for val in empty_variations {
            let mock_client = MockNimClient {
                response: Ok(val.to_string()),
            };
            let api_key = Some("nvapi-valid-test-key");
            let user_msg = "新增部門";

            // When: execute_detect_department_intent is executed
            let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

            // Then: Must return Ok(None)
            assert!(result.is_ok());
            assert_eq!(
                result.unwrap(),
                None,
                "Failed for empty variation: {:?}",
                val
            );
        }
    }

    #[tokio::test]
    async fn test_tc_llm_06_and_07_api_key_none_or_blank_short_circuits() {
        // Given: A mock client that would return an error if called
        let mock_client = MockNimClient {
            response: Err("Should not be called".to_string()),
        };

        // When: api_key is None (TC-LLM-06)
        let result_none =
            execute_detect_department_intent(&mock_client, None, "我想新增技術部").await;

        // Then: Short-circuits and returns Ok(None) without error
        assert!(result_none.is_ok());
        assert_eq!(result_none.unwrap(), None);

        // When: api_key is blank (TC-LLM-07)
        let result_blank =
            execute_detect_department_intent(&mock_client, Some("   "), "我想新增技術部").await;

        // Then: Short-circuits and returns Ok(None) without error
        assert!(result_blank.is_ok());
        assert_eq!(result_blank.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_08_and_09_user_message_empty_or_whitespace_short_circuits() {
        // Given: A mock client that would return an error if called
        let mock_client = MockNimClient {
            response: Err("Should not be called".to_string()),
        };
        let api_key = Some("nvapi-valid-test-key");

        // When: user_message is empty (TC-LLM-08)
        let res_empty = execute_detect_department_intent(&mock_client, api_key, "").await;

        // Then: Short-circuits and returns Ok(None)
        assert!(res_empty.is_ok());
        assert_eq!(res_empty.unwrap(), None);

        // When: user_message is whitespace only (TC-LLM-09)
        let res_space = execute_detect_department_intent(&mock_client, api_key, "   \n\t ").await;

        // Then: Short-circuits and returns Ok(None)
        assert!(res_space.is_ok());
        assert_eq!(res_space.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_10_client_http_401_error_propagation() {
        // Given: A mock client simulating 401 Unauthorized API error
        let mock_client = MockNimClient {
            response: Err("NVIDIA API returned error status 401: Unauthorized".to_string()),
        };
        let api_key = Some("nvapi-invalid-key");
        let user_msg = "我想建立人資部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns the propagated error message
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "NVIDIA API returned error status 401: Unauthorized"
        );
    }

    #[tokio::test]
    async fn test_tc_llm_11_client_http_500_error_propagation() {
        // Given: A mock client simulating 500 Internal Server Error
        let mock_client = MockNimClient {
            response: Err(
                "NVIDIA API returned error status 500: Internal Server Error".to_string(),
            ),
        };
        let api_key = Some("nvapi-valid-key");
        let user_msg = "我想建立財務部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns the propagated error message
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "NVIDIA API returned error status 500: Internal Server Error"
        );
    }

    #[test]
    fn test_tc_llm_12_parse_nvidia_api_key_equivalence_and_boundaries() {
        // Given: Various input states for raw API key
        let cases = vec![
            (Some("nvapi-12345"), Some("nvapi-12345".to_string())),
            (Some("  nvapi-67890  "), Some("nvapi-67890".to_string())),
            (Some(""), None),
            (Some("   "), None),
            (None, None),
        ];

        for (input, expected) in cases {
            // When: Parsing the raw API key input
            let actual = parse_nvidia_api_key(input);

            // Then: Matches expected parsed option
            assert_eq!(actual, expected, "Failed for input: {:?}", input);
        }
    }
}
