/**
 * Spectroscopy data parsing utilities for CSV and JCAMP-DX (.jdx) files.
 * Supports multi-column instrument exports (e.g. multiple scans in one file).
 */

import { convert } from "jcampconverter";

export interface SpectrumSeries {
  y: number[];
  label: string;
}

export interface SpectrumData {
  x: number[];
  series: SpectrumSeries[];
  xLabel: string;
  title: string;
  isNMR: boolean;
}

/**
 * Parse a CSV spectroscopy file.
 * Supports multi-column: col 0 = x, col 1..N = y series.
 */
export function parseCSV(raw: string): SpectrumData {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let headerRow = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("%")) continue;

    const delimiter = trimmed.includes("\t") ? "\t" : ",";
    const parts = trimmed.split(delimiter).map((s) => s.trim());

    if (parts.length >= 2 && isNaN(parseFloat(parts[0]))) {
      headerRow = trimmed;
      continue;
    }

    if (parts.length >= 2) {
      dataLines.push(trimmed);
    }
  }

  if (dataLines.length === 0) {
    throw new Error("CSV 中未找到有效的数值数据行");
  }

  const delimiter = dataLines[0].includes("\t") ? "\t" : ",";
  const firstParts = dataLines[0].split(delimiter);
  const colCount = firstParts.length;

  const x: number[] = [];
  const columns: number[][] = [];
  for (let c = 1; c < colCount; c++) {
    columns.push([]);
  }

  for (const line of dataLines) {
    const parts = line.split(delimiter).map((s) => s.trim());
    const xVal = parseFloat(parts[0]);
    if (isNaN(xVal)) continue;
    x.push(xVal);
    for (let c = 1; c < colCount; c++) {
      const val = c < parts.length ? parseFloat(parts[c]) : NaN;
      columns[c - 1].push(isNaN(val) ? 0 : val);
    }
  }

  if (x.length === 0) {
    throw new Error("无法从 CSV 中提取有效数据点");
  }

  // Infer labels from header
  let xLabel = "X";
  const yLabels: string[] = [];
  if (headerRow) {
    const hDelim = headerRow.includes("\t") ? "\t" : ",";
    const headers = headerRow.split(hDelim).map((s) => s.trim());
    if (headers.length >= 2) {
      xLabel = headers[0];
      for (let c = 1; c < headers.length; c++) {
        yLabels.push(headers[c]);
      }
    }
  }

  const series: SpectrumSeries[] = columns.map((col, i) => ({
    y: col,
    label: yLabels[i] || `Series ${i + 1}`,
  }));

  // Detect NMR: x range typically 0–15 ppm
  const xMin = Math.min(...x.slice(0, 100));
  const xMax = Math.max(...x.slice(0, 100));
  const isNMR = xMin >= -2 && xMax <= 220 && xMax - xMin < 250;

  return { x, series, xLabel, title: "", isNMR };
}

/**
 * Parse a JCAMP-DX (.jdx) file using jcampconverter.
 */
export function parseJDX(raw: string): SpectrumData {
  const result = convert(raw, { noContour: true });

  if (!result.spectra || result.spectra.length === 0) {
    throw new Error("JDX 文件中未找到波谱数据");
  }

  const spectrum = result.spectra[0];
  const x: number[] = [];
  const series: SpectrumSeries[] = [];

  if (spectrum.data && spectrum.data.length > 0) {
    const block = spectrum.data[0];
    if (block.x && block.y) {
      x.push(...block.x);
      series.push({ y: [...block.y], label: spectrum.yUnits || "Y" });
    }
  }

  if (x.length === 0) {
    throw new Error("无法从 JDX 文件中提取数据点");
  }

  const xLabel = spectrum.xUnits || "X";
  const title = spectrum.title || result.title || "";

  const dataType = (spectrum.dataType || "").toLowerCase();
  const xUnitsLower = xLabel.toLowerCase();
  const isNMR =
    dataType.includes("nmr") ||
    xUnitsLower.includes("ppm") ||
    xUnitsLower.includes("chemical shift");

  return { x, series, xLabel, title, isNMR };
}

/**
 * Auto-detect format and parse spectroscopy data.
 */
export function parseSpectroscopy(
  raw: string,
  extension: string,
): SpectrumData {
  const ext = extension.toLowerCase();
  if (ext === "jdx") {
    return parseJDX(raw);
  }
  return parseCSV(raw);
}
