const LEAGUE = "bra.1";
const SCOREBOARD =
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/scoreboard`;

const CORE =
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${LEAGUE}`;
const ODDSPAPI_KEY = process.env.ODDSPAPI_API_KEY;
const ODDSPAPI_BASE = "https://api.oddspapi.io/v4";

async function getJSON(url) {
  const r = await fetch(url, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!r.ok) {
    throw new Error(`ESPN ${r.status}`);
  }

  return await r.json();
}

function poisson(lambda, k) {
  let f = 1;

  for (let i = 2; i <= k; i++) {
    f *= i;
  }

  return Math.exp(-lambda) * Math.pow(lambda, k) / f;
}

function parseEvent(event) {
  const competition = event?.competitions?.[0];

  if (!competition) return null;

  const competitors = competition.competitors || [];

  const home =
    competitors.find(c => c.homeAway === "home");

  const away =
    competitors.find(c => c.homeAway === "away");

  if (!home || !away) return null;

  const hs = Number(home.score);
  const as = Number(away.score);

  return {
    id: event.id,
    date: event.date,

    completed:
      event?.status?.type?.completed === true,

    homeId: String(home.team?.id || ""),
    awayId: String(away.team?.id || ""),

    home:
      home.team?.displayName ||
      home.team?.name ||
      "Casa",

    away:
      away.team?.displayName ||
      away.team?.name ||
      "Fora",

    homeScore:
      Number.isFinite(hs) ? hs : null,

    awayScore:
      Number.isFinite(as) ? as : null
  };
}

async function loadSeason() {

  const year = new Date().getFullYear();

  const url =
    `${SCOREBOARD}?dates=${year}0101-${year}1231&limit=500`;

  const data = await getJSON(url);

  return (data.events || [])
    .map(parseEvent)
    .filter(Boolean);
}

function weightedAverage(values, decay = 0.88) {

  let numerator = 0;
  let denominator = 0;

  values.forEach((value, i) => {

    if (value == null) return;

    const weight =
      Math.pow(decay, i);

    numerator += value * weight;
    denominator += weight;
  });

  return denominator
    ? numerator / denominator
    : null;
}

function buildStats(events) {

  const finished =
    events
      .filter(e =>
        e.completed &&
        e.homeScore != null &&
        e.awayScore != null
      )
      .sort(
        (a, b) =>
          new Date(b.date) -
          new Date(a.date)
      );

  const teams = {};

  let totalGoals = 0;
  let sides = 0;

  for (const e of finished) {

    totalGoals +=
      e.homeScore +
      e.awayScore;

    sides += 2;

    teams[e.homeId] ??= {
      matches: []
    };

    teams[e.awayId] ??= {
      matches: []
    };

    teams[e.homeId].matches.push({
      gf: e.homeScore,
      ga: e.awayScore,
      home: true
    });

    teams[e.awayId].matches.push({
      gf: e.awayScore,
      ga: e.homeScore,
      home: false
    });
  }

  const leagueAverage =
    sides
      ? totalGoals / sides
      : 1.25;

  const stats = {};

  for (const [id, team] of
       Object.entries(teams)) {

    const matches =
      team.matches.slice(0, 12);

    const home =
      matches.filter(x => x.home);

    const away =
      matches.filter(x => !x.home);

    const gf =
      weightedAverage(
        matches.map(x => x.gf)
      ) ?? leagueAverage;

    const ga =
      weightedAverage(
        matches.map(x => x.ga)
      ) ?? leagueAverage;

    stats[id] = {

      samples:
        matches.length,

      gf,
      ga,

      homeGF:
        weightedAverage(
          home.map(x => x.gf)
        ) ?? gf,

      homeGA:
        weightedAverage(
          home.map(x => x.ga)
        ) ?? ga,

      awayGF:
        weightedAverage(
          away.map(x => x.gf)
        ) ?? gf,

      awayGA:
        weightedAverage(
          away.map(x => x.ga)
        ) ?? ga
    };
  }

  return {
    stats,
    leagueAverage
  };
}

