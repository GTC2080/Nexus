use std::fs;
use std::path::Path;

use tauri::State;

use crate::commands::is_spectroscopy_extension;
use crate::db::{self, DbState};
use crate::models::SpectroscopyData;
use crate::services::spectroscopy::parse_spectroscopy_from_text;

#[tauri::command]
pub fn parse_spectroscopy(file_path: String) -> Result<SpectroscopyData, String> {
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !is_spectroscopy_extension(&ext) {
        return Err(format!("不支持的波谱文件扩展名: {}", ext));
    }

    let raw = read_note(file_path)?;
    parse_spectroscopy_from_text(&raw, &ext)
}

#[tauri::command]
pub fn read_note(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    if !path.is_file() {
        return Err(format!("指定路径不是一个文件: {}", file_path));
    }
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败 [{}]: {}", file_path, e))?;

    if bytes.len() >= 2 {
        if bytes[0] == 0xFF && bytes[1] == 0xFE {
            let u16s: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            return String::from_utf16(&u16s)
                .map_err(|e| format!("UTF-16 LE 解码失败 [{}]: {}", file_path, e));
        }
        if bytes[0] == 0xFE && bytes[1] == 0xFF {
            let u16s: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            return String::from_utf16(&u16s)
                .map_err(|e| format!("UTF-16 BE 解码失败 [{}]: {}", file_path, e));
        }
    }

    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
    }
}

#[tauri::command]
pub fn read_binary_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    if !path.is_file() {
        return Err(format!("指定路径不是一个文件: {}", file_path));
    }
    fs::read(path).map_err(|e| format!("读取二进制文件失败 [{}]: {}", file_path, e))
}

#[tauri::command]
pub fn read_note_indexed_content(note_id: String, db: State<'_, DbState>) -> Result<String, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let content = db::get_note_content_by_id(&conn, &note_id)?.unwrap_or_default();
    Ok(content)
}
