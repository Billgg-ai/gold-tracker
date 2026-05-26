const $ = (id) => document.getElementById(id);

const state = {
  loadedAt: null,
  gold: [],
  silver: [],
  copper: [],
  gvz: [],
  macro: {},
  metrics: {},
};

if (window.location.protocol === "file:") {
  const message = "请通过本地服务打开页面：在项目目录运行 node server.js，然后访问 http://localhost:4173。";
  window.addEventListener("DOMContentLoaded", () => {
    $("dataStatus").textContent = message;
  });
  throw new Error(message);
}

const marketSymbols = {
  gold: { secid: "101.GC00Y", name: "COMEX黄金主连" },
  silver: { secid: "101.SI00Y", name: "COMEX白银主连" },
  copper: { secid: "101.HG00Y", name: "COMEX铜主连" },
};

const macroSeries = [
  { id: "DFII10", name: "10年实际利率", unit: "%", hint: "实际利率上行通常压制黄金估值" },
  { id: "DGS10", name: "10年美债收益率", unit: "%", hint: "名义利率与美元流动性压力" },
  { id: "T10YIE", name: "10年通胀预期", unit: "%", hint: "衡量长期通胀补偿" },
  { id: "CPIAUCSL", name: "CPI同比", unit: "%", transform: "yoy", hint: "通胀韧性影响实际利率路径" },
  { id: "DFF", name: "联邦基金利率", unit: "%", hint: "货币政策紧缩或宽松程度" },
  { id: "PAYEMS", name: "非农月变动", unit: "万人", transform: "mom10k", hint: "就业走弱通常提升降息预期" },
  { id: "UNRATE", name: "失业率", unit: "%", hint: "劳动力市场温度计" },
  { id: "DTWEXBGS", name: "美元广义指数", unit: "", hint: "美元走强通常压制黄金" },
];

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${formatNumber(value, digits)}%`;
}

function toDate(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(text || response.statusText);
  return JSON.parse(text);
}

async function fetchYahooSeries(symbols, label) {
  const errors = [];
  for (const symbol of symbols) {
    try {
      const json = await fetchJson(`/api/yahoo?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`);
      const result = json.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const series = timestamps
        .map((ts, index) => ({ date: toDate(ts), value: Number(closes[index]) }))
        .filter((point) => Number.isFinite(point.value) && point.value > 0);
      if (series.length > 30) return { symbol, series };
      errors.push(`${symbol}: 数据不足`);
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }
  throw new Error(`${label} 数据加载失败。${errors.join("; ")}`);
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function fetchEastmoneySeries(config, label) {
  const begDate = new Date();
  begDate.setFullYear(begDate.getFullYear() - 3);
  const response = await fetch(`/api/eastmoney-kline?secid=${encodeURIComponent(config.secid)}&beg=${ymd(begDate)}&end=20500101`);
  const json = await response.json();
  if (!response.ok || json.rc !== 0 || !json.data?.klines?.length) {
    throw new Error(`${label} 数据加载失败`);
  }
  const series = json.data.klines
    .map((line) => {
      const [date, open, close, high, low, volume, amount, amplitude] = line.split(",");
      return {
        date,
        value: Number(close),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        amplitude: Number(amplitude),
      };
    })
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
  return { symbol: json.data.name || config.name, series };
}

async function fetchFredSeries(id) {
  const response = await fetch(`/api/fred?id=${encodeURIComponent(id)}`);
  const text = await response.text();
  if (!response.ok) throw new Error(text || response.statusText);
  const lines = text.trim().split(/\r?\n/).slice(1);
  return lines
    .map((line) => {
      const [date, raw] = line.split(",");
      const value = raw === "." ? NaN : Number(raw);
      return { date, value };
    })
    .filter((point) => Number.isFinite(point.value));
}

function last(series) {
  return series[series.length - 1];
}

function pctChange(series, days = 1) {
  if (series.length <= days) return NaN;
  const a = series[series.length - 1 - days]?.value;
  const b = series[series.length - 1]?.value;
  return ((b - a) / a) * 100;
}

function sma(series, length) {
  if (series.length < length) return NaN;
  const slice = series.slice(-length);
  return slice.reduce((sum, point) => sum + point.value, 0) / length;
}

function realizedVol(series, length = 20) {
  if (series.length <= length) return NaN;
  const slice = series.slice(-length - 1);
  const returns = [];
  for (let i = 1; i < slice.length; i += 1) {
    returns.push(Math.log(slice[i].value / slice[i - 1].value));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function makeRatio(base, other) {
  const map = new Map(other.map((point) => [point.date, point.value]));
  return base
    .map((point) => {
      const denominator = map.get(point.date);
      return denominator ? { date: point.date, value: point.value / denominator } : null;
    })
    .filter(Boolean);
}

function normalize(series) {
  const first = series.find((point) => Number.isFinite(point.value))?.value;
  return series.map((point) => ({ ...point, value: first ? (point.value / first) * 100 : NaN }));
}

function latestTransformed(series, transform) {
  if (!series.length) return { value: NaN, change: NaN, date: "" };
  if (transform === "yoy") {
    const current = last(series);
    const yearAgoIndex = Math.max(0, series.length - 13);
    const yearAgo = series[yearAgoIndex];
    return { value: ((current.value - yearAgo.value) / yearAgo.value) * 100, change: NaN, date: current.date };
  }
  if (transform === "mom10k") {
    const current = last(series);
    const previous = series[series.length - 2];
    return { value: (current.value - previous.value) / 10, change: NaN, date: current.date };
  }
  const current = last(series);
  const previous = series[series.length - 2];
  return { value: current.value, change: previous ? current.value - previous.value : NaN, date: current.date };
}

function drawLineChart(canvas, datasets, options = {}) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = Number(canvas.getAttribute("height")) * ratio;
  ctx.scale(ratio, ratio);

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { top: 18, right: 18, bottom: 30, left: 48 };
  ctx.clearRect(0, 0, width, height);

  const all = datasets.flatMap((dataset) => dataset.data).filter((point) => Number.isFinite(point.value));
  if (!all.length) {
    ctx.fillStyle = "#666158";
    ctx.fillText("暂无数据", pad.left, height / 2);
    return;
  }

  const min = options.min ?? Math.min(...all.map((point) => point.value));
  const max = options.max ?? Math.max(...all.map((point) => point.value));
  const span = max - min || 1;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const longest = Math.max(...datasets.map((dataset) => dataset.data.length));

  ctx.strokeStyle = "#e0d8ca";
  ctx.lineWidth = 1;
  ctx.font = "12px Segoe UI, Microsoft YaHei, Arial";
  ctx.fillStyle = "#666158";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const label = max - (span * i) / 4;
    ctx.fillText(options.percentAxis ? `${formatNumber(label, 1)}%` : formatNumber(label, 1), 6, y + 4);
  }

  datasets.forEach((dataset) => {
    ctx.beginPath();
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = dataset.width || 2;
    dataset.data.forEach((point, index) => {
      const x = pad.left + (plotW * index) / Math.max(1, longest - 1);
      const y = pad.top + plotH - ((point.value - min) / span) * plotH;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const tail = dataset.data[dataset.data.length - 1];
    if (tail) {
      const x = pad.left + (plotW * (dataset.data.length - 1)) / Math.max(1, longest - 1);
      const y = pad.top + plotH - ((tail.value - min) / span) * plotH;
      ctx.fillStyle = dataset.color;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  let legendX = pad.left;
  datasets.forEach((dataset) => {
    ctx.fillStyle = dataset.color;
    ctx.fillRect(legendX, height - 18, 12, 3);
    ctx.fillStyle = "#4c473f";
    ctx.fillText(dataset.name, legendX + 18, height - 14);
    legendX += ctx.measureText(dataset.name).width + 52;
  });
}

function drawBarChart(canvas, bars) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = Number(canvas.getAttribute("height")) * ratio;
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { top: 20, right: 20, bottom: 40, left: 44 };
  ctx.clearRect(0, 0, width, height);

  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)));
  const zeroY = pad.top + (height - pad.top - pad.bottom) / 2;
  ctx.strokeStyle = "#d8d0c2";
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(width - pad.right, zeroY);
  ctx.stroke();

  const barW = (width - pad.left - pad.right) / bars.length - 30;
  bars.forEach((bar, index) => {
    const center = pad.left + ((width - pad.left - pad.right) * (index + 0.5)) / bars.length;
    const h = (Math.abs(bar.value) / maxAbs) * ((height - pad.top - pad.bottom) / 2 - 10);
    const y = bar.value >= 0 ? zeroY - h : zeroY;
    ctx.fillStyle = bar.value >= 0 ? "#2f8f63" : "#b84c43";
    ctx.fillRect(center - barW / 2, y, barW, h);
    ctx.fillStyle = "#4c473f";
    ctx.font = "12px Segoe UI, Microsoft YaHei, Arial";
    ctx.textAlign = "center";
    ctx.fillText(bar.label, center, height - 17);
    ctx.fillText(formatPct(bar.value), center, bar.value >= 0 ? y - 7 : y + h + 16);
  });
  ctx.textAlign = "left";
}

function renderMetrics() {
  const goldLast = last(state.gold);
  const gvzLast = last(state.gvz);
  const m = state.metrics;
  const cards = [
    ["最新金价", `$${formatNumber(goldLast?.value)}`, `${goldLast?.date || "--"}，日变动 ${formatPct(pctChange(state.gold))}`],
    ["近20日已实现波动率", `${formatNumber(m.rv20)}%`, "作为短期隐含波动率的辅助参照"],
    ["GVZ指数", formatNumber(gvzLast?.value), state.gvz.length ? `20日变化 ${formatPct(pctChange(state.gvz, Math.min(20, state.gvz.length - 1)))}` : "FRED GVZCLS 暂无数据"],
    ["20日 / 50日乖离率", `${formatPct(m.bias20)} / ${formatPct(m.bias50)}`, `SMA20 ${formatNumber(m.sma20)}，SMA50 ${formatNumber(m.sma50)}`],
  ];
  $("metricGrid").innerHTML = cards
    .map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`)
    .join("");
}