function calculateModel(
  event,
  stats,
  leagueAverage
) {

  const h =
    stats[event.homeId];

  const a =
    stats[event.awayId];

  if (!h || !a)
    return null;

  const avg =
    Math.max(
      leagueAverage,
      0.3
    );

  const homeAttack =
    (
      0.65 * h.homeGF +
      0.35 * h.gf
    ) / avg;

  const homeDefense =
    (
      0.65 * h.homeGA +
      0.35 * h.ga
    ) / avg;

  const awayAttack =
    (
      0.65 * a.awayGF +
      0.35 * a.gf
    ) / avg;

  const awayDefense =
    (
      0.65 * a.awayGA +
      0.35 * a.ga
    ) / avg;

  const lambdaHome =
    Math.max(
      0.20,
      Math.min(
        3.5,
        avg *
        homeAttack *
        awayDefense *
        1.10
      )
    );

  const lambdaAway =
    Math.max(
      0.15,
      Math.min(
        3.2,
        avg *
        awayAttack *
        homeDefense *
        0.92
      )
    );

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;

  let over25 = 0;
  let btts = 0;

  let bestScore = {
    home: 0,
    away: 0,
    probability: 0
  };

  for (let i = 0; i <= 8; i++) {

    for (let j = 0; j <= 8; j++) {

      const p =
        poisson(lambdaHome, i) *
        poisson(lambdaAway, j);

      if (i > j)
        pHome += p;

      else if (i === j)
        pDraw += p;

      else
        pAway += p;

      if (i + j >= 3)
        over25 += p;

      if (i > 0 && j > 0)
        btts += p;

      if (p >
          bestScore.probability) {

        bestScore = {
          home: i,
          away: j,
          probability: p
        };
      }
    }
  }

  const total =
    pHome +
    pDraw +
    pAway;

  return {

    p1:
      pHome / total,

    px:
      pDraw / total,

    p2:
      pAway / total,

    over25,
    btts,

    lambdaHome,
    lambdaAway,

    score:
      `${bestScore.home}-${bestScore.away}`,

    samples:
      Math.min(
        h.samples,
        a.samples
      )
  };
}

function americanToDecimal(value) {

  const n =
    Number(value);

  if (!Number.isFinite(n))
    return null;

  if (n > 0)
    return 1 + n / 100;

  if (n < 0)
    return 1 + 100 /
      Math.abs(n);

  return null;
}

function decimalOdd(value) {

  if (value == null)
    return null;

  const n =
    Number(value);

  if (!Number.isFinite(n))
    return null;

  if (n > 1 &&
      n < 30)
    return n;

  return americanToDecimal(n);
}

async function loadOdds(eventId) {
  const providers = [
    { priority: 1, name: "Principal" },
    { priority: 2, name: "Secundaria" },
    { priority: 3, name: "Terceira" },
    { priority: 4, name: "Quarta" },
    { priority: 5, name: "Quinta" },
    { priority: 6, name: "Sexta" }
  ];

  const books = [];
  const seen = new Set();

  for (const provider of providers) {
    try {
      const url =
        `${CORE}/events/${eventId}` +
        `/competitions/${eventId}` +
        `/odds?limit=100&provider.priority=${provider.priority}`;

      const data = await getJSON(url);
      const items = data.items || [];

      for (const item of items) {
        let obj = item;

        if (item?.$ref) {
          try {
            obj = await getJSON(item.$ref);
          } catch {
            continue;
          }
        }

        const providerName =
          obj?.provider?.name ||
          obj?.provider?.displayName ||
          provider.name;

        const home = decimalOdd(
          obj?.homeTeamOdds?.moneyLine ??
          obj?.homeTeamOdds?.value
        );

        const away = decimalOdd(
          obj?.awayTeamOdds?.moneyLine ??
          obj?.awayTeamOdds?.value
        );

        const draw = decimalOdd(
          obj?.drawOdds?.moneyLine ??
          obj?.drawOdds?.value
        );

        if (!home || !draw || !away) continue;

        const key =
          `${providerName}|${home}|${draw}|${away}`;

        if (seen.has(key)) continue;

        seen.add(key);

        books.push({
          bookmaker: providerName,
          "1": home,
          "X": draw,
          "2": away
        });
      }
    } catch {
      // ignora provedor indisponivel
    }
  }

  return books;
}

