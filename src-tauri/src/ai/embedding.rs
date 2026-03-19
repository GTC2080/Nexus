//! Embedding 请求、缓存与并发控制

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;

use super::AiConfig;

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
const EMBEDDING_CACHE_LIMIT: usize = 64;
const EMBEDDING_CONCURRENCY_LIMIT: usize = 4;

#[derive(Default)]
struct EmbeddingCache {
    order: VecDeque<String>,
    entries: HashMap<String, Vec<f32>>,
}

#[derive(Clone)]
pub struct EmbeddingRuntimeState {
    semaphore: Arc<Semaphore>,
    cache: Arc<Mutex<EmbeddingCache>>,
}

impl Default for EmbeddingRuntimeState {
    fn default() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(EMBEDDING_CONCURRENCY_LIMIT)),
            cache: Arc::new(Mutex::new(EmbeddingCache::default())),
        }
    }
}

fn normalize_embedding_text(text: &str) -> Result<String, String> {
    let truncated: String = text.chars().take(MAX_TEXT_CHARS).collect();
    if truncated.trim().is_empty() {
        return Err("文本内容为空，跳过向量化".to_string());
    }
    Ok(truncated)
}

fn embedding_cache_key(text: &str, config: &AiConfig) -> String {
    let base_url = if config.embedding_base_url.is_empty() {
        &config.base_url
    } else {
        &config.embedding_base_url
    };
    format!("{}|{}|{}", base_url, config.embedding_model, text)
}

fn get_cached_embedding(runtime: &EmbeddingRuntimeState, key: &str) -> Result<Option<Vec<f32>>, String> {
    let cache = runtime
        .cache
        .lock()
        .map_err(|e| format!("获取 embedding 缓存锁失败: {}", e))?;
    Ok(cache.entries.get(key).cloned())
}

fn cache_embedding(runtime: &EmbeddingRuntimeState, key: String, embedding: Vec<f32>) -> Result<(), String> {
    let mut cache = runtime
        .cache
        .lock()
        .map_err(|e| format!("获取 embedding 缓存锁失败: {}", e))?;

    if cache.entries.contains_key(&key) {
        cache.order.retain(|existing| existing != &key);
    }

    cache.order.push_back(key.clone());
    cache.entries.insert(key, embedding);

    while cache.order.len() > EMBEDDING_CACHE_LIMIT {
        if let Some(oldest) = cache.order.pop_front() {
            cache.entries.remove(&oldest);
        }
    }

    Ok(())
}

pub async fn fetch_embedding(text: &str, config: &AiConfig) -> Result<Vec<f32>, String> {
    let effective_key = if config.embedding_api_key.is_empty() { &config.api_key } else { &config.embedding_api_key };
    if effective_key.is_empty() {
        return Err("未配置 AI API Key，请在设置中填写".to_string());
    }

    let truncated = normalize_embedding_text(text)?;

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

pub async fn fetch_embedding_cached(
    text: &str,
    config: &AiConfig,
    runtime: &EmbeddingRuntimeState,
) -> Result<Vec<f32>, String> {
    let normalized = normalize_embedding_text(text)?;
    let cache_key = embedding_cache_key(&normalized, config);

    if let Some(cached) = get_cached_embedding(runtime, &cache_key)? {
        return Ok(cached);
    }

    let _permit = runtime
        .semaphore
        .acquire()
        .await
        .map_err(|e| format!("获取 embedding 并发许可失败: {}", e))?;

    if let Some(cached) = get_cached_embedding(runtime, &cache_key)? {
        return Ok(cached);
    }

    let embedding = fetch_embedding(&normalized, config).await?;
    cache_embedding(runtime, cache_key, embedding.clone())?;
    Ok(embedding)
}
