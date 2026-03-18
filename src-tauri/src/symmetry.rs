//! 分子点群与空间对称性推演引擎
//!
//! 纯 Rust 高性能实现：解析原子坐标 → 质心平移 → 惯性张量对角化 →
//! 穷举对称操作匹配 → 点群分类 → 输出结构化渲染指令 (JSON)。
//! 前端零计算：所有几何数据（平面顶点、轴端点）均在此预计算完毕。

use nalgebra::{Matrix3, SymmetricEigen, Vector3};
use serde::Serialize;
use std::f64::consts::PI;

// ===== 容差与限制 =====
const TOLERANCE: f64 = 0.30; // Å，原子匹配容差
const ANGLE_TOL: f64 = 0.10; // rad，方向向量去重容差
const MAX_ATOMS_FOR_SYMMETRY: usize = 500;

// ===== 渲染协议 (The Render Schema) =====

#[derive(Serialize, Clone, Debug)]
pub struct Vec3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3D {
    fn from_v3(v: &Vector3<f64>) -> Self {
        Vec3D {
            x: v.x,
            y: v.y,
            z: v.z,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct SymmetryPlane {
    pub normal: Vec3D,
    pub center: Vec3D,
    pub vertices: [Vec3D; 4],
}

#[derive(Serialize, Clone, Debug)]
pub struct RotationAxis {
    pub vector: Vec3D,
    pub center: Vec3D,
    pub order: u8,
    pub start: Vec3D,
    pub end: Vec3D,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymmetryData {
    pub point_group: String,
    pub planes: Vec<SymmetryPlane>,
    pub axes: Vec<RotationAxis>,
    pub has_inversion: bool,
    pub atom_count: usize,
}

// ===== 内部数据结构 =====

#[derive(Clone, Debug)]
struct Atom {
    element: String,
    pos: Vector3<f64>,
    mass: f64,
}

#[derive(Clone, Debug)]
struct FoundAxis {
    dir: Vector3<f64>, // 单位向量
    order: u8,
}

#[derive(Clone, Debug)]
struct FoundPlane {
    normal: Vector3<f64>, // 单位向量
}

// ===== 公开接口 =====

pub fn calculate(raw_data: &str, format: &str) -> Result<SymmetryData, String> {
    let mut atoms = parse_atoms(raw_data, format)?;
    if atoms.is_empty() {
        return Err("未找到任何原子坐标".into());
    }
    if atoms.len() > MAX_ATOMS_FOR_SYMMETRY {
        return Err(format!(
            "原子数 ({}) 超过对称性分析上限 ({})，请使用较小的分子",
            atoms.len(),
            MAX_ATOMS_FOR_SYMMETRY
        ));
    }

    let atom_count = atoms.len();

    // 单原子特殊处理
    if atom_count == 1 {
        return Ok(SymmetryData {
            point_group: "K_h".into(),
            planes: vec![],
            axes: vec![],
            has_inversion: true,
            atom_count,
        });
    }

    // 平移至质心
    let com = center_of_mass(&atoms);
    for atom in &mut atoms {
        atom.pos -= com;
    }

    // 分子半径（用于渲染尺寸缩放）
    let mol_radius = atoms
        .iter()
        .map(|a| a.pos.norm())
        .fold(0.0_f64, f64::max)
        .max(1.0);

    // 检测线性分子
    let is_linear = check_linear(&atoms);

    if is_linear {
        let has_inv = check_inversion(&atoms);
        let pg = if has_inv { "D∞h" } else { "C∞v" };

        // 线性分子：主轴沿分子方向
        let axis_dir = find_linear_axis(&atoms);
        let axis = build_axis(&axis_dir, 0, mol_radius); // order=0 表示 ∞

        return Ok(SymmetryData {
            point_group: pg.into(),
            planes: vec![],
            axes: vec![axis],
            has_inversion: has_inv,
            atom_count,
        });
    }

    // 惯性张量 → 主轴
    let principal_axes = compute_principal_axes(&atoms);

    // 穷举对称操作
    let candidate_dirs = generate_candidate_directions(&atoms, &principal_axes);
    let found_axes = find_rotation_axes(&atoms, &candidate_dirs);
    let candidate_planes = generate_candidate_planes(&atoms, &found_axes, &principal_axes);
    let found_planes = find_mirror_planes(&atoms, &candidate_planes);
    let has_inversion = check_inversion(&atoms);

    // 点群分类
    let point_group = classify_point_group(&found_axes, &found_planes, has_inversion);

    // 构建渲染数据
    let axes_render: Vec<RotationAxis> = found_axes
        .iter()
        .map(|a| build_axis(&a.dir, a.order, mol_radius))
        .collect();

    let planes_render: Vec<SymmetryPlane> = found_planes
        .iter()
        .map(|p| build_plane(&p.normal, mol_radius))
        .collect();

    Ok(SymmetryData {
        point_group,
        planes: planes_render,
        axes: axes_render,
        has_inversion,
        atom_count,
    })
}

// ===== 原子解析 =====

fn parse_atoms(raw: &str, format: &str) -> Result<Vec<Atom>, String> {
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

            // 元素符号：PDB 列 76-78，退回到列 12-16 的原子名
            let element = if line.len() >= 78 {
                line[76..78].trim().to_string()
            } else {
                // 从原子名提取
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
    // 第一行：原子数
    let _count_line = lines.next().ok_or("XYZ 文件为空")?;
    // 第二行：注释
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
    // 简化 CIF 解析：查找 _atom_site 循环块
    let mut atoms = Vec::new();
    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        // 查找 loop_ 后跟 _atom_site 字段
        if line == "loop_" {
            let mut col_symbol: Option<usize> = None;
            let mut col_x: Option<usize> = None;
            let mut col_y: Option<usize> = None;
            let mut col_z: Option<usize> = None;
            let mut col_idx = 0;
            i += 1;

            // 读取列定义
            while i < lines.len() && lines[i].trim().starts_with('_') {
                let field = lines[i].trim();
                if field.contains("type_symbol") || field == "_atom_site_label" {
                    if col_symbol.is_none() {
                        col_symbol = Some(col_idx);
                    }
                }
                if field.contains("_atom_site_fract_x") || field.contains("_atom_site_Cartn_x") {
                    col_x = Some(col_idx);
                }
                if field.contains("_atom_site_fract_y") || field.contains("_atom_site_Cartn_y") {
                    col_y = Some(col_idx);
                }
                if field.contains("_atom_site_fract_z") || field.contains("_atom_site_Cartn_z") {
                    col_z = Some(col_idx);
                }
                col_idx += 1;
                i += 1;
            }

            // 如果找到了坐标列，读取数据行
            if let (Some(cs), Some(cx), Some(cy), Some(cz)) = (col_symbol, col_x, col_y, col_z) {
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
                        // CIF 坐标可能带括号不确定度，如 "0.1234(5)"
                        let strip_uncertainty = |s: &str| -> f64 {
                            let s = s.split('(').next().unwrap_or(s);
                            s.parse::<f64>().unwrap_or(0.0)
                        };
                        let x = strip_uncertainty(parts[cx]);
                        let y = strip_uncertainty(parts[cy]);
                        let z = strip_uncertainty(parts[cz]);
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

// ===== 几何计算 =====

fn center_of_mass(atoms: &[Atom]) -> Vector3<f64> {
    let total_mass: f64 = atoms.iter().map(|a| a.mass).sum();
    if total_mass < 1e-10 {
        // 退化情况：等权平均
        let n = atoms.len() as f64;
        return atoms.iter().map(|a| a.pos).sum::<Vector3<f64>>() / n;
    }
    atoms
        .iter()
        .map(|a| a.pos * a.mass)
        .sum::<Vector3<f64>>()
        / total_mass
}

fn compute_principal_axes(atoms: &[Atom]) -> [Vector3<f64>; 3] {
    let mut inertia = Matrix3::<f64>::zeros();
    for atom in atoms {
        let r = &atom.pos;
        let m = atom.mass;
        let r2 = r.norm_squared();
        // I_ij = Σ m_k (r_k² δ_ij - r_ki r_kj)
        inertia[(0, 0)] += m * (r2 - r.x * r.x);
        inertia[(1, 1)] += m * (r2 - r.y * r.y);
        inertia[(2, 2)] += m * (r2 - r.z * r.z);
        inertia[(0, 1)] -= m * r.x * r.y;
        inertia[(1, 0)] -= m * r.x * r.y;
        inertia[(0, 2)] -= m * r.x * r.z;
        inertia[(2, 0)] -= m * r.x * r.z;
        inertia[(1, 2)] -= m * r.y * r.z;
        inertia[(2, 1)] -= m * r.y * r.z;
    }

    let eigen = SymmetricEigen::new(inertia);
    let vecs = eigen.eigenvectors;
    [
        vecs.column(0).into_owned(),
        vecs.column(1).into_owned(),
        vecs.column(2).into_owned(),
    ]
}

fn check_linear(atoms: &[Atom]) -> bool {
    if atoms.len() <= 2 {
        return true;
    }
    // 检查所有原子是否共线
    let p0 = &atoms[0].pos;
    // 找第一个与 p0 不重合的原子
    let dir = match atoms.iter().skip(1).find(|a| (a.pos - p0).norm() > TOLERANCE) {
        Some(a) => (a.pos - p0).normalize(),
        None => return true, // 所有原子重合
    };

    atoms.iter().skip(1).all(|a| {
        let v = a.pos - p0;
        let proj = v.dot(&dir);
        (v - dir * proj).norm() < TOLERANCE
    })
}

fn find_linear_axis(atoms: &[Atom]) -> Vector3<f64> {
    let p0 = &atoms[0].pos;
    for a in atoms.iter().skip(1) {
        let d = a.pos - p0;
        if d.norm() > TOLERANCE {
            return d.normalize();
        }
    }
    Vector3::x() // fallback
}

fn check_inversion(atoms: &[Atom]) -> bool {
    check_operation(atoms, |v| -v)
}

/// 检查给定变换是否为对称操作（映射原子集到自身）
fn check_operation(atoms: &[Atom], transform: impl Fn(&Vector3<f64>) -> Vector3<f64>) -> bool {
    for atom in atoms {
        let transformed = transform(&atom.pos);
        let found = atoms.iter().any(|other| {
            other.element == atom.element && (other.pos - transformed).norm() < TOLERANCE
        });
        if !found {
            return false;
        }
    }
    true
}

/// Rodrigues 旋转公式：绕单位轴 axis 旋转 angle 弧度
fn rotate_point(v: &Vector3<f64>, axis: &Vector3<f64>, angle: f64) -> Vector3<f64> {
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    v * cos_a + axis.cross(v) * sin_a + axis * axis.dot(v) * (1.0 - cos_a)
}

/// 镜面反射：通过法向量 normal 的平面
fn reflect_point(v: &Vector3<f64>, normal: &Vector3<f64>) -> Vector3<f64> {
    v - normal * (2.0 * v.dot(normal))
}

// ===== 对称操作搜索 =====

fn generate_candidate_directions(
    atoms: &[Atom],
    principal_axes: &[Vector3<f64>; 3],
) -> Vec<Vector3<f64>> {
    let mut dirs: Vec<Vector3<f64>> = Vec::new();

    // 1. 主轴方向
    for ax in principal_axes {
        if ax.norm() > 1e-10 {
            add_unique_dir(&mut dirs, ax.normalize());
        }
    }

    // 2. 坐标轴
    add_unique_dir(&mut dirs, Vector3::x());
    add_unique_dir(&mut dirs, Vector3::y());
    add_unique_dir(&mut dirs, Vector3::z());

    // 3. 每个原子位置向量（从质心出发）
    for atom in atoms {
        if atom.pos.norm() > TOLERANCE {
            add_unique_dir(&mut dirs, atom.pos.normalize());
        }
    }

    // 4. 同元素原子对的中点向量
    for i in 0..atoms.len() {
        for j in (i + 1)..atoms.len() {
            if atoms[i].element != atoms[j].element {
                continue;
            }
            let mid = (atoms[i].pos + atoms[j].pos) / 2.0;
            if mid.norm() > TOLERANCE * 0.5 {
                add_unique_dir(&mut dirs, mid.normalize());
            }
            // 连线方向
            let diff = atoms[i].pos - atoms[j].pos;
            if diff.norm() > TOLERANCE {
                add_unique_dir(&mut dirs, diff.normalize());
            }
        }
    }

    // 5. 原子位置向量的叉积
    let atom_dirs: Vec<Vector3<f64>> = atoms
        .iter()
        .filter(|a| a.pos.norm() > TOLERANCE)
        .map(|a| a.pos.normalize())
        .collect();
    let cross_limit = atom_dirs.len().min(20); // 限制组合爆炸
    for i in 0..cross_limit {
        for j in (i + 1)..cross_limit {
            let c = atom_dirs[i].cross(&atom_dirs[j]);
            if c.norm() > 1e-6 {
                add_unique_dir(&mut dirs, c.normalize());
            }
        }
    }

    dirs
}

fn add_unique_dir(dirs: &mut Vec<Vector3<f64>>, new_dir: Vector3<f64>) {
    // 方向向量去重：两个方向平行（或反平行）则视为重复
    for existing in dirs.iter() {
        let dot = existing.dot(&new_dir).abs();
        if dot > (1.0 - ANGLE_TOL) {
            return;
        }
    }
    dirs.push(new_dir);
}

fn find_rotation_axes(atoms: &[Atom], candidates: &[Vector3<f64>]) -> Vec<FoundAxis> {
    let mut axes: Vec<FoundAxis> = Vec::new();

    for dir in candidates {
        for order in [6u8, 5, 4, 3, 2] {
            let angle = 2.0 * PI / (order as f64);
            let is_cn = check_operation(atoms, |v| rotate_point(v, dir, angle));
            if is_cn {
                // 检查是否已有同方向同阶的轴
                let already = axes.iter().any(|a| {
                    a.order == order && a.dir.dot(dir).abs() > (1.0 - ANGLE_TOL)
                });
                if !already {
                    axes.push(FoundAxis {
                        dir: *dir,
                        order,
                    });
                }
            }
        }
    }

    // 按阶数降序排列
    axes.sort_by(|a, b| b.order.cmp(&a.order));
    axes
}

fn generate_candidate_planes(
    atoms: &[Atom],
    found_axes: &[FoundAxis],
    principal_axes: &[Vector3<f64>; 3],
) -> Vec<Vector3<f64>> {
    let mut normals: Vec<Vector3<f64>> = Vec::new();

    // 1. 每个旋转轴方向本身作为平面法向量（σh 垂直于主轴）
    for axis in found_axes {
        add_unique_dir(&mut normals, axis.dir);
    }

    // 2. 主轴方向
    for ax in principal_axes {
        if ax.norm() > 1e-10 {
            add_unique_dir(&mut normals, ax.normalize());
        }
    }

    // 3. 坐标轴方向
    add_unique_dir(&mut normals, Vector3::x());
    add_unique_dir(&mut normals, Vector3::y());
    add_unique_dir(&mut normals, Vector3::z());

    // 4. 原子位置向量
    for atom in atoms {
        if atom.pos.norm() > TOLERANCE {
            add_unique_dir(&mut normals, atom.pos.normalize());
        }
    }

    // 5. 同元素原子对的连线方向和中点方向
    for i in 0..atoms.len() {
        for j in (i + 1)..atoms.len() {
            if atoms[i].element != atoms[j].element {
                continue;
            }
            let diff = atoms[i].pos - atoms[j].pos;
            if diff.norm() > TOLERANCE {
                add_unique_dir(&mut normals, diff.normalize());
            }
            let mid = (atoms[i].pos + atoms[j].pos) / 2.0;
            if mid.norm() > TOLERANCE * 0.5 {
                add_unique_dir(&mut normals, mid.normalize());
            }
        }
    }

    // 6. 轴与原子位置的叉积（σv 平面包含旋转轴和原子）
    for axis in found_axes {
        for atom in atoms {
            if atom.pos.norm() > TOLERANCE {
                let c = axis.dir.cross(&atom.pos);
                if c.norm() > 1e-6 {
                    add_unique_dir(&mut normals, c.normalize());
                }
            }
        }
    }

    normals
}

fn find_mirror_planes(atoms: &[Atom], candidate_normals: &[Vector3<f64>]) -> Vec<FoundPlane> {
    let mut planes: Vec<FoundPlane> = Vec::new();

    for normal in candidate_normals {
        let is_mirror = check_operation(atoms, |v| reflect_point(v, normal));
        if is_mirror {
            let already = planes
                .iter()
                .any(|p| p.normal.dot(normal).abs() > (1.0 - ANGLE_TOL));
            if !already {
                planes.push(FoundPlane { normal: *normal });
            }
        }
    }

    planes
}

// ===== 点群分类 =====

fn classify_point_group(
    axes: &[FoundAxis],
    planes: &[FoundPlane],
    has_inversion: bool,
) -> String {
    let n_planes = planes.len();

    // 获取最高阶旋转轴
    let highest_order = axes.first().map(|a| a.order).unwrap_or(1);

    // 统计各阶轴数量
    let count_axes = |order: u8| -> usize {
        axes.iter().filter(|a| a.order == order).count()
    };

    let _n_c2 = count_axes(2);
    let n_c3 = count_axes(3);
    let n_c4 = count_axes(4);
    let n_c5 = count_axes(5);

    // ===== 高对称群检测 =====

    // 二十面体群：6 个 C5 轴
    if n_c5 >= 6 {
        return if has_inversion { "I_h" } else { "I" }.into();
    }

    // 八面体群：3 个 C4 轴
    if n_c4 >= 3 {
        return if has_inversion { "O_h" } else { "O" }.into();
    }

    // 四面体群：4 个 C3 轴且无 C4 以上
    if n_c3 >= 4 && highest_order <= 3 {
        if n_planes >= 6 {
            return "T_d".into();
        }
        return if has_inversion { "T_h" } else { "T" }.into();
    }

    // ===== 常规群 =====

    if highest_order == 1 {
        // 无旋转轴
        if n_planes > 0 {
            return "C_s".into();
        }
        if has_inversion {
            return "C_i".into();
        }
        return "C_1".into();
    }

    let n = highest_order;

    // 主轴方向
    let principal_dir = axes[0].dir;

    // 统计垂直于主轴的 C2 轴数量
    let perp_c2_count = axes
        .iter()
        .filter(|a| {
            a.order == 2 && a.dir.dot(&principal_dir).abs() < 0.3
        })
        .count();

    // 分类 σ_h（垂直于主轴的镜面）和 σ_v（包含主轴的镜面）
    let has_sigma_h = planes
        .iter()
        .any(|p| p.normal.dot(&principal_dir).abs() > 0.7);

    let sigma_v_count = planes
        .iter()
        .filter(|p| p.normal.dot(&principal_dir).abs() < 0.3)
        .count();

    if perp_c2_count >= n as usize {
        // D 族
        if has_sigma_h {
            return format!("D_{}h", n);
        }
        if sigma_v_count >= n as usize {
            return format!("D_{}d", n);
        }
        return format!("D_{}", n);
    }

    // C 族
    if has_sigma_h {
        return format!("C_{}h", n);
    }
    if sigma_v_count > 0 {
        return format!("C_{}v", n);
    }

    // S_2n 检测需要原子数据，不在纯分类函数中执行
    // 退化为 Cn
    format!("C_{}", n)
}

// ===== 渲染数据构建 =====

fn build_axis(dir: &Vector3<f64>, order: u8, mol_radius: f64) -> RotationAxis {
    let extend = mol_radius * 1.5;
    let start = -dir * extend;
    let end = dir * extend;

    RotationAxis {
        vector: Vec3D::from_v3(dir),
        center: Vec3D { x: 0.0, y: 0.0, z: 0.0 },
        order,
        start: Vec3D::from_v3(&start),
        end: Vec3D::from_v3(&end),
    }
}

fn build_plane(normal: &Vector3<f64>, mol_radius: f64) -> SymmetryPlane {
    let size = mol_radius * 1.8;

    // 构建平面内的两个正交基向量
    let u = find_perpendicular(normal).normalize();
    let v = normal.cross(&u).normalize();

    let vertices = [
        Vec3D::from_v3(&(u * size + v * size)),
        Vec3D::from_v3(&(u * size - v * size)),
        Vec3D::from_v3(&(-u * size - v * size)),
        Vec3D::from_v3(&(-u * size + v * size)),
    ];

    SymmetryPlane {
        normal: Vec3D::from_v3(normal),
        center: Vec3D { x: 0.0, y: 0.0, z: 0.0 },
        vertices,
    }
}

/// 找到与给定向量垂直的一个向量
fn find_perpendicular(v: &Vector3<f64>) -> Vector3<f64> {
    let candidate = if v.x.abs() < 0.9 {
        Vector3::x()
    } else {
        Vector3::y()
    };
    let perp = v.cross(&candidate);
    if perp.norm() < 1e-10 {
        v.cross(&Vector3::z())
    } else {
        perp
    }
}

// ===== 元素与质量 =====

fn normalize_element(raw: &str) -> String {
    let s: String = raw.chars().filter(|c| c.is_alphabetic()).collect();
    if s.is_empty() {
        return "X".into();
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap().to_uppercase().to_string();
    let rest: String = chars.take(1).map(|c| c.to_lowercase().next().unwrap()).collect();
    format!("{}{}", first, rest)
}

fn atomic_mass(element: &str) -> f64 {
    match element {
        "H" => 1.008,
        "He" => 4.003,
        "Li" => 6.941,
        "Be" => 9.012,
        "B" => 10.81,
        "C" => 12.011,
        "N" => 14.007,
        "O" => 15.999,
        "F" => 18.998,
        "Ne" => 20.180,
        "Na" => 22.990,
        "Mg" => 24.305,
        "Al" => 26.982,
        "Si" => 28.086,
        "P" => 30.974,
        "S" => 32.065,
        "Cl" => 35.453,
        "Ar" => 39.948,
        "K" => 39.098,
        "Ca" => 40.078,
        "Ti" => 47.867,
        "V" => 50.942,
        "Cr" => 51.996,
        "Mn" => 54.938,
        "Fe" => 55.845,
        "Co" => 58.933,
        "Ni" => 58.693,
        "Cu" => 63.546,
        "Zn" => 65.38,
        "Ga" => 69.723,
        "Ge" => 72.63,
        "As" => 74.922,
        "Se" => 78.971,
        "Br" => 79.904,
        "Kr" => 83.798,
        "Rb" => 85.468,
        "Sr" => 87.62,
        "Zr" => 91.224,
        "Mo" => 95.95,
        "Ru" => 101.07,
        "Rh" => 102.91,
        "Pd" => 106.42,
        "Ag" => 107.87,
        "Cd" => 112.41,
        "In" => 114.82,
        "Sn" => 118.71,
        "Sb" => 121.76,
        "Te" => 127.60,
        "I" => 126.90,
        "Xe" => 131.29,
        "Cs" => 132.91,
        "Ba" => 137.33,
        "La" => 138.91,
        "Pt" => 195.08,
        "Au" => 196.97,
        "Hg" => 200.59,
        "Pb" => 207.2,
        "Bi" => 208.98,
        "U" => 238.03,
        _ => 12.0, // 未知元素默认碳质量
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_water_c2v() {
        // 水分子 H2O 的 XYZ 格式
        let xyz = "3\nwater\nO  0.000  0.000  0.117\nH  0.000  0.757 -0.469\nH  0.000 -0.757 -0.469\n";
        let result = calculate(xyz, "xyz").unwrap();
        assert_eq!(result.point_group, "C_2v");
        assert!(!result.axes.is_empty());
        assert!(!result.planes.is_empty());
    }

    #[test]
    fn test_co2_linear() {
        let xyz = "3\nCO2\nC  0.000  0.000  0.000\nO  0.000  0.000  1.160\nO  0.000  0.000 -1.160\n";
        let result = calculate(xyz, "xyz").unwrap();
        assert_eq!(result.point_group, "D∞h");
        assert!(result.has_inversion);
    }

    #[test]
    fn test_single_atom() {
        let xyz = "1\nHe\nHe  0.0  0.0  0.0\n";
        let result = calculate(xyz, "xyz").unwrap();
        assert_eq!(result.point_group, "K_h");
    }

    #[test]
    fn test_normalize_element() {
        assert_eq!(normalize_element("FE"), "Fe");
        assert_eq!(normalize_element("h"), "H");
        assert_eq!(normalize_element("CA"), "Ca");
    }
}
