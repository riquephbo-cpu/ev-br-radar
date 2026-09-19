EV-BR RADAR — analyze.js V2
COPIE SOMENTE O CÓDIGO ABAIXO, começando em const LEAGUE e indo até a última chave }.
No GitHub: Ctrl+A no código antigo → Delete → cole este código completo → Confirmar alterações.
const LEAGUE = "bra.1";
const SCOREBOARD =
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/scoreboard`;
 
const CORE =
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${LEAGUE}`;
 
const ODDSPAPI_KEY = process.env.ODDSPAPI_API_KEY;
const ODDSPAPI_BASE = "https://api.oddspapi.io/v4";
 
async function getOddsPapi(url) {
  if (!ODDSPAPI_KEY) throw new Error("ODDSPAPI_API_KEY ausente");
 
  const r = await fetch(
    `${url}${url.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(ODDSPAPI_KEY)}`,
    { headers: { accept: "application/json" } }
  );
 
  if (!r.ok) throw new Error(`OddsPapi ${r.status}`);
  return await r.json();
}
 
async function getJSON(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" }
  });
 
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return await r.json();
}
 
async function tryGetJSON(url) {
  try {
    return await getJSON(url);
  } catch (e) {
    console.error("ESPN opcional:", e.message, url);
    return null;
  }
}
 
function poisson(lambda, k) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / f;
}
 
function parseEvent(event) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;
 
  const competitors = competition.competitors || [];
  const home = competitors.find(c => c.homeAway === "home");
  const away = competitors.find(c => c.homeAway === "away");
  if (!home || !away) return null;
 
  const hs = Number(home.score);
  const as = Number(away.score);
 
  return {
    id: event.id,
    date: event.date,
    completed: event?.status?.type?.completed === true,
    homeId: String(home.team?.id || ""),
    awayId: String(away.team?.id || ""),
    home: home.team?.displayName || home.team?.name || "Casa",
    away: away.team?.displayName || away.team?.name || "Fora",
    homeScore: Number.isFinite(hs) ? hs : null,
    awayScore: Number.isFinite(as) ? as : null
  };
}
 
async function loadSeason() {
  const year = new Date().getFullYear();
 
  // A consulta anual antiga podia receber ESPN 400.
  // Fazemos consultas mensais menores e, se uma falhar, seguimos com as demais.
  const all = new Map();
 
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(year, month, 0).getDate();
    const dd = String(lastDay).padStart(2, "0");
 
    const url =
      `${SCOREBOARD}?dates=${year}${mm}01-${year}${mm}${dd}&limit=100`;
 
    const data = await tryGetJSON(url);
    if (!data) continue;
 
    for (const raw of data.events || []) {
      const event = parseEvent(raw);
      if (event?.id) all.set(event.id, event);
    }
  }
 
  // Fallback: se a ESPN rejeitar as consultas com intervalo,
  // tenta o scoreboard simples em vez de derrubar o radar.
  if (!all.size) {
    const fallback = await tryGetJSON(SCOREBOARD);
 
    for (const raw of fallback?.events || []) {
      const event = parseEvent(raw);
      if (event?.id) all.set(event.id, event);
    }
  }
 
  return [...all.values()];
}
 
function weightedAverage(values, decay = 0.88) {
  let numerator = 0;
  let denominator = 0;
 
  values.forEach((value, i) => {
    if (value == null) return;
    const weight = Math.pow(decay, i);
    numerator += value * weight;
    denominator += weight;
  });
 
  return denominator ? numerator / denominator : null;
}
 
