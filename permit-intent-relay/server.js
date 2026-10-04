import http from "node:http";

const DATASETS = {
  building: { layer: 7, where: "1=1", orderBy: "ISSUEDATE DESC" },
  tree: { layer: 4, where: "FOLDERNUM LIKE '%-TREE'", orderBy: "LASTUPDATE DESC" }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, {"content-type":"application/json"});
      res.end(JSON.stringify({ok:true}));
      return;
    }
    if (url.pathname !== "/api/permits") {
      res.writeHead(404, {"content-type":"application/json"});
      res.end(JSON.stringify({error:"not_found"}));
      return;
    }

    const dataset = url.searchParams.get("dataset") || "building";
    const cfg = DATASETS[dataset];
    if (!cfg) {
      res.writeHead(400, {"content-type":"application/json"});
      res.end(JSON.stringify({error:"dataset must be building or tree"}));
      return;
    }

    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "500", 10), 1), 2000);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const base = `https://geo.sanjoseca.gov/server/rest/services/PLN/PLN_PermitsAndComplaints/MapServer/${cfg.layer}/query`;
    const params = new URLSearchParams({
      where: cfg.where,
      outFields: "*",
      returnGeometry: "false",
      resultRecordCount: String(limit),
      resultOffset: String(offset),
      orderByFields: cfg.orderBy,
      f: "json"
    });

    const upstream = await fetch(`${base}?${params}`, {
      headers: {"User-Agent":"Permit-Intent-Radar/1.0","Accept":"application/json"},
      signal: AbortSignal.timeout(20000)
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      res.writeHead(502, {"content-type":"application/json"});
      res.end(JSON.stringify({error:"upstream_error", status:upstream.status, body:body.slice(0,1000)}));
      return;
    }

    const data = await upstream.json();
    const records = Array.isArray(data.features) ? data.features.map(f => f.attributes || {}) : [];
    res.writeHead(200, {
      "content-type":"application/json",
      "cache-control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600"
    });
    res.end(JSON.stringify({dataset, count: records.length, exceededTransferLimit: !!data.exceededTransferLimit, records}));
  } catch (err) {
    res.writeHead(500, {"content-type":"application/json"});
    res.end(JSON.stringify({error:"relay_failed", message: err?.message || String(err)}));
  }
});

const port = Number(process.env.PORT || 10000);
server.listen(port, "0.0.0.0", () => console.log(`permit relay listening on ${port}`));
