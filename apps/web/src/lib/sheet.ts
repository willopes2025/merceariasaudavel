import Papa from 'papaparse';

export interface SheetTable {
  fileName: string;
  headers: string[];
  rows: unknown[][];
  /** Número da linha de cada registro no arquivo. */
  lines: number[];
}

/** Lê .xlsx ou .csv no próprio navegador. */
export async function readTable(file: File): Promise<SheetTable> {
  let table: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    table = (await readSheet(file)) as unknown as unknown[][];
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    table = Papa.parse<unknown[]>(await file.text(), { skipEmptyLines: 'greedy' }).data;
  } else {
    throw new Error('Use um arquivo .xlsx ou .csv. Planilha .xls antiga: abra no Excel e salve como .xlsx.');
  }
  const headerIndex = table.findIndex((r) => r.filter((c) => String(c ?? '').trim()).length >= 2);
  if (headerIndex < 0) throw new Error('Não achei o cabeçalho da planilha.');
  const headers = table[headerIndex]!.map((h) => String(h ?? '').trim());
  const rows: unknown[][] = [];
  const lines: number[] = [];
  table.forEach((r, i) => {
    if (i > headerIndex && r.some((c) => String(c ?? '').trim())) {
      rows.push(r);
      lines.push(i + 1);
    }
  });
  return { fileName: file.name, headers, rows, lines };
}

/** "Preço de Venda" → "preco de venda" */
export function headerKey(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function cellValue(value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'number' ? value : String(value).slice(0, 2000);
}
