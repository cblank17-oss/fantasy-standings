// League History: every season scored with the same compute() as the main
// standings, then rolled up per manager (a person, not a team slot: teams
// change names and occasionally change hands).
//
// Doubleheader points and shotguns are regular season only and use the current
// rules for every season. Shotguns only count from `shotgunsSince` (the season
// the league started them). Finishes are ESPN's final standings (incl. playoffs).

import { parseLeague } from "./espn.js";
import { compute } from "./scoring.js";

// Keep the best entry for a record, and everyone tied with it.
function track(rec, key, entry, higherIsBetter) {
  const cur = rec[key];
  if (!cur || (higherIsBetter ? entry.value > cur.value : entry.value < cur.value)) {
    rec[key] = { value: entry.value, holders: [entry] };
  } else if (Math.abs(entry.value - cur.value) < 1e-9) {
    cur.holders.push(entry);
  }
}

export function computeHistory(seasons, config, { shotgunsSince = null } = {}) {
  const managers = new Map();
  const summaries = [];
  const rec = {};
  const ruleIds = config.rules.map(r => r.id);

  const manager = id => {
    if (!managers.has(id)) managers.set(id, {
      id, names: [], seasons: 0, titles: 0, runnerUps: 0, playoffs: 0, lasts: 0,
      total: 0, byRule: Object.fromEntries(ruleIds.map(r => [r, 0])), weeks: 0,
      shotguns: 0, pf: 0, wins: 0, losses: 0, ties: 0, bySeason: {},
    });
    return managers.get(id);
  };

  for (const { season, data } of [...seasons].sort((a, b) => a.season - b.season)) {
    const league = parseLeague(data);
    const sgTracked = shotgunsSince == null || season >= shotgunsSince;
    const res = compute(league, config);
    const teams = Object.values(league.teams), n = teams.length;
    const complete = teams.length > 0 && teams.every(t => t.finalRank);
    const mgrOf = t => t.manager ?? `team-${season}-${t.id}`;
    const finishers = finish => teams.filter(t => complete && t.finalRank === finish)
      .map(t => ({ team: t.name, manager: mgrOf(t) }));

    for (const s of res.standings) {
      const team = league.teams[s.teamId], m = manager(mgrOf(team));
      const weeks = Object.keys(s.weekly).length;
      if (!weeks && !complete) continue; // season hasn't started
      const finish = complete ? team.finalRank : null;
      m.names.push({ season, name: team.name });
      m.seasons++;
      m.weeks += weeks; m.total += s.total; m.shotguns += sgTracked ? s.shotguns : 0; m.pf += s.pf;
      m.wins += s.wins; m.losses += s.losses; m.ties += s.ties;
      for (const r of ruleIds) m.byRule[r] += s.byRule[r];
      m.titles += finish === 1; m.runnerUps += finish === 2; m.lasts += finish === n;
      const madePlayoffs = complete && team.seed && league.playoffTeamCount ? team.seed <= league.playoffTeamCount : null;
      m.playoffs += madePlayoffs === true;
      m.bySeason[season] = {
        team: team.name, finish, last: finish === n, madePlayoffs, dhRank: s.rank,
        total: s.total, shotguns: sgTracked ? s.shotguns : null, record: [s.wins, s.losses, s.ties], inProgress: !complete,
      };

      const who = { team: team.name, manager: m.id, season };
      for (const [week, x] of Object.entries(s.weekly)) {
        const wk = { ...who, week: Number(week) };
        track(rec, "highScore", { ...wk, value: x.points }, true);
        track(rec, "lowScore", { ...wk, value: x.points }, false);
        if (x.result === "W") {
          const margin = x.points - x.oppPoints, opp = league.teams[x.oppId]?.name;
          track(rec, "blowout", { ...wk, value: margin, opp }, true);
          track(rec, "closest", { ...wk, value: margin, opp }, false);
        }
      }
      if (sgTracked) track(rec, "mostShotguns", { ...who, value: s.shotguns, inProgress: !complete }, true);
      if (complete) {
        track(rec, "bestSeason", { ...who, value: s.total }, true);
        track(rec, "worstSeason", { ...who, value: s.total }, false);
      }
    }

    const maxSg = Math.max(0, ...res.standings.map(s => s.shotguns));
    summaries.push({
      season, complete, weeks: res.weeks.length,
      champion: finishers(1), runnerUp: finishers(2), last: finishers(n),
      dhLeader: res.standings.filter(s => s.rank === 1).map(s => ({ team: s.name, manager: mgrOf(league.teams[s.teamId]), value: s.total })),
      mostShotguns: !sgTracked ? null : maxSg ? res.standings.filter(s => s.shotguns === maxSg).map(s => ({ team: s.name, manager: mgrOf(league.teams[s.teamId]), value: maxSg })) : [],
    });
  }

  const latestSeason = summaries.at(-1)?.season;
  const rows = [...managers.values()].filter(m => m.seasons).map(m => {
    const finishes = Object.values(m.bySeason).map(x => x.finish).filter(Boolean);
    const last = m.names.at(-1);
    return {
      ...m,
      name: last.name,                       // most recent team name
      active: last.season === latestSeason,
      lastSeason: last.season,
      avgFinish: finishes.length ? finishes.reduce((a, b) => a + b, 0) / finishes.length : null,
      bestFinish: finishes.length ? Math.min(...finishes) : null,
      perWeek: m.weeks ? m.total / m.weeks : 0,
    };
  });

  const names = Object.fromEntries(rows.map(r => [r.id, r.name]));
  return {
    seasons: summaries.map(s => s.season), shotgunsSince,
    summaries, records: rec, managers: rows, names,
    rules: config.rules.map(r => ({ id: r.id, label: r.label || r.id })),
  };
}
