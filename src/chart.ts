import type { Kline } from "./binance";

export type ChartRange = "24h" | "1W" | "1M" | "1Y" | "ALL";

export type ChartHalves = {
  left: Uint8Array;
  right: Uint8Array;
};

// Draws a price-line trend chart. NO text is rendered into the canvas — all
// labels are displayed via LVGL text containers in main.ts so they match the
// embedded firmware font of the rest of the UI.
export async function renderChartHalves(
  klines: Kline[],
  totalWidth: number,
  height: number
): Promise<ChartHalves> {
  const halfWidth = Math.floor(totalWidth / 2);
  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { left: new Uint8Array(0), right: new Uint8Array(0) };
  }

  drawChart(ctx, klines, totalWidth, height);

  const left = await sliceToPng(canvas, 0, halfWidth, height);
  const right = await sliceToPng(canvas, halfWidth, halfWidth, height);
  return { left, right };
}

// The Y-axis labels live in their own 100px strip OUTSIDE this canvas
// (placed by main.ts as LVGL text containers in the gap between the
// right chart image and the screen edge). So the canvas itself uses its
// full width for the plot — no internal gutter needed.

function drawChart(
  ctx: CanvasRenderingContext2D,
  klines: Kline[],
  width: number,
  height: number
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  if (klines.length < 2) return;

  let min = Infinity;
  let max = -Infinity;
  for (const k of klines) {
    if (k.close < min) min = k.close;
    if (k.close > max) max = k.close;
  }
  if (max === min) {
    max = min === 0 ? 1 : min * 1.001;
  }

  const PAD = 8;
  const plotX = PAD;
  const plotY = PAD;
  const plotW = width - PAD * 2;
  const plotH = height - PAD * 2;

  // Dashed L-frame: right axis + bottom axis. No text — Y-axis labels
  // are LVGL text containers placed in the right gutter.
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(plotX + plotW, plotY);
  ctx.lineTo(plotX + plotW, plotY + plotH);
  ctx.lineTo(plotX, plotY + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Price line.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < klines.length; i++) {
    const x = plotX + (i / (klines.length - 1)) * plotW;
    const y = plotY + plotH - ((klines[i].close - min) / (max - min)) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

async function sliceToPng(
  source: HTMLCanvasElement,
  sourceX: number,
  width: number,
  height: number
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array(0);
  ctx.drawImage(source, sourceX, 0, width, height, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) return new Uint8Array(0);
  return new Uint8Array(await blob.arrayBuffer());
}
