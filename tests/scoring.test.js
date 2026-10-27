// Run: node --test tests/scoring.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { parseLeague } from "../static/js/espn.js";
import { compute, project, weeklyRank, PRESETS } from "../static/js/scoring.js";

const DH = PRESETS.doubleheader;

function matchup(week, home, hp, away = null, ap = null, { winner, tier = "NONE" } = {}) {
  const m = { matchupPeriodId: week, playoffTierType: tier, home: { teamId: home, totalPoints: hp } };
  if (away != null) {
    m.away = { teamId: away, totalPoints: ap };
    m.winner = winner ?? (hp > ap ? "HOME" : ap > hp ? "AWAY" : "TIE");
  }
  return m;
}

function rawLeague(schedule, n = 4, current = 3) {
  return {
    id: 1, seasonId: 2026, settings: { name: "Test League" }, status: { currentMatchupPeriod: current },
    members: Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, displayName: `owner${i + 1}` })),
    teams: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, abbrev: `T${i + 1}`, owners: [`m${i + 1}`] })),
    schedule,
  };
}

const byTeam = (res, f) => Object.fromEntries(res.standings.map(s => [s.teamId, f(s)]));
const totals = res => byTeam(res, s => s.total);

const TWO_WEEKS = [
  matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
  matchup(2, 1, 70, 3, 130), matchup(2, 2, 110, 4, 60),
];

test("doubleheader: H2H win + top half", () => {
  const res = compute(parseLeague(rawLeague(TWO_WEEKS.slice(0, 2))), DH);
  assert.deepEqual(totals(res), { 1: 2, 2: 1, 3: 1, 4: 0 });
  assert.deepEqual(byTeam(res, s => s.byRule)[2], { h2h: 0, tophalf: 1 });
  assert.deepEqual(byTeam(res, s => s.byRule)[3], { h2h: 1, tophalf: 0 });
});

test("multiple weeks, tiebreak on points for", () => {
  const res = compute(parseLeague(rawLeague(TWO_WEEKS)), DH);
  assert.deepEqual(res.standings.map(s => [s.teamId, s.total]), [[3, 3], [2, 3], [1, 2], [4, 0]]);
  assert.deepEqual(res.standings.map(s => s.rank), [1, 2, 3, 4]);
});

test("incomplete week excluded", () => {
  const sched = [...TWO_WEEKS];
  sched[3] = { ...sched[3], winner: "UNDECIDED" };
  assert.deepEqual(Object.keys(parseLeague(rawLeague(sched)).weeks), ["1"]);
});

test("playoffs excluded unless asked", () => {
  const sched = [...TWO_WEEKS.slice(0, 2), matchup(15, 1, 100, 3, 90, { tier: "WINNERS_BRACKET" })];
  assert.deepEqual(Object.keys(parseLeague(rawLeague(sched)).weeks), ["1"]);
  assert.deepEqual(Object.keys(parseLeague(rawLeague(sched), { includePlayoffs: true }).weeks), ["1", "15"]);
});

test("tie at the cutoff", () => {
  const scores = new Map([[1, 120], [2, 100], [3, 100], [4, 80]]);
  const got = mode => Object.fromEntries(weeklyRank(scores, { points: 1, count: "half", tieMode: mode }));
  assert.deepEqual(got("all"), { 1: 1, 2: 1, 3: 1 });
  assert.deepEqual(got("split"), { 1: 1, 2: 0.5, 3: 0.5 });
  assert.deepEqual(got("none"), { 1: 1 });
});

test("odd team count with a bye", () => {
  const res = compute(parseLeague(rawLeague([matchup(1, 1, 120, 2, 100), matchup(1, 3, 90)], 3)), DH);
  assert.deepEqual(totals(res), { 1: 2, 2: 0, 3: 0 });
  assert.equal(res.standings.at(-1).weekly[1].result, "BYE");
});

test("H2H tie is half a point", () => {
  const res = compute(parseLeague(rawLeague([matchup(1, 1, 100, 2, 100), matchup(1, 3, 90, 4, 80)])), DH);
  assert.deepEqual(totals(res), { 1: 1.5, 2: 1.5, 3: 1, 4: 0 });
});

test("week range", () => {
  const res = compute(parseLeague(rawLeague(TWO_WEEKS)), DH, { startWeek: 2 });
  assert.deepEqual(res.weeks, [2]);
  assert.deepEqual(totals(res), { 1: 0, 2: 2, 3: 2, 4: 0 });
});

