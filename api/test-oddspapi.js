export default async function handler(req, res) {
  const apiKey = process.env.ODDSPAPI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "API key ausente" });
    }
  try {
    const url = `https://api.oddspapi.io/v4/fixtures?tournamentId=325&sportId=10&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);
    const text = await r.text();
    return res.status(r.status).json({ ok: r.ok, status: r.status, resposta: text.slice(0, 2000) });
    } catch (e) {
  return res.status(500).json({
    ok: false,
    error: e.message
  });
}
}