function buildStats(events) {
  const finished = events
    .filter(e => e.completed && e.homeScore != null && e.awayScore != null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
 
  const teams = {};
  let totalGoals = 0;
  let sides = 0;
 
  for (const e of finished) {
    totalGoals += e.homeScore + e.awayScore;
    sides += 2;
 
    teams[e.homeId] ??= { matches: [] };
    teams[e.awayId] ??= { matches: [] };
 
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
 
  const leagueAverage = sides ? totalGoals / sides : 1.25;
  const stats = {};
 
  for (const [id, team] of Object.entries(teams)) {
    const matches = team.matches.slice(0, 12);
    const home = matches.filter(x => x.home);
    const away = matches.filter(x => !x.home);
 
    const gf =
      weightedAverage(matches.map(x => x.gf)) ?? leagueAverage;
 
    const ga =
      weightedAverage(matches.map(x => x.ga)) ?? leagueAverage;
 
    stats[id] = {
      samples: matches.length,
      gf,
      ga,
      homeGF: weightedAverage(home.map(x => x.gf)) ?? gf,
      homeGA: weightedAverage(home.map(x => x.ga)) ?? ga,
      awayGF: weightedAverage(away.map(x => x.gf)) ?? gf,
      awayGA: weightedAverage(away.map(x => x.ga)) ?? ga
    };
  }
 
  return { stats, leagueAverage };
}
 
function calculateModel(event, stats, leagueAverage) {
  const h = stats[event.homeId];
  const a = stats[event.awayId];
  if (!h || !a) return null;
 
  const avg = Math.max(leagueAverage, 0.3);
 
  const homeAttack = (0.65 * h.homeGF + 0.35 * h.gf) / avg;
  const homeDefense = (0.65 * h.homeGA + 0.35 * h.ga) / avg;
  const awayAttack = (0.65 * a.awayGF + 0.35 * a.gf) / avg;
  const awayDefense = (0.65 * a.awayGA + 0.35 * a.ga) / avg;
 
  const lambdaHome = Math.max(
    0.20,
    Math.min(3.5, avg * homeAttack * awayDefense * 1.10)
  );
 
  const lambdaAway = Math.max(
    0.15,
    Math.min(3.2, avg * awayAttack * homeDefense * 0.92)
  );
 
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let over25 = 0;
  let btts = 0;
  let gridTotal = 0;
 
  let bestScore = {
    home: 0,
    away: 0,
    probability: 0
  };
 
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poisson(lambdaHome, i) * poisson(lambdaAway, j);
      gridTotal += p;
 
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
 
      if (i + j >= 3) over25 += p;
      if (i > 0 && j > 0) btts += p;
 
      if (p > bestScore.probability) {
        bestScore = {
          home: i,
          away: j,
          probability: p
        };
      }
    }
  }
 
  const total = pHome + pDraw + pAway;
  const norm = gridTotal || total || 1;
 
  return {
    p1: pHome / total,
    px: pDraw / total,
    p2: pAway / total,
    over25: over25 / norm,
    under25: 1 - over25 / norm,
    btts: btts / norm,
    bttsNo: 1 - btts / norm,
    lambdaHome,
    lambdaAway,
    score: `${bestScore.home}-${bestScore.away}`,
    samples: Math.min(h.samples, a.samples)
  };
}
 
function americanToDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return 1 + n / 100;
  if (n < 0) return 1 + 100 / Math.abs(n);
  return null;
}
 
function decimalOdd(value) {
  if (value == null) return null;
 
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
 
  if (n > 1 && n < 30) return n;
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
 
      const data = await tryGetJSON(url);
      if (!data) continue;
 
      const items = data.items || [];
 
      for (const item of items) {
        let obj = item;
 
        if (item?.$ref) {
          obj = await tryGetJSON(item.$ref);
          if (!obj) continue;
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
          "2": away,
          source: "ESPN"
        });
      }
    } catch (e) {
      console.error("ESPN odds:", e.message);
    }
  }
 
  return books;
}
 
async function loadOddsPapiFixtures() {
  if (!ODDSPAPI_KEY) return [];
 
  try {
    const url =
      `${ODDSPAPI_BASE}/fixtures` +
      `?tournamentId=325` +
      `&sportId=10` +
      `&statusId=0` +
      `&hasOdds=true`;
 
    const data = await getOddsPapi(url);
    return Array.isArray(data)
      ? data
      : data?.fixtures || data?.data || data?.items || [];
  } catch (e) {
    console.error("OddsPapi fixtures:", e.message);
    return [];
  }
}
 
async function loadOddsPapi(fixtureId) {
  if (!ODDSPAPI_KEY || !fixtureId) return null;
 
  try {
    const url =
      `${ODDSPAPI_BASE}/odds` +
      `?fixtureId=${encodeURIComponent(fixtureId)}` +
      `&oddsFormat=decimal` +
      `&verbosity=3`;
 
    return await getOddsPapi(url);
  } catch (e) {
    console.error("OddsPapi odds:", e.message);
    return null;
  }
}
 
