mod ai;
mod commands;
mod db;
mod models;
mod services;

use std::sync::{Arc, Mutex};

use commands::{read_note, scan_vault, write_note};
use db::DbState;
use tauri::Manager;

/// Tauri 应用入口配置
///
/// # 数据库生命周期管理
/// 数据库的初始化时机是在前端调用 `scan_vault` 时（即用户选择知识库目录后），
/// 而非应用启动时。这是因为数据库文件存储在 Vault 目录下，
/// 启动时尚不知道用户要打开哪个 Vault。
///
/// 因此这里使用 `setup` 钩子注册一个"空的" DbState 占位，
/// 实际的数据库连接会在 `init_vault` 命令中被替换。
///
/// 但为了简化当前阶段的实现，我们采用另一种方案：
/// 新增一个 `init_vault` 命令，前端在选择目录后先调用它初始化数据库，
/// 再调用 `scan_vault` 扫描文件。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::init_vault,
            commands::search_notes,
            commands::get_backlinks,
            commands::semantic_search,
            commands::get_related_notes,
            commands::get_graph_data,
            commands::get_all_tags,
            commands::get_notes_by_tag,
            commands::build_file_tree,
            commands::ask_vault,
            commands::test_ai_connection,
            commands::ponder_node,
            commands::analyze_timeline,
            commands::delete_entry,
            commands::move_entry,
            commands::rename_entry,
            scan_vault,
            read_note,
            commands::read_note_indexed_content,
            commands::read_binary_file,
            commands::parse_spectroscopy,
            commands::create_folder,
            write_note
        ])
        // 注册一个初始的空数据库状态
        // 使用内存数据库作为占位，init_vault 命令会替换为真实的文件数据库
        .setup(|app| {
            let placeholder_conn = rusqlite::Connection::open_in_memory()
                .expect("创建占位内存数据库失败");
            app.manage(DbState {
                conn: Arc::new(Mutex::new(placeholder_conn)),
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用时发生错误");
}
