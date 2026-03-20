use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::shared::command_utils::is_supported_extension;

/// 文件变更事件，发送给前端
#[derive(Debug, Clone, Serialize)]
pub struct FsChangeEvent {
    /// 变更的文件相对路径列表
    pub changed: Vec<String>,
    /// 被删除的文件相对路径列表
    pub removed: Vec<String>,
}

/// Watcher 状态，管理 notify 的生命周期
pub struct WatcherState {
    /// 当前活跃的 debouncer 实例（持有即活跃，drop 即停止）
    inner: Arc<Mutex<Option<WatcherInner>>>,
}

struct WatcherInner {
    /// notify-debouncer-mini 实例，drop 时自动停止监听
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    /// 当前监听的 vault 路径
    vault_path: PathBuf,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// 启动文件监听。如果已有监听器则先停止旧的。
    pub fn start(
        &self,
        vault_path: &str,
        ignored_folders: &HashSet<String>,
        app: AppHandle,
    ) -> Result<(), String> {
        let vault = PathBuf::from(vault_path);
        if !vault.is_dir() {
            return Err(format!("路径不存在: {}", vault_path));
        }

        // 先停止旧的监听器
        self.stop();

        let vault_for_closure = vault.clone();
        let ignored = ignored_folders.clone();

        // 500ms 去抖：合并短时间内的连续事件（编辑器保存、临时文件等）
        let mut debouncer = new_debouncer(Duration::from_millis(500), move |res: Result<Vec<DebouncedEvent>, notify::Error>| {
            match res {
                Ok(events) => {
                    let mut changed = Vec::new();
                    let mut removed = Vec::new();

                    for event in events {
                        let path: &PathBuf = &event.path;

                        // 过滤：忽略目录、隐藏文件、忽略文件夹内的文件
                        if should_ignore(path, &vault_for_closure, &ignored) {
                            continue;
                        }

                        // 计算相对路径
                        let rel = match path.strip_prefix(&vault_for_closure) {
                            Ok(r) => r.to_string_lossy().into_owned(),
                            Err(_) => continue,
                        };

                        match event.kind {
                            DebouncedEventKind::Any => {
                                if path.exists() {
                                    changed.push(rel);
                                } else {
                                    removed.push(rel);
                                }
                            }
                            DebouncedEventKind::AnyContinuous => {
                                // 长时间持续写入（如大文件复制），当成变更处理
                                if path.exists() {
                                    changed.push(rel);
                                }
                            }
                            _ => {}
                        }
                    }

                    // 去重
                    changed.sort();
                    changed.dedup();
                    removed.sort();
                    removed.dedup();

                    if !changed.is_empty() || !removed.is_empty() {
                        let payload = FsChangeEvent { changed, removed };
                        if let Err(e) = app.emit("vault:fs-change", &payload) {
                            eprintln!("[watcher] 发送事件失败: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[watcher] 监听错误: {:?}", e);
                }
            }
        })
        .map_err(|e| format!("创建 debouncer 失败: {}", e))?;

        // 递归监听整个 vault 目录
        debouncer
            .watcher()
            .watch(&vault, notify::RecursiveMode::Recursive)
            .map_err(|e| format!("启动监听失败: {}", e))?;

        eprintln!("[watcher] 开始监听: {}", vault_path);

        let mut guard = self.inner.lock().unwrap();
        *guard = Some(WatcherInner {
            _debouncer: debouncer,
            vault_path: vault,
        });

        Ok(())
    }

    /// 停止文件监听
    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(inner) = guard.take() {
            eprintln!("[watcher] 停止监听: {}", inner.vault_path.display());
        }
    }

    /// 当前是否正在监听
    pub fn is_watching(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }
}

/// 判断路径是否应该被忽略
fn should_ignore(path: &Path, vault: &Path, ignored: &HashSet<String>) -> bool {
    // 忽略目录本身的事件
    if path.is_dir() {
        return true;
    }

    // 忽略不支持的文件类型
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !is_supported_extension(ext) {
        return true;
    }

    // 检查路径中的每个组件
    if let Ok(rel) = path.strip_prefix(vault) {
        for component in rel.components() {
            let name = component.as_os_str().to_string_lossy();
            // 忽略隐藏文件/文件夹（以 . 开头）
            if name.starts_with('.') {
                return true;
            }
            // 忽略用户指定的文件夹
            if ignored.contains(name.as_ref()) {
                return true;
            }
        }
    }

    false
}