function normalizeTeamName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(
      /\b(fc|futebol clube|ec|esporte clube|sc|clube atletico|clube)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
 
function canonicalTeamName(name) {
  const n = normalizeTeamName(name);
 
  const aliases = {
    atleticomg: "atleticomineiro",
    atleticomineiro: "atleticomineiro",
    cam: "atleticomineiro",
 
    athleticopr: "athleticoparanaense",
    athleticoparanaense: "athleticoparanaense",
    atleticoparanaense: "athleticoparanaense",
 
    bragantino: "bragantino",
    redbullbragantino: "bragantino",
    rbbragantino: "bragantino",
 
    vasco: "vasco",
    vascodagama: "vasco",
    crvascodagama: "vasco",
 
    gremio: "gremio",
    gremiofbpa: "gremio",
 
    internacional: "internacional",
    scinternacional: "internacional",
 
    saopaulo: "saopaulo",
    saopaulofc: "saopaulo",
 
    corinthians: "corinthians",
    sportclubcorinthianspaulista: "corinthians"
  };
 
  return aliases[n] || n;
}
 
function teamNamesMatch(a, b) {
  const x = canonicalTeamName(a);
  const y = canonicalTeamName(b);
 
  if (!x || !y) return false;
  if (x === y) return true;
 
  const minLength = Math.min(x.length, y.length);
  return minLength >= 6 && (x.includes(y) || y.includes(x));
}
 
function findOddsPapiFixture(event, fixtures) {
  const espnTime = new Date(event.date).getTime();
 
  let bestMatch = null;
  let bestDifference = Infinity;
 
  for (const fixture of fixtures) {
    const papiHome =
      fixture.participant1Name ||
      fixture.participant1ShortName ||
      fixture.homeName ||
      fixture.homeTeamName;
 
    const papiAway =
      fixture.participant2Name ||
      fixture.participant2ShortName ||
      fixture.awayName ||
      fixture.awayTeamName;
 
    const sameOrder =
      teamNamesMatch(event.home, papiHome) &&
      teamNamesMatch(event.away, papiAway);
 
    const reversedOrder =
      teamNamesMatch(event.home, papiAway) &&
      teamNamesMatch(event.away, papiHome);
 
    if (!sameOrder && !reversedOrder) continue;
 
    const fixtureTime = new Date(
      fixture.startTime ||
      fixture.trueStartTime ||
      fixture.startDate ||
      fixture.date
    ).getTime();
 
    const difference =
      Number.isFinite(fixtureTime) && Number.isFinite(espnTime)
        ? Math.abs(fixtureTime - espnTime)
        : 0;
 
    if (
      difference <= 12 * 60 * 60 * 1000 &&
      difference < bestDifference
    ) {
      bestDifference = difference;
      bestMatch = {
        fixture,
        reversed: reversedOrder
      };
    }
  }
 
  return bestMatch;
}
 
function readOddsPapiPrice(market, outcomeId) {
  const outcome =
    market?.outcomes?.[String(outcomeId)] ||
    market?.outcomes?.[outcomeId];
 
  const player =
    outcome?.players?.["0"] ||
    outcome?.players?.[0];
 
  if (!player) return null;
  if (player.active === false) return null;
 
  return decimalOdd(player.price);
}
 
function parseOddsPapiMarkets(data, reversed = false) {
  const boards = data?.bookmakerOdds || {};
 
  const result = {
    oneXtwo: [],
    overUnder25: [],
    btts: []
  };
 
  const seen1x2 = new Set();
  const seenOU = new Set();
  const seenBTTS = new Set();
 
  for (const [slug, board] of Object.entries(boards)) {
    const markets = board?.markets || {};
 
    const bookmaker =
      board?.bookmakerName ||
      board?.displayName ||
      board?.name ||
      slug;
 
    // 1X2: market 101; outcomes 101 / 102 / 103.
    const one = markets["101"] || markets[101];
 
    if (one) {
      let home = readOddsPapiPrice(one, 101);
      const draw = readOddsPapiPrice(one, 102);
      let away = readOddsPapiPrice(one, 103);
 
      if (home && draw && away) {
        if (reversed) [home, away] = [away, home];
 
        const key =
          `${home.toFixed(6)}|${draw.toFixed(6)}|${away.toFixed(6)}`;
 
        if (!seen1x2.has(key)) {
          seen1x2.add(key);
          result.oneXtwo.push({
            bookmaker,
            "1": home,
            "X": draw,
            "2": away,
            source: "OddsPapi"
          });
        }
      }
    }
 
    // Over/Under 2.5: market 1010; outcomes 1010 Over / 1011 Under.
    const ou = markets["1010"] || markets[1010];
 
    if (ou) {
      const over = readOddsPapiPrice(ou, 1010);
      const under = readOddsPapiPrice(ou, 1011);
 
      if (over && under) {
        const key = `${over.toFixed(6)}|${under.toFixed(6)}`;
 
        if (!seenOU.has(key)) {
          seenOU.add(key);
          result.overUnder25.push({
            bookmaker,
            OVER25: over,
            UNDER25: under,
            source: "OddsPapi"
          });
        }
      }
    }
 
    // BTTS: market 104; outcomes 104 Yes / 105 No.
    const bt = markets["104"] || markets[104];
 
    if (bt) {
      const yes = readOddsPapiPrice(bt, 104);
      const no = readOddsPapiPrice(bt, 105);
 
      if (yes && no) {
        const key = `${yes.toFixed(6)}|${no.toFixed(6)}`;
 
        if (!seenBTTS.has(key)) {
          seenBTTS.add(key);
          result.btts.push({
            bookmaker,
            BTTS_YES: yes,
            BTTS_NO: no,
            source: "OddsPapi"
          });
        }
      }
    }
  }
 
  return result;
}
 
function mergeOddsSources(espnOdds, papiOdds) {
  const merged = [];
  const seen = new Set();
 
  for (const book of [...papiOdds, ...espnOdds]) {
    if (!book?.["1"] || !book?.["X"] || !book?.["2"]) continue;
 
    const key =
      `${book.bookmaker}|${book["1"]}|${book["X"]}|${book["2"]}`;
 
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(book);
  }
 
  return merged;
}
 
function devig3(a, b, c) {
  if (![a, b, c].every(x => Number.isFinite(x) && x > 1)) {
    return null;
  }
 
  const raw = [1 / a, 1 / b, 1 / c];
  const total = raw.reduce((x, y) => x + y, 0);
  return raw.map(x => x / total);
}
 
function devig2(a, b) {
  if (![a, b].every(x => Number.isFinite(x) && x > 1)) {
    return null;
  }
 
  const rawA = 1 / a;
  const rawB = 1 / b;
  const total = rawA + rawB;
 
  return [rawA / total, rawB / total];
}
 
function median(values) {
  const clean = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
 
  if (!clean.length) return null;
 
  const middle = Math.floor(clean.length / 2);
 
  return clean.length % 2
    ? clean[middle]
    : (clean[middle - 1] + clean[middle]) / 2;
}
 
function marketConsensus3(books) {
  const probabilities = books
    .map(o => devig3(o["1"], o["X"], o["2"]))
    .filter(Boolean);
 
  if (!probabilities.length) return null;
 
  const result = [0, 1, 2].map(i =>
    median(probabilities.map(x => x[i]))
  );
 
  const total = result.reduce((a, b) => a + b, 0);
  return result.map(x => x / total);
}
 
function marketConsensus2(books, keyA, keyB) {
  const probabilities = books
    .map(o => devig2(o[keyA], o[keyB]))
    .filter(Boolean);
 
  if (!probabilities.length) return null;
 
  const a = median(probabilities.map(x => x[0]));
  const b = median(probabilities.map(x => x[1]));
  const total = a + b;
 
  return [a / total, b / total];
}
 
function bestPrice(books, key) {
  let bestOdd = null;
  let bookmaker = null;
 
  for (const book of books) {
    const price = Number(book?.[key]);
 
    if (
      Number.isFinite(price) &&
      price > 1 &&
      (bestOdd == null || price > bestOdd)
    ) {
      bestOdd = price;
      bookmaker = book.bookmaker;
    }
  }
 
  return { bestOdd, bookmaker };
}
 
function confidenceFor(samples, sourceCount) {
  return Math.max(
    45,
    Math.min(
      92,
      55 + samples * 2 + (sourceCount ? 10 : 0)
    )
  );
}
 
function statusFor(bestOdd, ev, confidence) {
  if (bestOdd == null || ev == null) return "SEM ODD";
  if (ev > 0.20) return "AUDITAR";
  if (ev >= 0.05 && confidence >= 65) return "OPORTUNIDADE";
  return "OBSERVAR";
}
 
function addOpportunity({
  opportunities,
  event,
  marketName,
  selection,
  modelProbability,
  marketProbability,
  books,
  priceKey,
  likelyScore,
  samples
}) {
  const { bestOdd, bookmaker } = bestPrice(books, priceKey);
 
  const finalProbability =
    marketProbability != null
      ? 0.65 * modelProbability + 0.35 * marketProbability
      : modelProbability;
 
  const fairOdd =
    finalProbability > 0 ? 1 / finalProbability : null;
 
  const ev =
    bestOdd != null
      ? finalProbability * bestOdd - 1
      : null;
 
  const confidence =
    confidenceFor(samples, books.length);
 
  opportunities.push({
    game: `${event.home} x ${event.away}`,
    market: marketName,
    selection,
    modelProb: modelProbability,
    marketProb: marketProbability,
    finalProb: finalProbability,
    fairOdd,
    bestOdd,
    bookmaker,
    ev,
    confidence,
    sources: books.length,
    likelyScore,
    status: statusFor(bestOdd, ev, confidence)
  });
}
 
export default async function handler(req, res) {
  try {
    const events = await loadSeason();
 
    if (!events.length) {
      return res.status(503).json({
        ok: false,
        error:
          "A ESPN não devolveu jogos do Brasileirão. Tente atualizar novamente."
      });
    }
 
    const now = Date.now();
 
    const upcoming = events
      .filter(
        e =>
          !e.completed &&
          new Date(e.date).getTime() >= now - 3600000
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 20);
 
    const papiFixtures = await loadOddsPapiFixtures();
 
    const { stats, leagueAverage } = buildStats(events);
 
    const opportunities = [];
    const games = [];
 
    for (const event of upcoming) {
      const model =
        calculateModel(event, stats, leagueAverage);
 
      if (!model) continue;
 
      // ESPN é complementar. Se falhar, retorna [] e o radar segue.
      const espnOdds = await loadOdds(event.id);
 
      const papiMatch =
        findOddsPapiFixture(event, papiFixtures);
 
      let papiMarkets = {
        oneXtwo: [],
        overUnder25: [],
        btts: []
      };
 
      if (papiMatch?.fixture?.fixtureId) {
        const papiData =
          await loadOddsPapi(papiMatch.fixture.fixtureId);
 
        if (papiData) {
          papiMarkets =
            parseOddsPapiMarkets(
              papiData,
              papiMatch.reversed
            );
        }
      }
 
      const oneXtwo =
        mergeOddsSources(
          espnOdds,
          papiMarkets.oneXtwo
        );
 
      const market1x2 =
        marketConsensus3(oneXtwo);
 
      const marketOU =
        marketConsensus2(
          papiMarkets.overUnder25,
          "OVER25",
          "UNDER25"
        );
 
      const marketBTTS =
        marketConsensus2(
          papiMarkets.btts,
          "BTTS_YES",
          "BTTS_NO"
        );
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Resultado",
        selection: event.home,
        modelProbability: model.p1,
        marketProbability: market1x2?.[0] ?? null,
        books: oneXtwo,
        priceKey: "1",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Resultado",
        selection: "Empate",
        modelProbability: model.px,
        marketProbability: market1x2?.[1] ?? null,
        books: oneXtwo,
        priceKey: "X",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Resultado",
        selection: event.away,
        modelProbability: model.p2,
        marketProbability: market1x2?.[2] ?? null,
        books: oneXtwo,
        priceKey: "2",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Total de gols 2.5",
        selection: "Mais de 2.5 gols",
        modelProbability: model.over25,
        marketProbability: marketOU?.[0] ?? null,
        books: papiMarkets.overUnder25,
        priceKey: "OVER25",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Total de gols 2.5",
        selection: "Menos de 2.5 gols",
        modelProbability: model.under25,
        marketProbability: marketOU?.[1] ?? null,
        books: papiMarkets.overUnder25,
        priceKey: "UNDER25",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Ambas marcam",
        selection: "Sim",
        modelProbability: model.btts,
        marketProbability: marketBTTS?.[0] ?? null,
        books: papiMarkets.btts,
        priceKey: "BTTS_YES",
        likelyScore: model.score,
        samples: model.samples
      });
 
      addOpportunity({
        opportunities,
        event,
        marketName: "Ambas marcam",
        selection: "Não",
        modelProbability: model.bttsNo,
        marketProbability: marketBTTS?.[1] ?? null,
        books: papiMarkets.btts,
        priceKey: "BTTS_NO",
        likelyScore: model.score,
        samples: model.samples
      });
 
      games.push({
        game: `${event.home} x ${event.away}`,
        xg:
          `${model.lambdaHome.toFixed(2)} x ${model.lambdaAway.toFixed(2)}`,
        p1: model.p1,
        px: model.px,
        p2: model.p2,
        over25: model.over25,
        under25: model.under25,
        btts: model.btts,
        bttsNo: model.bttsNo,
        score: model.score,
        oddsSources: oneXtwo.length,
        overUnderSources: papiMarkets.overUnder25.length,
        bttsSources: papiMarkets.btts.length
      });
    }
 
    opportunities.sort(
      (a, b) =>
        (b.ev ?? -999) - (a.ev ?? -999) ||
        b.confidence - a.confidence
    );
 
    return res.status(200).json({
      ok: true,
      version: "EV-BR V2",
      source: "ESPN + OddsPapi",
      league: "Brasileirão Série A",
      leagueAvg: leagueAverage,
      totalEvents: events.length,
      upcoming: upcoming.length,
      markets: [
        "1X2",
        "Over/Under 2.5",
        "Ambas Marcam"
      ],
      opportunities,
      games
    });
  } catch (error) {
    console.error("EV-BR analyze:", error);
 
    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erro desconhecido"
    });
  }
}
