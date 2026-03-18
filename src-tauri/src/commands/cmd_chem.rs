use crate::chem_api::{self, CompoundInfo, RetroTreeData};
use crate::kinetics::{self, KineticsParams, KineticsResult};

#[tauri::command]
pub async fn fetch_compound_info(query: String) -> Result<CompoundInfo, String> {
    chem_api::fetch_compound_info(query).await
}

#[tauri::command]
pub async fn retrosynthesize_target(target_smiles: String, depth: u8) -> Result<RetroTreeData, String> {
    chem_api::retrosynthesize_target(target_smiles, depth).await
}


#[tauri::command]
pub async fn simulate_polymerization(params: KineticsParams) -> Result<KineticsResult, String> {
    tauri::async_runtime::spawn_blocking(move || kinetics::simulate_polymerization(params))
        .await
        .map_err(|_| "模拟任务执行失败".to_string())?
}

