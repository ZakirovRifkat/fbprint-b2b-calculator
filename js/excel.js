// Выгрузка заявки в Excel.
import { state } from './state.js';
import { $, roundMoney } from './format.js';
import { urgencyLabels } from './pricing.js';
import { orderHasProblems } from './order.js';
import { toast } from './toast.js';

// ExcelJS (~950 КБ) грузится только при первой выгрузке, а не вместе со страницей.
export function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loadExcelJs.promise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'assets/vendor/exceljs.min.js';
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => {
      loadExcelJs.promise = null;
      script.remove();
      reject(new Error('Не удалось подготовить файл Excel: нет связи с сервером'));
    };
    document.head.append(script);
  });
  return loadExcelJs.promise;
}

// .xlsx с рамками: по листу на каждую компанию из заявки.
// Колонки: срочность, артикул, наименование, тираж, стоимость за штуку, итого;
// последняя — размер, скрыта: её можно развернуть в Excel при необходимости.
export async function buildOrderWorkbook() {
  const ExcelJS = await loadExcelJs();
  const book = new ExcelJS.Workbook();
  const companies = [...new Set(state.order.map(line => line.company))];
  companies.forEach(company => addCompanySheet(book, company, state.order.filter(line => line.company === company)));
  return book;
}

export function addCompanySheet(book, company, lines) {
  // Excel не разрешает в названии листа символы []:*?/\ и длину больше 31.
  const sheet = book.addWorksheet(company.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = [
    { header: 'Срок', key: 'urgency', width: 14 },
    { header: 'Артикул', key: 'sku', width: 11 },
    { header: 'Название', key: 'name', width: 60 },
    { header: 'Тираж', key: 'quantity', width: 12 },
    { header: 'Цена за шт.', key: 'unitPrice', width: 17 },
    { header: 'Итого', key: 'total', width: 16 },
    { header: 'Размер', key: 'size', width: 14, hidden: true }
  ];
  lines.forEach((line, index) => {
    const row = index + 2;
    sheet.addRow({
      urgency: urgencyLabels[line.urgency],
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: { formula: `ROUND(D${row}*E${row},2)`, result: line.total },
      size: line.size ?? ''
    });
  });
  const lastLine = lines.length + 1;
  const totalRow = sheet.addRow({
    unitPrice: 'Итого',
    total: { formula: `SUM(F2:F${lastLine})`, result: roundMoney(lines.reduce((sum, line) => sum + line.total, 0)) }
  });

  const border = { style: 'thin', color: { argb: 'FF9A97AD' } };
  sheet.eachRow(row => {
    for (let column = 1; column <= 7; column++) {
      const cell = row.getCell(column);
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { vertical: 'top', wrapText: column === 3 };
    }
  });
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEBF3' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.getColumn('quantity').numFmt = '#,##0';
  sheet.getColumn('unitPrice').numFmt = '#,##0.00 "₽"';
  sheet.getColumn('total').numFmt = '#,##0.00 "₽"';
  totalRow.font = { bold: true };
  totalRow.getCell('unitPrice').alignment = { horizontal: 'right' };
}

export async function orderFileBase64() {
  const bytes = new Uint8Array(await (await buildOrderWorkbook()).xlsx.writeBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export async function downloadExcel() {
  if (!state.order.length) {
    toast('Добавьте в заявку хотя бы одну позицию.');
    return;
  }
  if (orderHasProblems()) return;
  try {
    const book = await buildOrderWorkbook();
    const buffer = await book.xlsx.writeBuffer();
    const today = new Date();
    const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
      .map(part => String(part).padStart(2, '0'))
      .join('-');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    link.download = `fbprint-order-${date}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    toast('Файл Excel скачан.');
  } catch (error) {
    toast(`${error.message}. Попробуйте ещё раз.`, { persist: true });
  }
}
