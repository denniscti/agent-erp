/**
 * Pure helper utilities for Sales Orders UI & Shipment validation (Issue #221)
 */

export const STOCK_TOLERANCE = 1e-9;

export function formatOrderQty(q) {
  const num = Number(q);
  if (!Number.isFinite(num)) return '0';
  const rounded = Math.round(num * 1_000_000) / 1_000_000;
  if (Math.abs(rounded) < STOCK_TOLERANCE) return '0';
  if (Math.abs(rounded - Math.round(rounded)) < STOCK_TOLERANCE) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(6).replace(/\.?0+$/, '');
}

export function getSalesOrderStatusLabel(status) {
  switch (status) {
    case 'confirmed':
      return '已確認';
    case 'partially_shipped':
      return '部分出貨';
    case 'shipped':
      return '已出貨';
    case 'cancelled':
      return '已取消';
    default:
      return status || '未知';
  }
}

export function getSalesOrderStatusBadgeClass(status) {
  switch (status) {
    case 'confirmed':
      return 'badge-so-confirmed';
    case 'partially_shipped':
      return 'badge-so-partial';
    case 'shipped':
      return 'badge-so-shipped';
    case 'cancelled':
      return 'badge-so-cancelled';
    default:
      return 'badge-so-default';
  }
}

export function isSalesOrderTerminal(order) {
  return Boolean(order && (order.status === 'shipped' || order.status === 'cancelled'));
}

export function canShipSalesOrder(order) {
  return Boolean(order && (order.status === 'confirmed' || order.status === 'partially_shipped'));
}

export function canCancelSalesOrder(order) {
  return Boolean(order && order.status === 'confirmed');
}

/**
 * Validate YYYY-MM-DD calendar date string (mirrors backend parse_date + not-in-future rule)
 * @param {string | null | undefined} shipDate
 * @param {string} todayStr
 * @returns {{ valid: boolean, resolvedDate: string, error: string | null }}
 */
export function validateShipDate(shipDate, todayStr) {
  const trimmed = shipDate === null || shipDate === undefined ? '' : String(shipDate).trim();
  if (!trimmed) {
    return { valid: true, resolvedDate: todayStr, error: null };
  }
  const parts = trimmed.split('-');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) {
    return { valid: false, resolvedDate: trimmed, error: '日期格式需為 YYYY-MM-DD' };
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return { valid: false, resolvedDate: trimmed, error: '無效的日期數值' };
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, resolvedDate: trimmed, error: '無效的日期數值' };
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) {
    return { valid: false, resolvedDate: trimmed, error: '日期超出該月份天數' };
  }
  if (todayStr && trimmed > todayStr) {
    return { valid: false, resolvedDate: trimmed, error: '出貨日不可晚於今天' };
  }
  return { valid: true, resolvedDate: trimmed, error: null };
}

/**
 * Initialize shipment modal rows with shipped_quantity defaulting to remaining unshipped quantity
 * @param {Array<any>} lines
 * @param {Record<string, number | null | undefined>} [stockByUnitId]
 */
export function buildInitialShipLines(lines, stockByUnitId = {}) {
  return (lines || []).map((l, idx) => {
    const ordered = Number(l.quantity);
    const alreadyShipped = Number(l.shipped_quantity || 0);
    const remaining = Math.max(0, Math.round((ordered - alreadyShipped) * 1_000_000) / 1_000_000);
    const hasStock = Object.prototype.hasOwnProperty.call(stockByUnitId, l.unit_id) &&
      stockByUnitId[l.unit_id] !== null &&
      stockByUnitId[l.unit_id] !== undefined;
    return {
      line_id: l.id,
      line_no: l.line_no ?? idx + 1,
      unit_id: l.unit_id,
      product_name_snapshot: l.product_name_snapshot,
      variant_name_snapshot: l.variant_name_snapshot || '單一規格',
      unit_name_snapshot: l.unit_name_snapshot,
      ordered_quantity: ordered,
      already_shipped: alreadyShipped,
      remaining_quantity: remaining,
      shipped_quantity: remaining,
      available_stock: hasStock ? Number(stockByUnitId[l.unit_id]) : null
    };
  });
}

/**
 * Evaluate real-time stock insufficiency & line validation before shipment submission
 * @param {Array<any>} shipLines
 * @param {string} [warehouseName]
 */
