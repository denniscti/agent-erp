use reqwest::Client;
use serde::{Deserialize, Serialize};

pub const DEFAULT_NVIDIA_BASE_URL: &str = "https://integrate.api.nvidia.com";

/// 模型選型記錄：
/// - `meta/llama-3.1-8b-instruct`: NVIDIA Hosted 已下架 (410 Gone)。
/// - `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4`: 推理旗艦模型，延遲與成本過高，且會輸出思考過程，留待 M3。
/// - `nvidia/nemotron-3-embed-1b`: Embedding 向量模型，不適用於 Chat Completion 抽取任務。
/// - `z-ai/glm-5.3-flash` (目前採用): 中英文理解精確、格式穩定、支援 OpenAI tools function calling 協議、低延遲，為首選。
pub const DEFAULT_MODEL: &str = "z-ai/glm-5.3-flash";
pub const SYSTEM_PROMPT: &str = "你是一個組織架構助理。請根據使用者的意圖選擇合適的工具進行呼叫。如果使用者的意圖不符合任何工具，請直接回覆文字，不要呼叫任何工具。";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "tool")]
pub enum DepartmentToolCall {
    #[serde(rename = "create_department")]
    CreateDepartment { name: String },
    #[serde(rename = "list_departments")]
    ListDepartments,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ToolDefinition {
    pub r#type: String,
    pub function: FunctionDefinition,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
    temperature: f64,
    max_tokens: u32,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ChatCompletionResponse {
    pub choices: Vec<ChatChoice>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ChatChoice {
    pub message: ChatMessageResponse,
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct ChatMessageResponse {
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCallResponse>>,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ToolCallResponse {
    pub id: Option<String>,
    pub r#type: Option<String>,
    pub function: FunctionCallResponse,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FunctionCallResponse {
    pub name: String,
    pub arguments: String,
}

pub fn get_department_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            r#type: "function".to_string(),
            function: FunctionDefinition {
                name: "create_department".to_string(),
                description: "建立或新增一個組織部門".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "欲建立的部門名稱，例如：行銷部、研發部、IT專責小組"
                        }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            r#type: "function".to_string(),
            function: FunctionDefinition {
                name: "list_departments".to_string(),
                description: "列出或查詢目前系統中已建立的所有部門列表".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
    ]
}

pub trait NimClient: Send + Sync {
    fn chat_completion(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        tools: Option<Vec<ToolDefinition>>,
    ) -> impl std::future::Future<Output = Result<ChatMessageResponse, String>> + Send;
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
        tools: Option<Vec<ToolDefinition>>,
    ) -> Result<ChatMessageResponse, String> {
        let endpoint = format!(
            "{}/v1/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        let tool_choice = if tools.is_some() {
            Some("auto".to_string())
        } else {
            None
        };
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
            tools,
            tool_choice,
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

        let msg = completion
            .choices
            .into_iter()
            .next()
            .map(|c| c.message)
            .unwrap_or_default();

        Ok(msg)
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

#[derive(Deserialize)]
struct CreateDepartmentArgs {
    #[serde(default)]
    name: Option<String>,
}

pub fn parse_department_tool_call(resp: &ChatMessageResponse) -> Option<DepartmentToolCall> {
    let tool_calls = resp.tool_calls.as_ref()?;
    let first_call = tool_calls.first()?;

    match first_call.function.name.as_str() {
        "create_department" => {
            let args: CreateDepartmentArgs =
                serde_json::from_str(&first_call.function.arguments).ok()?;
            let name = args.name?.trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some(DepartmentToolCall::CreateDepartment { name })
            }
        }
        "list_departments" => Some(DepartmentToolCall::ListDepartments),
        _ => None,
    }
}

pub async fn execute_detect_department_intent<C: NimClient>(
    client: &C,
    api_key: Option<&str>,
    user_message: &str,
) -> Result<Option<DepartmentToolCall>, String> {
    let key = match api_key {
        Some(k) if !k.trim().is_empty() => k.trim(),
        _ => return Ok(None),
    };

    let trimmed_msg = user_message.trim();
    if trimmed_msg.is_empty() {
        return Ok(None);
    }

    let tools = Some(get_department_tools());
    let raw_response = client
        .chat_completion(key, SYSTEM_PROMPT, trimmed_msg, tools)
        .await?;

    Ok(parse_department_tool_call(&raw_response))
}

#[tauri::command]
#[specta::specta]
pub async fn detect_department_intent<R: tauri::Runtime>(
    _app_handle: tauri::AppHandle<R>,
    user_message: String,
) -> Result<Option<DepartmentToolCall>, String> {
    let api_key = get_nvidia_api_key();
    let client = ReqwestNimClient::default();
    execute_detect_department_intent(&client, api_key.as_deref(), &user_message).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub struct MockNimClient {
        pub response: Result<ChatMessageResponse, String>,
    }

    impl NimClient for MockNimClient {
        async fn chat_completion(
            &self,
            _api_key: &str,
            _system_prompt: &str,
            _user_message: &str,
            _tools: Option<Vec<ToolDefinition>>,
        ) -> Result<ChatMessageResponse, String> {
            self.response.clone()
        }
    }

    #[tokio::test]
    async fn test_tc_llm_01_detect_create_department_success() {
        // Given: A valid NVIDIA API key and a mock client returning create_department tool call
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: Some("好的，為您建立行銷部".to_string()),
                tool_calls: Some(vec![ToolCallResponse {
                    id: Some("call-1".to_string()),
                    r#type: Some("function".to_string()),
                    function: FunctionCallResponse {
                        name: "create_department".to_string(),
                        arguments: "{\"name\":\"行銷部\"}".to_string(),
                    },
                }]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "我想建立一個行銷部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Successfully returns Some(CreateDepartment { name: "行銷部" })
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(DepartmentToolCall::CreateDepartment {
                name: "行銷部".to_string()
            })
        );
    }

    #[tokio::test]
    async fn test_tc_llm_02_detect_create_department_trims_whitespace_and_newlines() {
        // Given: A mock client returning department name surrounded by whitespaces and newlines
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: None,
                tool_calls: Some(vec![ToolCallResponse {
                    id: Some("call-2".to_string()),
                    r#type: Some("function".to_string()),
                    function: FunctionCallResponse {
                        name: "create_department".to_string(),
                        arguments: "{\"name\":\"  \\n  研發部 \\t \\n\"}".to_string(),
                    },
                }]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "請幫我設立研發部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns trimmed department name Some(CreateDepartment { name: "研發部" })
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(DepartmentToolCall::CreateDepartment {
                name: "研發部".to_string()
            })
        );
    }

    #[tokio::test]
    async fn test_tc_llm_03_detect_list_departments_success() {
        // Given: A mock client returning list_departments tool call
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: None,
                tool_calls: Some(vec![ToolCallResponse {
                    id: Some("call-3".to_string()),
                    r#type: Some("function".to_string()),
                    function: FunctionCallResponse {
                        name: "list_departments".to_string(),
                        arguments: "{}".to_string(),
                    },
                }]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "目前有哪些部門？列給我看";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Successfully returns Some(ListDepartments)
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some(DepartmentToolCall::ListDepartments));
    }

    #[tokio::test]
    async fn test_tc_llm_04_no_tool_calls_returns_none() {
        // Given: A mock client returning only text content without tool_calls
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: Some("抱歉，我無法提供天氣資訊。".to_string()),
                tool_calls: None,
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "今天台北天氣如何？";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns Ok(None)
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_05_empty_tool_calls_vector_returns_none() {
        // Given: A mock client returning empty tool_calls vector
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: Some("無符合動作".to_string()),
                tool_calls: Some(vec![]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "幫我買杯咖啡";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns Ok(None)
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_06_create_department_empty_or_missing_name_returns_none() {
        // Given: Tool call with empty name or missing property
        let empty_args_list = vec!["{}", "{\"name\":\"\"}", "{\"name\":\"   \"}"];

        for args in empty_args_list {
            let mock_client = MockNimClient {
                response: Ok(ChatMessageResponse {
                    content: None,
                    tool_calls: Some(vec![ToolCallResponse {
                        id: Some("call-empty".to_string()),
                        r#type: Some("function".to_string()),
                        function: FunctionCallResponse {
                            name: "create_department".to_string(),
                            arguments: args.to_string(),
                        },
                    }]),
                }),
            };
            let api_key = Some("nvapi-valid-test-key");
            let user_msg = "新增部門";

            // When: execute_detect_department_intent is executed
            let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

            // Then: Returns Ok(None)
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), None, "Failed for args: {}", args);
        }
    }

    #[tokio::test]
    async fn test_tc_llm_07_create_department_malformed_json_arguments_returns_none() {
        // Given: Tool call with malformed JSON arguments
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: None,
                tool_calls: Some(vec![ToolCallResponse {
                    id: Some("call-malformed".to_string()),
                    r#type: Some("function".to_string()),
                    function: FunctionCallResponse {
                        name: "create_department".to_string(),
                        arguments: "{ malformed json".to_string(),
                    },
                }]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "建立財務部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns Ok(None) safely without crashing
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_08_unknown_tool_name_returns_none() {
        // Given: Tool call with an unrecognized function name
        let mock_client = MockNimClient {
            response: Ok(ChatMessageResponse {
                content: None,
                tool_calls: Some(vec![ToolCallResponse {
                    id: Some("call-unknown".to_string()),
                    r#type: Some("function".to_string()),
                    function: FunctionCallResponse {
                        name: "delete_department".to_string(),
                        arguments: "{\"name\":\"行銷部\"}".to_string(),
                    },
                }]),
            }),
        };
        let api_key = Some("nvapi-valid-test-key");
        let user_msg = "刪除行銷部";

        // When: execute_detect_department_intent is executed
        let result = execute_detect_department_intent(&mock_client, api_key, user_msg).await;

        // Then: Returns Ok(None)
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_09_and_10_api_key_none_or_blank_short_circuits() {
        // Given: A mock client that would return an error if called
        let mock_client = MockNimClient {
            response: Err("Should not be called".to_string()),
        };

        // When: api_key is None (TC-LLM-09)
        let result_none =
            execute_detect_department_intent(&mock_client, None, "我想新增技術部").await;

        // Then: Short-circuits and returns Ok(None) without error
        assert!(result_none.is_ok());
        assert_eq!(result_none.unwrap(), None);

        // When: api_key is blank (TC-LLM-10)
        let result_blank =
            execute_detect_department_intent(&mock_client, Some("   "), "我想新增技術部").await;

        // Then: Short-circuits and returns Ok(None) without error
        assert!(result_blank.is_ok());
        assert_eq!(result_blank.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_11_and_12_user_message_empty_or_whitespace_short_circuits() {
        // Given: A mock client that would return an error if called
        let mock_client = MockNimClient {
            response: Err("Should not be called".to_string()),
        };
        let api_key = Some("nvapi-valid-test-key");

        // When: user_message is empty (TC-LLM-11)
        let res_empty = execute_detect_department_intent(&mock_client, api_key, "").await;

        // Then: Short-circuits and returns Ok(None)
        assert!(res_empty.is_ok());
        assert_eq!(res_empty.unwrap(), None);

        // When: user_message is whitespace only (TC-LLM-12)
        let res_space = execute_detect_department_intent(&mock_client, api_key, "   \n\t ").await;

        // Then: Short-circuits and returns Ok(None)
        assert!(res_space.is_ok());
        assert_eq!(res_space.unwrap(), None);
    }

    #[tokio::test]
    async fn test_tc_llm_13_client_http_401_error_propagation() {
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
    async fn test_tc_llm_14_client_http_500_error_propagation() {
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
    fn test_tc_llm_15_parse_nvidia_api_key_equivalence_and_boundaries() {
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
