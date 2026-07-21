import * as PDFDocument from 'pdfkit';

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** AI-generated executive summary, prepended when present */
  aiSummary?: string;
}

/** RFC 4180 CSV: quote a field only when it needs it, double embedded quotes. */
function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ReportTable): string {
  const lines: string[] = [];
  if (table.aiSummary) {
    // Prepend summary as a comment-style header section before the data columns
    lines.push(csvEscape(`AI Summary: ${table.aiSummary}`));
    lines.push('');
  }
  lines.push(table.columns.map(csvEscape).join(','));
  for (const row of table.rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function columnWidths(table: ReportTable): number[] {
  return table.columns.map((col, i) =>
    Math.max(
      col.length,
      ...table.rows.map((row) => String(row[i] ?? '').length),
    ),
  );
}

function formatRow(cells: (string | number)[], widths: number[]): string {
  return cells.map((c, i) => String(c).padEnd(widths[i] + 2)).join('');
}

/**
 * A simple, dependency-light PDF: a title and a monospaced table, using
 * pdfkit's built-in Courier font (no external font assets, no browser/
 * Chromium dependency) so fixed-width column padding renders as an aligned
 * grid. Deliberately plain -- this is a scheduled data export, not a
 * designed document.
 */
export function toPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(table.title);
    doc.moveDown(0.75);

    if (table.aiSummary) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .text(table.aiSummary, { align: 'left' });
      doc.moveDown(0.75);
    }

    const widths = columnWidths(table);
    doc.font('Courier-Bold').fontSize(9);
    doc.text(formatRow(table.columns, widths));
    doc.font('Courier').fontSize(9);
    for (const row of table.rows) {
      doc.text(formatRow(row, widths));
    }
    if (table.rows.length === 0) {
      doc.font('Helvetica-Oblique').text('No data for this period.');
    }

    doc.end();
  });
}
