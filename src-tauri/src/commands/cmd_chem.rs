use crate::chem_api::{self, CompoundInfo, RetroTreeData};

#[tauri::command]
pub async fn fetch_compound_info(query: String) -> Result<CompoundInfo, String> {
    chem_api::fetch_compound_info(query).await
}

#[tauri::command]
pub async fn retrosynthesize_target(target_smiles: String, depth: u8) -> Result<RetroTreeData, String> {
    chem_api::retrosynthesize_target(target_smiles, depth).await
}