export function evaluateShipLines(shipLines, warehouseName = '') {
  const whDisplay = warehouseName || '出貨倉庫';
  const lineStates = [];
  const insufficientLines = [];
  let totalShipped = 0;
  let hasInvalidLineQty = false;

  for (const line of shipLines || []) {
    const rawVal = line.shipped_quantity;
    const isEmpty = rawVal === '' || rawVal === null || rawVal === undefined;
    const qty = isEmpty ? NaN : Number(rawVal);
    const ordered = Number(line.ordered_quantity ?? line.quantity ?? 0);
    const alreadyShipped = Number(line.already_shipped ?? 0);
    const remaining = line.remaining_quantity !== undefined && line.remaining_quantity !== null
      ? Number(line.remaining_quantity)
      : Math.max(0, ordered - alreadyShipped);
    const hasStockKnown = line.available_stock !== null && line.available_stock !== undefined && Number.isFinite(Number(line.available_stock));
    const availableStock = hasStockKnown ? Number(line.available_stock) : null;

    const isInvalidNumber = !Number.isFinite(qty);
    const isNegative = !isInvalidNumber && qty < 0;
    const isOverOrdered = !isInvalidNumber && qty > remaining + STOCK_TOLERANCE;

    let inlineError = null;
    if (isInvalidNumber) {
      inlineError = '請輸入有效數量';
      hasInvalidLineQty = true;
    } else if (isNegative) {
      inlineError = '出貨數量不可小於 0';
      hasInvalidLineQty = true;
    } else if (isOverOrdered) {
      inlineError = alreadyShipped <= STOCK_TOLERANCE
        ? '出貨數量不可超過訂購數量'
        : '出貨數量不可超過剩餘可出貨數量';
      hasInvalidLineQty = true;
    } else {
      totalShipped += qty;
    }

    const isInsufficientStock =
      !isInvalidNumber &&
      !isNegative &&
      !isOverOrdered &&
      qty > 0 &&
      availableStock !== null &&
      availableStock + STOCK_TOLERANCE < qty;

    const shortageQty = isInsufficientStock ? Math.max(0, qty - availableStock) : 0;
    let insufficientMessage = null;
    if (isInsufficientStock) {
      insufficientMessage = `〔${line.product_name_snapshot}／${line.variant_name_snapshot}／${line.unit_name_snapshot}〕在〔${whDisplay}〕現有 ${formatOrderQty(availableStock)}，不足出貨 ${formatOrderQty(qty)}`;
      insufficientLines.push({
        line_id: line.line_id,
        unit_id: line.unit_id,
        product_name_snapshot: line.product_name_snapshot,
        variant_name_snapshot: line.variant_name_snapshot,
        unit_name_snapshot: line.unit_name_snapshot,
        available_stock: availableStock,
        requested_qty: qty,
        shortage_qty: shortageQty,
        message: insufficientMessage
      });
    }

    lineStates.push({
      line_id: line.line_id,
      qty,
      ordered,
      alreadyShipped,
      remaining,
      availableStock,
      isInvalidNumber,
      isNegative,
      isOverOrdered,
      inlineError,
      isInsufficientStock,
      shortageQty,
      insufficientMessage
    });
  }

  const hasZeroTotal = !hasInvalidLineQty && totalShipped <= 0;
  const hasInsufficientStock = insufficientLines.length > 0;
  const canSubmit = !hasInvalidLineQty && !hasZeroTotal && !hasInsufficientStock;

  let blockingError = null;
  if (hasInvalidLineQty) {
    const firstInvalid = lineStates.find(s => s.inlineError);
    blockingError = firstInvalid ? firstInvalid.inlineError : '請檢查出貨數量輸入';
  } else if (hasZeroTotal) {
    blockingError = '出貨數量合計需大於 0';
  } else if (hasInsufficientStock) {
    blockingError = insufficientLines[0].message;
  }

  return {
    lineStates,
    insufficientLines,
    totalShipped,
    hasInvalidLineQty,
    hasZeroTotal,
    hasInsufficientStock,
    canSubmit,
    blockingError
  };
}

/**
 * Build payload compatible with both Tauri Rust commands and mock IPC
 */
export function buildShipOrderPayload(orderId, shipDate, shipLines, todayOverride = undefined, note = undefined) {
  const quantities = (shipLines || []).map(l => ({
    line_id: l.line_id,
    shipped_quantity: Number(l.shipped_quantity)
  }));
  const payload = {
    order_id: orderId,
    orderId: orderId,
    line_shipped_quantities: quantities,
    lineShippedQuantities: quantities
  };
  if (shipDate && String(shipDate).trim()) {
    const d = String(shipDate).trim();
    payload.ship_date = d;
    payload.shipDate = d;
  }
  if (note && String(note).trim()) {
    payload.note = String(note).trim();
  }
  if (todayOverride && String(todayOverride).trim()) {
    const t = String(todayOverride).trim();
    payload.today_override = t;
    payload.todayOverride = t;
  }
  return payload;
}

