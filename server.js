const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function proxyText(res, target) {
  const upstream = await fetch(target, {
    headers: {
      "user-agent": "Mozilla/5.0 gold-tracker/1.0",
      accept: "*/*",
    },
  });
  const text = await upstream.text();
  send(res, upstream.status, text, upstream.headers.get("content-type") || "text/plain; charset=utf-8");
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/yahoo") {
      const symbol = url.searchParams.get("symbol");
      const range = url.searchParams.get("range") || "3y";
      const interval = url.searchParams.get("interval") || "1d";
      if (!symbol) return sendJson(res, 400, { error: "Missing symbol" });
      const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=history`;
      return proxyText(res, target);
    }

    if (url.pathname === "/api/eastmoney-kline") {
      const secid = url.searchParams.get("secid");
      const beg = url.searchParams.get("beg") || "20200101";
      const end = url.searchParams.get("end") || "20500101";
      if (!secid) return sendJson(res, 400, { error: "Missing secid" });
      const target = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=${encodeURIComponent(beg)}&end=${encodeURIComponent(end)}`;
      return proxyText(res, target);
    }

    if (url.pathname === "/api/fred") {
      const id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "Missing FRED id" });
      const target = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
      return proxyText(res, target);
    }

    sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
}

function serveStatic(req, res, url) {
  const filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const fullPath = path.normalize(path.join(ROOT, filePath));
  if (!fullPath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");

  fs.readFile(fullPath, (error, data) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const type = MIME[path.extname(fullPath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Gold tracker running at http://localhost:${PORT}`);
});
