mod common;
mod embeddings;
mod graph;
mod lifecycle;
mod notes;
mod parsing;
mod relations;
mod schema;
mod study;

pub use common::DbState;
pub use embeddings::{clear_all_embeddings, get_all_embeddings, update_note_embedding};
pub use graph::{get_graph_data, get_enriched_graph_data};
pub use lifecycle::{delete_note_by_id, delete_notes_by_prefix, rename_note_id, rename_notes_by_prefix};
pub use notes::{
    get_all_note_timestamps, get_all_notes_for_embedding, get_all_tags, get_backlinks,
    get_note_content_by_id, get_notes_by_tag, get_notes_content_by_ids, get_tag_tree,
    search_notes_by_filename, update_note_content, upsert_note,
};
pub use schema::init_db;
pub use study::{end_session, query_stats, query_truth_state, query_heatmap_cells, start_session, tick_session, HeatmapGrid, StudyStats, TruthStateDto};
