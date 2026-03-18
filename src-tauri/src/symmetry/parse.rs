use nalgebra::Vector3;

use super::elements::{atomic_mass, normalize_element};
use super::types::{Atom, CifCell};

pub(super) fn parse_atoms(raw: &str, format: &str) -> Result<Vec<Atom>, String> {
    match format.to_lowercase().as_str() {
        "pdb" => parse_pdb(raw),
        "xyz" => parse_xyz(raw),
        "cif" => parse_cif_simple(raw),
        _ => Err(format!("不支持的分子文件格式: {}", format)),
    }
}

fn parse_pdb(raw: &str) -> Result<Vec<Atom>, String> {
    let mut atoms = Vec::new();
    for line in raw.lines() {
        if line.starts_with("ATOM") || line.starts_with("HETATM") {
            if line.len() < 54 {
                continue;
            }
            let x = line[30..38]
                .trim()
                .parse::<f64>()
                .map_err(|_| "PDB 坐标解析失败")?;
            let y = line[38..46]
                .trim()
                .parse::<f64>()
                .map_err(|_| "PDB 坐标解析失败")?;
            let z = line[46..54]
                .trim()
                .parse::<f64>()
                .map_err(|_| "PDB 坐标解析失败")?;

            let element = if line.len() >= 78 {
                line[76..78].trim().to_string()
            } else {
                let atom_name = line[12..16].trim();
                atom_name
                    .chars()
                    .filter(|c| c.is_alphabetic())
                    .take(2)
                    .collect::<String>()
            };
            let element = normalize_element(&element);
            let mass = atomic_mass(&element);
            atoms.push(Atom {
                element,
                pos: Vector3::new(x, y, z),
                mass,
            });
        }
    }
    Ok(atoms)
}

fn parse_xyz(raw: &str) -> Result<Vec<Atom>, String> {
    let mut lines = raw.lines();
    let _count_line = lines.next().ok_or("XYZ 文件为空")?;
    let _comment = lines.next().ok_or("XYZ 文件格式不完整")?;

    let mut atoms = Vec::new();
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        let element = normalize_element(parts[0]);
        let x = parts[1]
            .parse::<f64>()
            .map_err(|_| "XYZ 坐标解析失败")?;
        let y = parts[2]
            .parse::<f64>()
            .map_err(|_| "XYZ 坐标解析失败")?;
        let z = parts[3]
            .parse::<f64>()
            .map_err(|_| "XYZ 坐标解析失败")?;
        let mass = atomic_mass(&element);
        atoms.push(Atom {
            element,
            pos: Vector3::new(x, y, z),
            mass,
        });
    }
    Ok(atoms)
}

fn parse_cif_simple(raw: &str) -> Result<Vec<Atom>, String> {
    let mut atoms = Vec::new();
    let lines: Vec<&str> = raw.lines().collect();
    let cell = parse_cif_cell(&lines);
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        if line == "loop_" {
            let mut col_symbol: Option<usize> = None;
            let mut col_x: Option<usize> = None;
            let mut col_y: Option<usize> = None;
            let mut col_z: Option<usize> = None;
            let mut uses_fractional = false;
            let mut col_idx = 0;
            i += 1;

            while i < lines.len() && lines[i].trim().starts_with('_') {
                let field = lines[i].trim();
                if field.contains("type_symbol") || field == "_atom_site_label" {
                    if col_symbol.is_none() {
                        col_symbol = Some(col_idx);
                    }
                }
                if field.contains("_atom_site_fract_x") {
                    col_x = Some(col_idx);
                    uses_fractional = true;
                } else if field.contains("_atom_site_Cartn_x") {
                    col_x = Some(col_idx);
                }
                if field.contains("_atom_site_fract_y") {
                    col_y = Some(col_idx);
                    uses_fractional = true;
                } else if field.contains("_atom_site_Cartn_y") {
                    col_y = Some(col_idx);
                }
                if field.contains("_atom_site_fract_z") {
                    col_z = Some(col_idx);
                    uses_fractional = true;
                } else if field.contains("_atom_site_Cartn_z") {
                    col_z = Some(col_idx);
                }
                col_idx += 1;
                i += 1;
            }

            if let (Some(cs), Some(cx), Some(cy), Some(cz)) = (col_symbol, col_x, col_y, col_z) {
                if uses_fractional && cell.is_none() {
                    return Err(
                        "CIF 使用分数坐标，但缺少完整晶胞参数 (_cell_length_*/_cell_angle_*)"
                            .into(),
                    );
                }
                while i < lines.len() {
                    let data_line = lines[i].trim();
                    if data_line.is_empty()
                        || data_line.starts_with('_')
                        || data_line.starts_with('#')
                        || data_line == "loop_"
                    {
                        break;
                    }
                    let parts: Vec<&str> = data_line.split_whitespace().collect();
                    let max_col = [cs, cx, cy, cz].iter().copied().max().unwrap_or(0);
                    if parts.len() > max_col {
                        let element = normalize_element(parts[cs]);
                        let (x, y, z) = match (
                            parse_cif_number(parts[cx]),
                            parse_cif_number(parts[cy]),
                            parse_cif_number(parts[cz]),
                        ) {
                            (Some(x), Some(y), Some(z)) => {
                                if uses_fractional {
                                    let cart = cell
                                        .as_ref()
                                        .expect("fractional CIF coordinates require cell parameters")
                                        .frac_to_cart(Vector3::new(x, y, z))?;
                                    (cart.x, cart.y, cart.z)
                                } else {
                                    (x, y, z)
                                }
                            }
                            _ => {
                                i += 1;
                                continue;
                            }
                        };
                        let mass = atomic_mass(&element);
                        atoms.push(Atom {
                            element,
                            pos: Vector3::new(x, y, z),
                            mass,
                        });
                    }
                    i += 1;
                }
            }
        }
        i += 1;
    }
    Ok(atoms)
}

fn parse_cif_number(raw: &str) -> Option<f64> {
    let trimmed = raw.trim().trim_matches('\'').trim_matches('"');
    let core = trimmed.split('(').next().unwrap_or(trimmed);
    core.parse::<f64>().ok()
}

fn parse_cif_cell(lines: &[&str]) -> Option<CifCell> {
    let mut a: Option<f64> = None;
    let mut b: Option<f64> = None;
    let mut c: Option<f64> = None;
    let mut alpha: Option<f64> = None;
    let mut beta: Option<f64> = None;
    let mut gamma: Option<f64> = None;

    for line in lines {
        let line = line.trim();
        if line.starts_with("_cell_length_a") {
            a = line.split_whitespace().nth(1).and_then(parse_cif_number);
        } else if line.starts_with("_cell_length_b") {
            b = line.split_whitespace().nth(1).and_then(parse_cif_number);
        } else if line.starts_with("_cell_length_c") {
            c = line.split_whitespace().nth(1).and_then(parse_cif_number);
        } else if line.starts_with("_cell_angle_alpha") {
            alpha = line.split_whitespace().nth(1).and_then(parse_cif_number);
        } else if line.starts_with("_cell_angle_beta") {
            beta = line.split_whitespace().nth(1).and_then(parse_cif_number);
        } else if line.starts_with("_cell_angle_gamma") {
            gamma = line.split_whitespace().nth(1).and_then(parse_cif_number);
        }
    }

    match (a, b, c, alpha, beta, gamma) {
        (Some(a), Some(b), Some(c), Some(alpha_deg), Some(beta_deg), Some(gamma_deg)) => {
            Some(CifCell {
                a,
                b,
                c,
                alpha_deg,
                beta_deg,
                gamma_deg,
            })
        }
        _ => None,
    }
}
