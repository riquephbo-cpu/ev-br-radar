export default async function handler(req, res) {
  const apiKey = process.env.ODDSPAPI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "API key ausente"
    });
  }

  try {
    // Busca jogos do Brasileirão com odds disponíveis
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
      return res.status(fr.status).json({
        ok: false,
        etapa: "fixtures",
        status: fr.status,
        resposta: await fr.text()
      });
    }

    const fixturesData = await fr.json();

    const fixtures =
      Array.isArray(fixturesData)
        ? fixturesData
        : fixturesData.fixtures ||
          fixturesData.data ||
          fixturesData.items ||
          [];

    const fixture = fixtures[0];

    if (!fixture) {
      return res.status(404).json({
        ok: false,
        error: "Nenhum jogo encontrado"
      });
    }

    const fixtureId =
      fixture.fixtureId || fixture.id;

    // Busca odds da DraftKings
    const oddsUrl =
      `https://api.oddspapi.io/v4/odds` +
      `?fixtureId=${encodeURIComponent(fixtureId)}` +
      `&bookmakers=draftkings` +
      `&oddsFormat=decimal` +
      `&language=en` +
      `&verbosity=3` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    const or = await fetch(oddsUrl);

    if (!or.ok) {
      return res.status(or.status).json({
        ok: false,
        etapa: "odds",
        status: or.status,
        resposta: await or.text()
      });
    }

    const oddsData = await or.json();

    const bookmakerOdds =
      oddsData.bookmakerOdds || {};

    const encontrados = [];

    // Procura mercados e linhas relacionados
    // a gols e Ambas Marcam.
    for (const [bookmaker, board] of
         Object.entries(bookmakerOdds)) {

      const markets =
        board?.markets || {};

      for (const [marketId, market] of
           Object.entries(markets)) {

        const outcomes =
          market?.outcomes || {};

        const resultado = {
          bookmaker,
          marketId,

          marketName:
            market.marketName ||
            market.name ||
            null,

          marketType:
            market.marketType ||
            market.type ||
            null,

          outcomes: []
        };

        for (const [outcomeId, outcome] of
             Object.entries(outcomes)) {

          const players =
            outcome?.players || {};

          for (const [playerId, player] of
               Object.entries(players)) {

            if (!player) continue;

            resultado.outcomes.push({
              outcomeId,
              playerId,

              outcomeName:
                outcome.outcomeName ||
                outcome.name ||
                player.outcomeName ||
                player.name ||
                null,

              line:
                player.line ??
                player.handicap ??
                player.total ??
                null,

              price:
                player.price ?? null,

              active:
                player.active ?? null
            });
          }
        }

        encontrados.push(resultado);
      }
    }

    return res.status(200).json({
      ok: true,

      teste:
        "MAPEAMENTO OVER UNDER E BTTS",

      jogo: {
        fixtureId,

        casa:
          fixture.participant1Name,

        fora:
          fixture.participant2Name,

        inicio:
          fixture.startTime
      },

      totalMercados:
        encontrados.length,

      mercados:
        encontrados
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
