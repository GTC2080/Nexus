//! AI 模块
//!
//! 负责调用云端 Embedding / Chat API。
//! 所有函数通过 AiConfig 参数接收配置，不再依赖环境变量。

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use futures_util::StreamExt;

/// AI 配置，由前端 Store 传入
#[derive(Debug, Clone)]
pub struct AiConfig {
    pub api_key: String,
    pub base_url: String,
    pub embedding_api_key: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub chat_model: String,
}

// ===== Embedding =====

#[derive(Serialize)]
struct EmbeddingRequest {
    model: String,
    input: String,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

const MAX_TEXT_CHARS: usize = 2000;
const REQUEST_TIMEOUT_SECS: u64 = 30;

pub async fn fetch_embedding(text: &str, config: &AiConfig) -> Result<Vec<f32>, String> {
    let effective_key = if config.embedding_api_key.is_empty() { &config.api_key } else { &config.embedding_api_key };
    if effective_key.is_empty() {
        return Err("未配置 AI API Key，请在设置中填写".to_string());
    }

    let truncated: String = text.chars().take(MAX_TEXT_CHARS).collect();
    if truncated.trim().is_empty() {
        return Err("文本内容为空，跳过向量化".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let url = format!("{}/embeddings", if config.embedding_base_url.is_empty() { &config.base_url } else { &config.embedding_base_url });

    let request_body = EmbeddingRequest {
        model: config.embedding_model.clone(),
        input: truncated,
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", effective_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Embedding API 请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Embedding API 返回错误 (HTTP {}): {}", status, body));
    }

    let result: EmbeddingResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 Embedding API 响应失败: {}", e))?;

    result
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| "Embedding API 返回了空的 data 数组".to_string())
}

// ===== Cosine Similarity =====

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    if len == 0 {
        return 0.0;
    }
    let mut dot: f32 = 0.0;
    let mut na: f32 = 0.0;
    let mut nb: f32 = 0.0;
    for i in 0..len {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

// ===== Chat Streaming =====

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Serialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatChunkResponse {
    choices: Vec<ChatChunkChoice>,
}

#[derive(Deserialize)]
struct ChatChunkChoice {
    delta: ChatChunkDelta,
}

#[derive(Deserialize)]
struct ChatChunkDelta {
    content: Option<String>,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    temperature: f32,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Deserialize)]
struct ChatCompletionMessage {
    content: String,
}

const CHAT_TIMEOUT_SECS: u64 = 120;
const CONTEXT_PER_NOTE_CHARS: usize = 1500;
const PONDER_TIMEOUT_SECS: u64 = 60;

const RAG_SYSTEM_PROMPT: &str = "你是一个私人知识库的极客助手。请严格基于以下提供的上下文回答用户问题。\
如果上下文中没有答案，请诚实地说明。请在引用相关内容时，在句末使用 [[笔记名称]] 的格式标注出处。";

pub fn build_rag_context(notes: &[(String, String)]) -> String {
    let mut context = String::new();
    for (i, (name, content)) in notes.iter().enumerate() {
        let truncated: String = content.chars().take(CONTEXT_PER_NOTE_CHARS).collect();
        context.push_str(&format!("--- 笔记 {} 《{}》 ---\n{}\n\n", i + 1, name, truncated));
    }
    context
}

pub async fn stream_chat_with_context<F>(
    question: &str,
    context: &str,
    config: &AiConfig,
    mut on_chunk: F,
) -> Result<(), String>
where
    F: FnMut(String) -> Result<(), String>,
{
    if config.api_key.is_empty() {
        return Err("未配置 AI API Key，请在设置中填写".to_string());
    }

    let system_content = format!("{}\n\n以下是相关笔记上下文：\n\n{}", RAG_SYSTEM_PROMPT, context);

    let messages = vec![
        ChatMessage { role: "system".to_string(), content: system_content },
        ChatMessage { role: "user".to_string(), content: question.to_string() },
    ];

    let request_body = ChatRequest {
        model: config.chat_model.clone(),
        messages,
        stream: true,
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(CHAT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let url = format!("{}/chat/completions", config.base_url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Chat API 请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Chat API 返回错误 (HTTP {}): {}", status, body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取流数据失败: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(pos) = buffer.find("\n\n") {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            for sub_line in line.split('\n') {
                let sub_line = sub_line.trim();
                if sub_line.is_empty() { continue; }

                if let Some(data) = sub_line.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" { return Ok(()); }

                    if let Ok(parsed) = serde_json::from_str::<ChatChunkResponse>(data) {
                        if let Some(choice) = parsed.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                if !content.is_empty() {
                                    on_chunk(content.clone())?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

pub async fn ponder_node(topic: &str, context: &str, config: &AiConfig) -> Result<String, String> {
    if config.api_key.is_empty() {
        return Err("未配置 AI API Key，请在设置中填写".to_string());
    }

    let system_prompt = "你是一个逻辑发散引擎。你的任务是围绕核心概念生成可拓展知识图谱的子节点。\
你必须输出严格 JSON 数组，且数组元素结构固定为 {\"title\":\"...\",\"relation\":\"...\"}。\
禁止输出 Markdown、代码块、解释性文本、前后缀。";
    let user_prompt = format!(
        "核心概念: {}\n上下文: {}\n请生成 3 到 5 个具备逻辑递进或补充关系的子节点。",
        topic, context
    );

    let request_body = ChatCompletionRequest {
        model: config.chat_model.clone(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
        stream: false,
        temperature: 0.7,
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(PONDER_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let url = format!("{}/chat/completions", config.base_url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Ponder API 请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ponder API 返回错误 (HTTP {}): {}", status, body));
    }

    let result: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 Ponder API 响应失败: {}", e))?;

    result
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Ponder API 返回空内容".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_identical() {
        let v = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_orthogonal() {
        assert!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_zero() {
        assert_eq!(cosine_similarity(&[1.0, 2.0], &[0.0, 0.0]), 0.0);
    }

    #[test]
    fn test_cosine_empty() {
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
    }
}