function devig(a, b, c) {

  const raw = [
    1 / a,
    1 / b,
    1 / c
  ];

  const total =
    raw.reduce(
      (x, y) => x + y,
      0
    );

  return raw.map(
    x => x / total
  );
}

export default async function handler(
  req,
  res
) {

  try {

    const events =
      await loadSeason();

    const now =
      Date.now();

    const upcoming =
      events
        .filter(e =>
          !e.completed &&
          new Date(e.date).getTime()
            >= now - 3600000
        )
        .sort(
          (a, b) =>
            new Date(a.date) -
            new Date(b.date)
        )
        .slice(0, 20);

    const {
      stats,
      leagueAverage
    } =
      buildStats(events);

    const opportunities = [];
    const games = [];

    for (const event of upcoming) {

      const model =
        calculateModel(
          event,
          stats,
          leagueAverage
        );

      if (!model)
        continue;

      const odds =
        await loadOdds(event.id);

      let market =
        null;

      if (odds.length) {

        const probabilities =
          odds.map(o =>
            devig(
              o["1"],
              o["X"],
              o["2"]
            )
          );

        market =
          [0, 1, 2].map(i => {

            const values =
              probabilities
                .map(x => x[i])
                .sort(
                  (a, b) => a - b
                );

            return values[
              Math.floor(
                values.length / 2
              )
            ];
          });

        const total =
          market.reduce(
            (a, b) => a + b,
            0
          );

        market =
          market.map(
            x => x / total
          );
      }

      const selections = [

        [
          "1",
          event.home,
          model.p1,
          0
        ],

        [
          "X",
          "Empate",
          model.px,
          1
        ],

        [
          "2",
          event.away,
          model.p2,
          2
        ]
      ];

      for (
        const [
          key,
          label,
          modelProbability,
          index
        ] of selections
      ) {

        let bestOdd = null;
        let bookmaker = null;

        for (const book of odds) {

          if (
            bestOdd == null ||
            book[key] > bestOdd
          ) {

            bestOdd =
              book[key];

            bookmaker =
              book.bookmaker;
          }
        }

        const marketProbability =
          market?.[index] ?? null;

        const finalProbability =
          marketProbability != null
            ? 0.65 *
              modelProbability +
              0.35 *
              marketProbability
            : modelProbability;

        const fairOdd =
          1 /
          finalProbability;

        const ev =
          bestOdd != null
            ? finalProbability *
              bestOdd - 1
            : null;

        const confidence =
          Math.max(
            45,
            Math.min(
              92,
              55 +
              model.samples * 2 +
              (odds.length
                ? 10
                : 0)
            )
          );

        opportunities.push({

          game:
            `${event.home} x ${event.away}`,

          selection:
            label,

          modelProb:
            modelProbability,

          marketProb:
            marketProbability,

          finalProb:
            finalProbability,

          fairOdd,

          bestOdd,

          bookmaker,

          ev,

          confidence,

          sources:
            odds.length,

          likelyScore:
            model.score,

         status:
  bestOdd == null
    ? "SEM ODD"
    : ev > 0.20
      ? "AUDITAR"
      : ev >= 0.05 && confidence >= 65
        ? "OPORTUNIDADE"
        : "OBSERVAR"
        });
      }

      games.push({

        game:
          `${event.home} x ${event.away}`,

        xg:
          `${model.lambdaHome.toFixed(2)} x ${model.lambdaAway.toFixed(2)}`,

        p1:
          model.p1,

        px:
          model.px,

        p2:
          model.p2,

        over25:
          model.over25,

        btts:
          model.btts,

        score:
          model.score,

        oddsSources:
          odds.length
      });
    }

    opportunities.sort(
      (a, b) =>
        (b.ev ?? -999) -
        (a.ev ?? -999) ||
        b.confidence -
        a.confidence
    );

    res.status(200).json({

      ok: true,

      source:
        "ESPN",

      league:
        "Brasileirão Série A",

      leagueAvg:
        leagueAverage,

      totalEvents:
        events.length,

      upcoming:
        upcoming.length,

      opportunities,

      games
    });
  }

  catch (error) {

    res.status(500).json({

      ok: false,

      error:
        error?.message ||
        "Erro desconhecido"
    });
  }
}
