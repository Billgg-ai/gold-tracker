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
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing FRED id" }, 400);

    const target = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
    const response = await fetch(target, {
      headers: {
        accept: "text/csv,*/*",
        "user-agent": "Mozilla/5.0 gold-tracker/1.0",
      },
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "text/csv; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
