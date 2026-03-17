/**
 * Spectroscopy data parsing utilities for CSV and JCAMP-DX (.jdx) files.
 */

import { convert } from "jcampconverter";

export interface SpectrumData {
  x: number[];
  y: number[];
  xLabel: string;
  yLabel: string;
  title: string;
  isNMR: boolean;
}

/**
 * Parse a CSV spectroscopy file.
 * Skips header/metadata lines (starting with #, %, or non-numeric),
 * then extracts x (col 0) and y (col 1) as float arrays.
 */
export function parseCSV(raw: string): SpectrumData {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let headerRow = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comment lines
    if (trimmed.startsWith("#") || trimmed.startsWith("%")) continue;

    // Detect delimiter
    const delimiter = trimmed.includes("\t") ? "\t" : ",";
    const parts = trimmed.split(delimiter).map((s) => s.trim());

    // If the first column is not a number, treat as header
    if (parts.length >= 2 && isNaN(parseFloat(parts[0]))) {
      headerRow = trimmed;
      continue;
    }

    if (parts.length >= 2) {
      dataLines.push(trimmed);
    }
  }

  if (dataLines.length === 0) {
    throw new Error("No numeric data rows found in CSV");
  }

  const delimiter = dataLines[0].includes("\t") ? "\t" : ",";
  const x: number[] = [];
  const y: number[] = [];

  for (const line of dataLines) {
    const parts = line.split(delimiter).map((s) => s.trim());
    const xVal = parseFloat(parts[0]);
    const yVal = parseFloat(parts[1]);
    if (!isNaN(xVal) && !isNaN(yVal)) {
      x.push(xVal);
      y.push(yVal);
    }
  }

  if (x.length === 0) {
    throw new Error("No valid data points extracted from CSV");
  }

  // Infer labels from header
  let xLabel = "X";
  let yLabel = "Y";
  if (headerRow) {
    const hDelim = headerRow.includes("\t") ? "\t" : ",";
    const headers = headerRow.split(hDelim).map((s) => s.trim());
    if (headers.length >= 2) {
      xLabel = headers[0];
      yLabel = headers[1];
    }
  }

  // Detect NMR: x range typically 0-15 ppm
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const isNMR = xMin >= -2 && xMax <= 220 && xMax - xMin < 250;

  return { x, y, xLabel, yLabel, title: "", isNMR };
}

/**
 * Parse a JCAMP-DX (.jdx) file using jcampconverter.
 */
export function parseJDX(raw: string): SpectrumData {
  const result = convert(raw, { noContour: true });

  if (!result.spectra || result.spectra.length === 0) {
    throw new Error("No spectra found in JDX file");
  }

  const spectrum = result.spectra[0];
  const x: number[] = [];
  const y: number[] = [];

  if (spectrum.data && spectrum.data.length > 0) {
    // jcampconverter returns data as array of {x: [], y: []}
    const block = spectrum.data[0];
    if (block.x && block.y) {
      x.push(...block.x);
      y.push(...block.y);
    }
  }

  if (x.length === 0) {
    throw new Error("No data points extracted from JDX file");
  }

  const xLabel = spectrum.xUnits || "X";
  const yLabel = spectrum.yUnits || "Y";
  const title = spectrum.title || result.title || "";

  // Detect NMR from data type or units
  const dataType = (spectrum.dataType || "").toLowerCase();
  const xUnitsLower = xLabel.toLowerCase();
  const isNMR =
    dataType.includes("nmr") ||
    xUnitsLower.includes("ppm") ||
    xUnitsLower.includes("chemical shift");

  return { x, y, xLabel, yLabel, title, isNMR };
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