test("all-play", () => {
  const res = compute(parseLeague(rawLeague(TWO_WEEKS.slice(0, 2))), PRESETS.allplay);
  assert.deepEqual(totals(res), { 1: 3, 2: 2, 3: 1, 4: 0 });
});

test("bottom penalty rule", () => {
  const cfg = { rules: [{ id: "low", type: "weekly_rank", side: "bottom", count: 1, points: -1 }], tiebreakers: [] };
  assert.deepEqual(totals(compute(parseLeague(rawLeague(TWO_WEEKS.slice(0, 2))), cfg)), { 1: 0, 2: 0, 3: 0, 4: -1 });
});

test("fully tied teams share a rank", () => {
  const cfg = { rules: [{ id: "x", type: "weekly_rank", count: 0, points: 1 }], tiebreakers: [] };
  assert.deepEqual(compute(parseLeague(rawLeague(TWO_WEEKS.slice(0, 2))), cfg).standings.map(s => s.rank), [1, 1, 1, 1]);
});

test("shotguns count last-place weeks (ties all count)", () => {
  const sched = [...TWO_WEEKS.slice(0, 2), matchup(2, 1, 70, 3, 130), matchup(2, 2, 70, 4, 90)];
  assert.deepEqual(byTeam(compute(parseLeague(rawLeague(sched)), DH), s => s.shotguns), { 1: 1, 2: 1, 3: 0, 4: 1 });
});

test("invalid config", () => {
  assert.throws(() => compute(parseLeague(rawLeague([])), { rules: [{ id: "x", type: "nope" }] }));
});

test("legacy team names and owners", () => {
  const raw = rawLeague([]);
  raw.teams[0] = { id: 1, location: "Big", nickname: "Dogs", owners: ["m1"] };
  const lg = parseLeague(raw);
  assert.equal(lg.teams[1].name, "Big Dogs");
  assert.deepEqual(lg.teams[1].owners, ["owner1"]);
});

// ---- Projections ----

function inProgressLeague() {
  const sched = [
    ...TWO_WEEKS.slice(0, 2),
    matchup(2, 1, 30, 2, 20, { winner: "UNDECIDED" }), matchup(2, 3, 10, 4, 5, { winner: "UNDECIDED" }),
    matchup(3, 1, 0, 3, 0, { winner: "UNDECIDED" }), matchup(3, 2, 0, 4, 0, { winner: "UNDECIDED" }),
  ];
  // Projected: T1 110.5 beats T2 95; T3 80 beats T4 75 -> T4 is the shotgunner.
  Object.assign(sched[2].home, { totalPointsLive: 30, totalProjectedPointsLive: 110.5 });
  Object.assign(sched[2].away, { totalPointsLive: 20, totalProjectedPointsLive: 95 });
  Object.assign(sched[3].home, { totalPointsLive: 10, totalProjectedPointsLive: 80 });
  Object.assign(sched[3].away, { totalPointsLive: 5, totalProjectedPointsLive: 75 });
  return parseLeague(rawLeague(sched, 4, 2));
}

test("projection is parsed for the current week only", () => {
  const lg = inProgressLeague();
  assert.deepEqual(Object.keys(lg.weeks), ["1"]);
  assert.equal(lg.projection.week, 2);
  const t1 = lg.projection.games.find(g => g.teamId === 1);
  assert.deepEqual([t1.points, t1.live, t1.oppId, t1.result], [110.5, 30, 2, "W"]);
});

test("projected standings use the same scoring as real standings", () => {
  const lg = inProgressLeague();
  const proj = project(lg, DH);
  // Week 1: T1 2, T2 1, T3 1, T4 0. Projected week 2: T1 W+top, T2 top, T3 W, T4 nothing.
  assert.deepEqual(totals(proj), { 1: 4, 2: 2, 3: 2, 4: 0 });
  assert.deepEqual(proj.shotgunners.map(s => s.teamId), [4]);
  assert.equal(byTeam(proj, s => s.shotguns)[4], 2);
  assert.deepEqual(byTeam(proj, s => s.prevRank), byTeam(compute(lg, DH), s => s.rank));
  assert.equal(proj.standings.find(s => s.teamId === 1).weekly[2].live, 30);
});

test("no projection when the range ends before the current week", () => {
  assert.equal(project(inProgressLeague(), DH, { endWeek: 1 }), null);
});
