const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const secid = url.searchParams.get("secid");
    const beg = url.searchParams.get("beg") || "20200101";
    const end = url.searchParams.get("end") || "20500101";
    if (!secid) return json({ error: "Missing secid" }, 400);

    const target = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=${encodeURIComponent(beg)}&end=${encodeURIComponent(end)}`;
    const response = await fetch(target, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 gold-tracker/1.0",
      },
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
