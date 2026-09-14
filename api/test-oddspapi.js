export default async function handler(req, res) {
  const apiKey = process.env.ODDSPAPI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "API key ausente"
    });
  }

  try {
    const fixturesUrl =
      `https://api.oddspapi.io/v4/fixtures` +
      `?tournamentId=325` +
      `&sportId=10` +
      `&statusId=0` +
      `&hasOdds=true` +
      `&limit=20` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const fr = await fetch(fixturesUrl);

    if (!fr.ok) {
      const text = await fr.text();

      return res.status(fr.status).json({
        ok: false,
        etapa: "fixtures",
        status: fr.status,
        resposta: text
      });
    }

    const fixtures = await fr.json();

    const fixture =
      Array.isArray(fixtures)
        ? fixtures[0]
        : null;

    if (!fixture) {
      return res.status(404).json({
        ok: false,
        error: "Nenhum jogo encontrado"
      });
    }

    const fixtureId =
      fixture.fixtureId;

    const oddsUrl =
      `https://api.oddspapi.io/v4/odds` +
      `?fixtureId=${encodeURIComponent(fixtureId)}` +
      `&bookmakers=draftkings` +
      `&oddsFormat=decimal` +
      `&language=en` +
      `&verbosity=3` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const or = await fetch(oddsUrl);
    const text = await or.text();

    return res.status(or.status).json({
      ok: or.ok,
      jogo: {
        fixtureId,
        casa: fixture.participant1Name,
        fora: fixture.participant2Name,
        inicio: fixture.startTime
      },
      statusOdds: or.status,
      resposta: text.slice(0, 15000)
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
