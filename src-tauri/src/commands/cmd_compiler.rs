use tauri::State;

use crate::compiler::{
    compile_markdown_to_pdf, CompilePayload, CompilerEnvironmentStatus, CompilerState,
};

#[tauri::command]
pub async fn compile_to_pdf(
    payload: CompilePayload,
    compiler: State<'_, CompilerState>,
) -> Result<Vec<u8>, String> {
    compile_markdown_to_pdf(payload, compiler.inner()).await
}

#[tauri::command]
pub fn get_compiler_status(
    compiler: State<'_, CompilerState>,
) -> Result<CompilerEnvironmentStatus, String> {
    Ok(compiler.status())
}
