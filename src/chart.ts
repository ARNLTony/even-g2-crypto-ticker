import type { Kline } from "./binance";
import { formatPrice } from "./format";

export type ChartRange = "24h" | "1W" | "1M" | "1Y" | "ALL";

const RANGE_LABEL: Record<ChartRange, string> = {
  "24h": "-24h",
  "1W": "-7d",
  "1M": "-30d",
  "1Y": "-1y",
  "ALL": "ALL",
};

function leftAxisLabel(range: ChartRange, klines: Kline[]): string {
  if (range === "ALL" && klines.length > 0) {
    return String(new Date(klines[0].openTime).getFullYear());
  }
  return RANGE_LABEL[range];
}

export type ChartHalves = {
  left: Uint8Array;
  right: Uint8Array;
};

export async function renderChartHalves(
  klines: Kline[],
  range: ChartRange,
  totalWidth: number,
  height: number,
  locale: string,
  quoteLabel: string
): Promise<ChartHalves> {
  const halfWidth = Math.floor(totalWidth / 2);
  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { left: new Uint8Array(0), right: new Uint8Array(0) };
  }

  drawChart(ctx, klines, range, totalWidth, height, locale, quoteLabel);

  const left = await sliceToPng(canvas, 0, halfWidth, height);
  const right = await sliceToPng(canvas, halfWidth, halfWidth, height);
  return { left, right };
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  klines: Kline[],
  range: ChartRange,
  width: number,
  height: number,
  locale: string,
  quoteLabel: string
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

  const RIGHT_LABEL_W = 180;
  const X_LABEL_H = 20;
  const PAD = 8;

  const plotX = PAD;
  const plotY = PAD;
  const plotW = width - RIGHT_LABEL_W - PAD;
  const plotH = height - X_LABEL_H - PAD * 2;

  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(plotX + plotW, plotY);
  ctx.lineTo(plotX + plotW, plotY + plotH);
  ctx.lineTo(plotX, plotY + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

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

  ctx.fillStyle = "#ffffff";
  ctx.font = "18px sans-serif";

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(
    `${formatPrice(max, locale)} ${quoteLabel}`,
    plotX + plotW + 4,
    plotY + 2
  );

  ctx.textBaseline = "bottom";
  ctx.fillText(
    `${formatPrice(min, locale)} ${quoteLabel}`,
    plotX + plotW + 4,
    plotY + plotH
  );

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(leftAxisLabel(range, klines), plotX, plotY + plotH + 4);

  ctx.textAlign = "right";
  ctx.fillText("now", plotX + plotW, plotY + plotH + 4);
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
