export default async function handler(req, res) {
  const apiKey = process.env.ODDSPAPI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "API key ausente"
    });
  }

  try {
    // 1. Busca um jogo do Brasileirão que tenha odds
    const fixturesUrl =
      `https://api.oddspapi.io/v4/fixtures` +
      `?tournamentId=325` +
      `&sportId=10` +
      `&hasOdds=true` +
      `&limit=1` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const fixturesResponse = await fetch(fixturesUrl);

    if (!fixturesResponse.ok) {
      throw new Error(
        `Erro fixtures: ${fixturesResponse.status}`
      );
    }

    const fixturesData = await fixturesResponse.json();

    const fixtures = Array.isArray(fixturesData)
      ? fixturesData
      : fixturesData.fixtures ||
        fixturesData.data ||
        fixturesData.items ||
        [];

    const fixture = fixtures[0];

    if (!fixture) {
      return res.status(404).json({
        ok: false,
        error: "Nenhum jogo com odds encontrado",
        fixturesData
      });
    }

    const fixtureId =
      fixture.fixtureId ||
      fixture.id;

    if (!fixtureId) {
      return res.status(500).json({
        ok: false,
        error: "Fixture encontrado sem fixtureId",
        fixture
      });
    }

    // 2. Busca TODOS os mercados desse jogo
    const oddsUrl =
      `https://api.oddspapi.io/v4/odds` +
      `?fixtureId=${encodeURIComponent(fixtureId)}` +
      `&oddsFormat=decimal` +
      `&verbosity=3` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const oddsResponse = await fetch(oddsUrl);

    if (!oddsResponse.ok) {
      throw new Error(
        `Erro odds: ${oddsResponse.status}`
      );
    }

    const oddsData = await oddsResponse.json();

    // 3. Resume os mercados encontrados
    const bookmakerOdds =
      oddsData.bookmakerOdds || {};

    const marketIds = new Set();

    const bookmakers = [];

    for (const [bookmaker, board] of
         Object.entries(bookmakerOdds)) {

      const markets =
        board?.markets || {};

      const ids =
        Object.keys(markets);

      ids.forEach(id =>
        marketIds.add(id)
      );

      bookmakers.push({
        bookmaker,
        totalMarkets: ids.length,
        marketIds: ids.slice(0, 100)
      });
    }

    return res.status(200).json({
      ok: true,

      teste:
        "MAPEAMENTO DE MERCADOS ODDSAPI",

      jogo: {
        fixtureId,

        casa:
          fixture.participant1Name,

        fora:
          fixture.participant2Name,

        inicio:
          fixture.startTime
      },

      totalBookmakers:
        Object.keys(bookmakerOdds).length,

      totalMarketIds:
        marketIds.size,

      marketIds:
        [...marketIds],

      bookmakers:
        bookmakers.slice(0, 20),

      exemploBookmaker:
        Object.entries(bookmakerOdds)
          .slice(0, 1)
          .map(([nome, dados]) => ({
            nome,
            markets: dados?.markets
          }))
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
