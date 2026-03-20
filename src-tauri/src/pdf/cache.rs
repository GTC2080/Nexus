//! 渲染缓存模块
//!
//! `RenderCache` 将已渲染的 WebP 页面保存到磁盘，并在总大小超出上限时
//! 按文件修改时间（最旧优先）执行简单淘汰策略。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::AppResult;

/// 默认缓存上限：200 MB
const DEFAULT_MAX_BYTES: u64 = 200 * 1024 * 1024;

/// 磁盘渲染缓存
pub struct RenderCache {
    /// 缓存大小上限（字节）
    max_bytes: u64,
    /// 内存中记录的 key → (path, size, width, height) 映射
    entries: HashMap<String, CacheEntry>,
    /// 当前缓存总字节数
    total_bytes: u64,
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    /// 渲染后的像素尺寸（缓存命中时直接返回，无需读 .meta 文件）
    width: u32,
    height: u32,
}

impl RenderCache {
    /// 创建缓存实例，从 `dir` 目录恢复已有文件的统计信息。
    pub fn new(dir: &Path, max_bytes: u64) -> AppResult<Self> {
        std::fs::create_dir_all(dir)?;

        let mut entries: HashMap<String, CacheEntry> = HashMap::new();
        let mut total_bytes: u64 = 0;

        // 扫描缓存目录，重建内存索引
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("webp") {
                    if let Ok(meta) = std::fs::metadata(&path) {
                        let size = meta.len();
                        let key = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string();
                        // 尝试从 .meta 文件恢复尺寸
                        let (width, height) = path
                            .with_extension("meta")
                            .to_str()
                            .and_then(|p| std::fs::read_to_string(p).ok())
                            .and_then(|s| {
                                let mut parts = s.trim().splitn(2, ',');
                                let w: u32 = parts.next()?.parse().ok()?;
                                let h: u32 = parts.next()?.parse().ok()?;
                                Some((w, h))
                            })
                            .unwrap_or((0, 0));
                        total_bytes += size;
                        entries.insert(key, CacheEntry { path, size, width, height });
                    }
                }
            }
        }

        Ok(Self {
            max_bytes,
            entries,
            total_bytes,
        })
    }

    /// 默认配置（200 MB 上限）
    pub fn with_default_limit(dir: &Path) -> AppResult<Self> {
        Self::new(dir, DEFAULT_MAX_BYTES)
    }

    // -----------------------------------------------------------------------
    // 查询
    // -----------------------------------------------------------------------

    /// 返回缓存条目的文件路径（不校验文件是否真实存在）
    pub fn get(&self, key: &str) -> Option<PathBuf> {
        self.entries.get(key).map(|e| e.path.clone())
    }

    /// 返回缓存条目的文件路径和尺寸（内存直接返回，无 I/O）
    pub fn get_with_dimensions(&self, key: &str) -> Option<(PathBuf, u32, u32)> {
        self.entries.get(key).map(|e| (e.path.clone(), e.width, e.height))
    }

    // -----------------------------------------------------------------------
    // 写入
    // -----------------------------------------------------------------------

    /// 将已写入磁盘的缓存文件登记到内存索引中（不含像素尺寸）。
    #[allow(dead_code)]
    pub fn track_existing(&mut self, key: &str, path: PathBuf) -> AppResult<PathBuf> {
        let size = std::fs::metadata(&path)?.len();
        self.register_entry(key, path.clone(), size, 0, 0);
        Ok(path)
    }

    /// 将已写入磁盘的缓存文件登记到内存索引中，附带像素尺寸。
    pub fn track_with_dimensions(&mut self, key: &str, path: PathBuf, width: u32, height: u32) -> AppResult<PathBuf> {
        let size = std::fs::metadata(&path)?.len();
        self.register_entry(key, path.clone(), size, width, height);
        Ok(path)
    }

    fn register_entry(&mut self, key: &str, path: PathBuf, size: u64, width: u32, height: u32) {
        if let Some(old) = self.entries.get(key) {
            self.total_bytes = self.total_bytes.saturating_sub(old.size);
        }

        self.entries.insert(key.to_string(), CacheEntry { path, size, width, height });
        self.total_bytes += size;

        // 淘汰超出限制的旧条目
        if self.total_bytes > self.max_bytes {
            self.evict();
        }
    }

    // -----------------------------------------------------------------------
    // 清理
    // -----------------------------------------------------------------------

    /// 移除指定文档 ID 的所有缓存条目（文件名以 `{doc_id}-` 开头）
    pub fn remove_doc(&mut self, doc_id: &str) {
        let prefix = format!("{doc_id}-");
        let keys_to_remove: Vec<String> = self
            .entries
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();

        for key in keys_to_remove {
            if let Some(entry) = self.entries.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(entry.size);
                let _ = std::fs::remove_file(&entry.path);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 内部：淘汰策略
    // -----------------------------------------------------------------------

    /// 按文件修改时间（最旧优先）删除条目，直至总大小不超过上限。
    fn evict(&mut self) {
        // 收集 (modified_time, key) 排序后依次删除
        let mut candidates: Vec<(std::time::SystemTime, String)> = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                std::fs::metadata(&entry.path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| (t, key.clone()))
            })
            .collect();

        candidates.sort_unstable_by_key(|(t, _)| *t);

        for (_, key) in candidates {
            if self.total_bytes <= self.max_bytes {
                break;
            }
            if let Some(entry) = self.entries.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(entry.size);
                let _ = std::fs::remove_file(&entry.path);
            }
        }
    }
}
