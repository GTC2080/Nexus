use super::types::{AtomNode, CellParams, FractionalAtom, SymOp};

/// 容差：用于判断两个原子是否重叠（分数坐标）
const OVERLAP_TOL: f64 = 0.02;

/// 最大原子数限制（防止前端 WebGL 崩溃）
const MAX_ATOMS: usize = 50_000;

/// 应用对称操作 → 生成完整单胞原子 → 扩展为超晶胞
pub(super) fn build_supercell(
    cell: &CellParams,
    raw_atoms: &[FractionalAtom],
    symops: &[SymOp],
    nx: u32,
    ny: u32,
    nz: u32,
) -> Result<Vec<AtomNode>, String> {
    let vecs = cell.lattice_vectors()?;

    // Step 1: 应用对称操作补全单胞原子
    let mut unit_atoms: Vec<FractionalAtom> = Vec::new();

    for atom in raw_atoms {
        for op in symops {
            let mut new_frac = [0.0_f64; 3];
            for i in 0..3 {
                new_frac[i] = op.rot[i][0] * atom.frac[0]
                    + op.rot[i][1] * atom.frac[1]
                    + op.rot[i][2] * atom.frac[2]
                    + op.trans[i];
                // 归一化到 [0, 1)
                new_frac[i] = new_frac[i].rem_euclid(1.0);
            }

            // 去重：检查是否已有相同元素的原子在同一位置
            let is_duplicate = unit_atoms.iter().any(|existing| {
                existing.element == atom.element && {
                    let dx = (existing.frac[0] - new_frac[0]).abs();
                    let dy = (existing.frac[1] - new_frac[1]).abs();
                    let dz = (existing.frac[2] - new_frac[2]).abs();
                    // 考虑周期性边界
                    let dx = dx.min(1.0 - dx);
                    let dy = dy.min(1.0 - dy);
                    let dz = dz.min(1.0 - dz);
                    dx < OVERLAP_TOL && dy < OVERLAP_TOL && dz < OVERLAP_TOL
                }
            });

            if !is_duplicate {
                unit_atoms.push(FractionalAtom {
                    element: atom.element.clone(),
                    frac: new_frac,
                });
            }
        }
    }

    // Step 2: 超晶胞扩展
    let total_estimate = unit_atoms.len() * (nx as usize) * (ny as usize) * (nz as usize);
    if total_estimate > MAX_ATOMS {
        return Err(format!(
            "超晶胞原子数 ({}) 超过上限 ({})，请减小扩展维度",
            total_estimate, MAX_ATOMS
        ));
    }

    let mut result = Vec::with_capacity(total_estimate);

    for ix in 0..nx {
        for iy in 0..ny {
            for iz in 0..nz {
                for atom in &unit_atoms {
                    let shifted_frac = [
                        atom.frac[0] + ix as f64,
                        atom.frac[1] + iy as f64,
                        atom.frac[2] + iz as f64,
                    ];
                    let cart = cell.frac_to_cart(shifted_frac, &vecs);
                    result.push(AtomNode {
                        element: atom.element.clone(),
                        cartesian_coords: cart,
                    });
                }
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_cubic_supercell() {
        let cell = CellParams {
            a: 3.0,
            b: 3.0,
            c: 3.0,
            alpha_deg: 90.0,
            beta_deg: 90.0,
            gamma_deg: 90.0,
        };
        let atoms = vec![FractionalAtom {
            element: "Na".into(),
            frac: [0.0, 0.0, 0.0],
        }];
        let symops = vec![SymOp {
            rot: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            trans: [0.0, 0.0, 0.0],
        }];

        let result = build_supercell(&cell, &atoms, &symops, 2, 2, 2).unwrap();
        assert_eq!(result.len(), 8); // 1 atom * 2*2*2
        // Corner atom at (1,1,1) should be at (3,3,3)
        let last = &result[7];
        assert!((last.cartesian_coords[0] - 3.0).abs() < 1e-8);
    }

    #[test]
    fn test_nacl_with_symops() {
        let cell = CellParams {
            a: 5.64,
            b: 5.64,
            c: 5.64,
            alpha_deg: 90.0,
            beta_deg: 90.0,
            gamma_deg: 90.0,
        };
        let atoms = vec![
            FractionalAtom { element: "Na".into(), frac: [0.0, 0.0, 0.0] },
            FractionalAtom { element: "Cl".into(), frac: [0.5, 0.0, 0.0] },
        ];
        // Fm-3m has 48 symops, but let's test with a minimal set
        let symops = vec![
            SymOp { rot: [[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0]], trans: [0.0,0.0,0.0] },
            SymOp { rot: [[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0]], trans: [0.0,0.5,0.5] },
            SymOp { rot: [[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0]], trans: [0.5,0.0,0.5] },
            SymOp { rot: [[1.0,0.0,0.0],[0.0,1.0,0.0],[0.0,0.0,1.0]], trans: [0.5,0.5,0.0] },
        ];

        let result = build_supercell(&cell, &atoms, &symops, 1, 1, 1).unwrap();
        // 2 atoms × 4 symops = 8 atoms (with dedup)
        assert!(result.len() == 8);
    }
}
