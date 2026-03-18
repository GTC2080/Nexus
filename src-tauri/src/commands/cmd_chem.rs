use crate::chem_api::{self, CompoundInfo};

#[tauri::command]
pub async fn fetch_compound_info(query: String) -> Result<CompoundInfo, String> {
    chem_api::fetch_compound_info(query).await
}
