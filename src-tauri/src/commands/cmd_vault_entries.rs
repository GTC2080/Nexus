use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::db::{self, DbState};
use crate::AppError;

fn canonicalize_with_label(path: &Path, label: &str) -> Result<PathBuf, AppError> {
    fs::canonicalize(path).map_err(|e| AppError::Custom(format!("无法解析{} [{}]: {}", label, path.display(), e)))
}

fn ensure_inside_vault(vault: &Path, target: &Path, violation_message: &str) -> Result<(), AppError> {
    if !target.starts_with(vault) {
        return Err(AppError::Custom(violation_message.to_string()));
    }
    Ok(())
}

fn to_relative_slash(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[tauri::command]
pub async fn delete_entry(vault_path: String, target_path: String, db: State<'_, DbState>) -> Result<(), AppError> {
    let db_conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = Path::new(&vault_path);
        let target = Path::new(&target_path);

        if !target.exists() {
            return Err(AppError::Custom(format!("目标不存在: {}", target_path)));
        }

        let vault_canonical = canonicalize_with_label(vault, "知识库路径")?;
        let target_canonical = canonicalize_with_label(target, "目标路径")?;

        if target_canonical == vault_canonical {
            return Err(AppError::Custom("禁止删除知识库根目录".to_string()));
        }
        ensure_inside_vault(&vault_canonical, &target_canonical, "禁止删除知识库目录之外的路径")?;

        let id = to_relative_slash(&target_canonical, &vault_canonical);

        let is_file = target_canonical.is_file();
        if is_file {
            fs::remove_file(&target_canonical)?;
        } else if target_canonical.is_dir() {
            fs::remove_dir_all(&target_canonical)?;
        } else {
            return Err(AppError::Custom("目标既不是文件也不是目录".to_string()));
        }

        let conn = db_conn.lock().map_err(|_| AppError::Lock)?;
        if is_file {
            db::delete_note_by_id(&conn, &id)?;
        } else {
            db::delete_notes_by_prefix(&conn, &id)?;
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}

#[tauri::command]
pub async fn move_entry(
    vault_path: String,
    source_path: String,
    dest_folder: String,
    db: State<'_, DbState>,
) -> Result<(), AppError> {
    let db_conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = Path::new(&vault_path);
        let source = Path::new(&source_path);
        let dest_dir = Path::new(&dest_folder);

        if !source.exists() {
            return Err(AppError::Custom(format!("源路径不存在: {}", source_path)));
        }
        if !dest_dir.is_dir() {
            return Err(AppError::Custom(format!("目标文件夹不存在: {}", dest_folder)));
        }

        let vault_canonical = canonicalize_with_label(vault, "知识库路径")?;
        let source_canonical = canonicalize_with_label(source, "源路径")?;
        let dest_canonical = canonicalize_with_label(dest_dir, "目标路径")?;

        ensure_inside_vault(&vault_canonical, &source_canonical, "禁止移动知识库外的文件")?;
        ensure_inside_vault(&vault_canonical, &dest_canonical, "禁止移动到知识库外")?;

        let file_name = source_canonical.file_name().ok_or(AppError::Custom("无法获取文件名".to_string()))?;
        let new_path = dest_canonical.join(file_name);
        if new_path.exists() {
            return Err(AppError::Custom(format!("目标已存在同名文件/文件夹: {}", new_path.display())));
        }
        if source_canonical.is_dir() && dest_canonical.starts_with(&source_canonical) {
            return Err(AppError::Custom("不能将文件夹移动到自身的子目录".to_string()));
        }

        let old_relative = to_relative_slash(&source_canonical, &vault_canonical);
        let new_relative = to_relative_slash(&new_path, &vault_canonical);

        fs::rename(&source_canonical, &new_path)?;

        let conn = db_conn.lock().map_err(|_| AppError::Lock)?;
        if source_canonical.is_dir() || new_path.is_dir() {
            db::rename_notes_by_prefix(&conn, &old_relative, &new_relative, &vault_path)?;
        } else {
            let new_abs = new_path.to_string_lossy().replace('\\', "/");
            db::rename_note_id(&conn, &old_relative, &new_relative, &new_abs)?;
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}

#[tauri::command]
pub async fn create_folder(vault_path: String, folder_path: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = Path::new(&vault_path);
        let target = Path::new(&folder_path);

        let vault_canonical = canonicalize_with_label(vault, "知识库路径")?;

        let parent = target.parent().ok_or(AppError::Custom("无法获取目标父目录".to_string()))?;
        if !parent.exists() {
            return Err(AppError::Custom(format!("父目录不存在: {}", parent.display())));
        }

        let parent_canonical = canonicalize_with_label(parent, "父目录")?;
        ensure_inside_vault(&vault_canonical, &parent_canonical, "禁止在知识库外创建文件夹")?;

        if target.exists() {
            return Err(AppError::Custom(format!("目标已存在: {}", target.display())));
        }

        fs::create_dir(target)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}

#[tauri::command]
pub async fn rename_entry(
    vault_path: String,
    source_path: String,
    new_name: String,
    db: State<'_, DbState>,
) -> Result<(), AppError> {
    let db_conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Custom("新名称不能为空".to_string()));
        }
        if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
            return Err(AppError::Custom("新名称不合法".to_string()));
        }

        let vault = Path::new(&vault_path);
        let source = Path::new(&source_path);
        if !source.exists() {
            return Err(AppError::Custom(format!("源路径不存在: {}", source_path)));
        }

        let vault_canonical = canonicalize_with_label(vault, "知识库路径")?;
        let source_canonical = canonicalize_with_label(source, "源路径")?;

        if source_canonical == vault_canonical {
            return Err(AppError::Custom("禁止重命名知识库根目录".to_string()));
        }
        ensure_inside_vault(&vault_canonical, &source_canonical, "禁止重命名知识库外的路径")?;

        let parent = source_canonical.parent().ok_or(AppError::Custom("无法获取父目录".to_string()))?;

        let final_name = if !source_canonical.is_dir() {
            if let Some(src_ext) = source_canonical.extension().and_then(|e| e.to_str()) {
                let new_path = Path::new(trimmed);
                if new_path.extension().is_none() {
                    format!("{}.{}", trimmed, src_ext)
                } else {
                    trimmed.to_string()
                }
            } else {
                trimmed.to_string()
            }
        } else {
            trimmed.to_string()
        };

        let target_path = parent.join(&final_name);
        if target_path == source_canonical {
            return Ok(());
        }
        if target_path.exists() {
            return Err(AppError::Custom(format!("目标已存在同名文件/文件夹: {}", target_path.display())));
        }

        let source_is_dir = source_canonical.is_dir();
        let old_relative = to_relative_slash(&source_canonical, &vault_canonical);
        let new_relative = to_relative_slash(&target_path, &vault_canonical);

        fs::rename(&source_canonical, &target_path)?;

        let conn = db_conn.lock().map_err(|_| AppError::Lock)?;
        if source_is_dir {
            db::rename_notes_by_prefix(&conn, &old_relative, &new_relative, &vault_path)?;
        } else {
            let new_abs = target_path.to_string_lossy().replace('\\', "/");
            db::rename_note_id(&conn, &old_relative, &new_relative, &new_abs)?;
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::Custom(format!("线程执行错误: {}", e)))?
}
