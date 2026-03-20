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
    /// 缓存根目录
    dir: PathBuf,
    /// 缓存大小上限（字节）
    max_bytes: u64,
    /// 内存中记录的 key → (path, size) 映射，避免频繁 readdir
    entries: HashMap<String, (PathBuf, u64)>,
    /// 当前缓存总字节数
    total_bytes: u64,
}

impl RenderCache {
    /// 创建缓存实例，从 `dir` 目录恢复已有文件的统计信息。
    pub fn new(dir: &Path, max_bytes: u64) -> AppResult<Self> {
        std::fs::create_dir_all(dir)?;

        let mut entries: HashMap<String, (PathBuf, u64)> = HashMap::new();
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
                        total_bytes += size;
                        entries.insert(key, (path, size));
                    }
                }
            }
        }

        Ok(Self {
            dir: dir.to_path_buf(),
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
        self.entries.get(key).map(|(p, _)| p.clone())
    }

    // -----------------------------------------------------------------------
    // 写入
    // -----------------------------------------------------------------------

    /// 将 `data` 以 key 对应的文件名写入缓存目录，并在超限时淘汰旧条目。
    pub fn put(&mut self, key: &str, data: &[u8]) -> AppResult<PathBuf> {
        let path = self.dir.join(format!("{key}.webp"));
        std::fs::write(&path, data)?;

        let size = data.len() as u64;

        // 如果 key 已存在，先减去旧大小
        if let Some((_, old_size)) = self.entries.get(key) {
            self.total_bytes = self.total_bytes.saturating_sub(*old_size);
        }

        self.entries.insert(key.to_string(), (path.clone(), size));
        self.total_bytes += size;

        // 淘汰超出限制的旧条目
        if self.total_bytes > self.max_bytes {
            self.evict();
        }

        Ok(path)
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
            if let Some((path, size)) = self.entries.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(size);
                let _ = std::fs::remove_file(&path);
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
            .filter_map(|(key, (path, _))| {
                std::fs::metadata(path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| (t, key.clone()))
            })
            .collect();

        // 最旧的在前面
        candidates.sort_unstable_by_key(|(t, _)| *t);

        for (_, key) in candidates {
            if self.total_bytes <= self.max_bytes {
                break;
            }
            if let Some((path, size)) = self.entries.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(size);
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}
