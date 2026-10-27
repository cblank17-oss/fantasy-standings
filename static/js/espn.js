// Turn ESPN's league JSON into a normalized league. This is the only ESPN
// parser: the published page, the local app and the tests all use it.

export const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export function scoreboardUrl(leagueId, season) {
  return `${ESPN_BASE}/seasons/${season}/segments/0/leagues/${leagueId}?view=mScoreboard&view=mStatus`;
}

const undecided = m => (m.winner ?? "UNDECIDED") === "UNDECIDED";

function finalGames(m) {
  const hp = m.home.totalPoints ?? 0;
  if (!m.away) return [{ teamId: m.home.teamId, oppId: null, points: hp, oppPoints: null, result: "BYE" }];
  const ap = m.away.totalPoints ?? 0;
  const [hr, ar] = { HOME: ["W", "L"], AWAY: ["L", "W"] }[m.winner] ?? ["T", "T"];
  return [
    { teamId: m.home.teamId, oppId: m.away.teamId, points: hp, oppPoints: ap, result: hr },
    { teamId: m.away.teamId, oppId: m.home.teamId, points: ap, oppPoints: hp, result: ar },
  ];
}

// ESPN's live projected totals (actual points so far + projected remaining),
// shaped like final games so the scoring engine can treat them the same way.
function projectedGames(m) {
  const side = s => {
    const live = s.totalPointsLive ?? s.totalPoints ?? 0;
    return { teamId: s.teamId, points: s.totalProjectedPointsLive || live, live };
  };
  const h = side(m.home);
  if (!m.away) return [{ ...h, oppId: null, oppPoints: null, result: "BYE" }];
  const a = side(m.away);
  const res = (x, y) => (x > y ? "W" : x < y ? "L" : "T");
  return [
    { ...h, oppId: a.teamId, oppPoints: a.points, result: res(h.points, a.points) },
    { ...a, oppId: h.teamId, oppPoints: h.points, result: res(a.points, h.points) },
  ];
}

export function parseLeague(raw, { includePlayoffs = false } = {}) {
  const members = Object.fromEntries((raw.members || []).map(m =>
    [m.id, m.displayName || [m.firstName, m.lastName].filter(Boolean).join(" ")]));

  const teams = {};
  for (const t of raw.teams || []) {
    const name = (t.name || `${t.location ?? ""} ${t.nickname ?? ""}`).trim();
    teams[t.id] = {
      id: t.id, name: name || `Team ${t.id}`, abbrev: t.abbrev || "",
      owners: (t.owners || []).map(o => members[o]).filter(Boolean),
      manager: t.manager ?? null,             // opaque id that follows a person across seasons
      finalRank: t.rankCalculatedFinal || null, // ESPN's final finish incl. playoffs (0 until the season ends)
      seed: t.playoffSeed || null,
    };
  }

  const current = raw.status?.currentMatchupPeriod || raw.scoringPeriodId || 0;
  const byWeek = new Map();
  for (const m of raw.schedule || []) {
    if (!includePlayoffs && (m.playoffTierType || "NONE") !== "NONE") continue;
    if (!byWeek.has(m.matchupPeriodId)) byWeek.set(m.matchupPeriodId, []);
    byWeek.get(m.matchupPeriodId).push(m);
  }

  const weeks = {};
  let projection = null;
  for (const [week, ms] of [...byWeek].sort((a, b) => a[0] - b[0])) {
    // A week counts only once every matchup in it is final.
    if (!ms.some(m => m.away && undecided(m))) weeks[week] = ms.flatMap(finalGames);
    else if (week === current) projection = { week, games: ms.flatMap(projectedGames) };
  }

  return {
    id: raw.id, season: raw.seasonId, name: raw.settings?.name || "Fantasy League",
    teams, weeks, currentWeek: current, projection,
    playoffTeamCount: raw.settings?.scheduleSettings?.playoffTeamCount || null,
  };
}