function renderReadout() {
  const m = state.metrics;
  const items = [
    ["3年涨跌幅", formatPct(pctChange(state.gold, state.gold.length - 1))],
    ["20日涨跌幅", formatPct(pctChange(state.gold, Math.min(20, state.gold.length - 1)))],
    ["金铜比", formatNumber(last(m.goldCopper)?.value, 2)],
    ["金银比", formatNumber(last(m.goldSilver)?.value, 2)],
    ["广义贸易加权美元指数", formatNumber(state.macro.DTWEXBGS?.value, 2)],
    ["实际利率", `${formatNumber(state.macro.DFII10?.value, 2)}%`],
  ];
  $("readout").innerHTML = items.map(([term, desc]) => `<div><dt>${term}</dt><dd>${desc}</dd></div>`).join("");
}

function scoreSignal() {
  const m = state.metrics;
  const macro = state.macro;
  const factors = [
    { name: "趋势", value: clamp((m.bias20 + m.bias50) / 12, -1, 1), note: "乖离率" },
    { name: "波动", value: clamp((24 - (last(state.gvz)?.value || m.rv20)) / 18, -1, 1), note: "GVZ/已实现波动" },
    { name: "实际利率", value: clamp(-(macro.DFII10?.change ?? 0) / 0.35, -1, 1), note: "近期变化" },
    { name: "通胀", value: clamp(((macro.CPIAUCSL?.value ?? 2.5) - 2.2) / 2, -1, 1), note: "CPI同比" },
    { name: "美元", value: clamp(-(macro.DTWEXBGS?.change ?? 0) / 2.5, -1, 1), note: "广义贸易加权美元指数变化" },
    { name: "就业", value: clamp((18 - (macro.PAYEMS?.value ?? 18)) / 22, -1, 1), note: "非农月变动" },
  ];
  const raw = factors.reduce((sum, factor) => sum + factor.value, 0) / factors.length;
  const score = Math.round((raw + 1) * 50);
  let label = "持有";
  if (score >= 76) label = "买入";
  else if (score >= 61) label = "加仓";
  else if (score <= 24) label = "卖出";
  else if (score <= 39) label = "减仓";
  return { score, label, factors };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function renderSignal() {
  const signal = scoreSignal();
  const deg = Math.round(signal.score * 3.6);
  $("signalRing").textContent = signal.score;
  $("signalRing").style.background = `conic-gradient(var(--gold) ${deg}deg, var(--line) ${deg}deg)`;
  $("signalLabel").textContent = signal.label;
  $("signalText").textContent = "基于趋势、波动、利率、通胀、美元与就业的本地评分";
  $("scoreLines").innerHTML = signal.factors
    .map((factor) => {
      const pct = Math.round((factor.value + 1) * 50);
      return `<div class="score-line"><span>${factor.name}</span><span class="bar"><i style="width:${pct}%"></i></span><b>${pct}</b></div>`;
    })
    .join("");
  state.metrics.localSignal = signal;
}

function renderMacro() {
  $("macroGrid").innerHTML = macroSeries
    .map((item) => {
      const m = state.macro[item.id] || {};
      const value = `${formatNumber(m.value, item.id === "PAYEMS" ? 1 : 2)}${item.unit}`;
      const change = Number.isFinite(m.change) ? `较前值 ${m.change > 0 ? "+" : ""}${formatNumber(m.change, 2)}${item.unit}` : m.date || "";
      return `<article class="macro-card"><span>${item.name}</span><strong>${value}</strong><small>${change}<br>${item.hint}</small></article>`;
    })
    .join("");
}

function renderCharts() {
  drawLineChart($("goldChart"), [{ name: "Gold Futures", color: "#c89422", data: state.gold }]);
  drawLineChart($("volChart"), [
    { name: "GVZ", color: "#386ea8", data: state.gvz.slice(-20) },
    { name: "20日已实现波动率", color: "#c89422", data: state.metrics.rvPath.slice(-20) },
  ], { percentAxis: false });
  drawLineChart($("ratioChart"), [
    { name: "金铜比", color: "#a7653e", data: normalize(state.metrics.goldCopper) },
    { name: "金银比", color: "#386ea8", data: normalize(state.metrics.goldSilver) },
  ]);
}

function calculateMetrics() {
  const latestGold = last(state.gold)?.value;
  const sma20 = sma(state.gold, 20);
  const sma50 = sma(state.gold, 50);
  const rvPath = state.gold.map((point, index, source) => ({
    date: point.date,
    value: index > 20 ? realizedVol(source.slice(0, index + 1), 20) : NaN,
  })).filter((point) => Number.isFinite(point.value));

  state.metrics = {
    sma20,
    sma50,
    bias20: ((latestGold - sma20) / sma20) * 100,
    bias50: ((latestGold - sma50) / sma50) * 100,
    rv20: realizedVol(state.gold, 20),
    rvPath,
    goldCopper: makeRatio(state.gold, state.copper),
    goldSilver: makeRatio(state.gold, state.silver),
  };
}

async function loadAll() {
  $("dataStatus").textContent = "正在加载市场数据...";
  $("refreshBtn").disabled = true;
  try {
    const [gold, silver, copper, gvzResult] = await Promise.allSettled([
      fetchEastmoneySeries(marketSymbols.gold, "黄金"),
      fetchEastmoneySeries(marketSymbols.silver, "白银"),
      fetchEastmoneySeries(marketSymbols.copper, "铜"),
      fetchFredSeries("GVZCLS"),
    ]);
    if (gold.status !== "fulfilled") throw gold.reason;
    if (silver.status !== "fulfilled") throw silver.reason;
    if (copper.status !== "fulfilled") throw copper.reason;
    state.gold = gold.value.series;
    state.silver = silver.value.series;
    state.copper = copper.value.series;
    state.gvz = gvzResult.status === "fulfilled" ? gvzResult.value.slice(-state.gold.length) : [];
    $("goldSource").textContent = gold.value.symbol;

    const macroResults = await Promise.allSettled(macroSeries.map(async (item) => {
      const series = await fetchFredSeries(item.id);
      return [item.id, latestTransformed(series, item.transform)];
    }));
    state.macro = Object.fromEntries(macroResults.filter((result) => result.status === "fulfilled").map((result) => result.value));

    calculateMetrics();
    renderMetrics();
    renderReadout();
    renderMacro();
    renderSignal();
    renderCharts();
    state.loadedAt = new Date();
    $("dataStatus").textContent = `已更新 ${state.loadedAt.toLocaleString("zh-CN")}`;
  } catch (error) {
    $("dataStatus").textContent = `加载失败：${error.message}`;
  } finally {
    $("refreshBtn").disabled = false;
  }
}

$("refreshBtn").addEventListener("click", loadAll);
window.addEventListener("resize", () => {
  if (state.gold.length) renderCharts();
});

loadAll();
