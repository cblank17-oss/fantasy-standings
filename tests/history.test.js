// Run: node --test tests/history.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { computeHistory } from "../static/js/history.js";
import { PRESETS } from "../static/js/scoring.js";

const DH = PRESETS.doubleheader;

function matchup(week, home, hp, away, ap, winner) {
  return { matchupPeriodId: week, playoffTierType: "NONE",
    home: { teamId: home, totalPoints: hp }, away: { teamId: away, totalPoints: ap },
    winner: winner ?? (hp > ap ? "HOME" : ap > hp ? "AWAY" : "TIE") };
}

// teams: [[teamId, name, manager, finalRank, seed]]
function season(year, teams, schedule, current = 99) {
  return { season: year, data: {
    id: 1, seasonId: year, settings: { name: "L", scheduleSettings: { playoffTeamCount: 2 } },
    status: { currentMatchupPeriod: current },
    teams: teams.map(([id, name, manager, rank, seed]) => ({ id, name, manager, rankCalculatedFinal: rank, playoffSeed: seed })),
    schedule,
  } };
}

// 2024: A beats B, C beats D (scores 120,100 / 90,80). Final: A 1st, C 2nd, B 3rd, D 4th.
// 2025: team 4 changed hands (manager m4 -> m5). B wins it all.
const S2024 = season(2024,
  [[1, "Alpha", "m1", 1, 1], [2, "Bravo", "m2", 3, 3], [3, "Charlie", "m3", 2, 2], [4, "Delta", "m4", 4, 4]],
  [matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80)]);
const S2025 = season(2025,
  [[1, "Alpha II", "m1", 2, 2], [2, "Bravo", "m2", 1, 1], [3, "Charlie", "m3", 4, 4], [4, "Echo", "m5", 3, 3]],
  [matchup(1, 2, 150, 1, 60), matchup(1, 3, 70, 4, 75)]);
// 2026 in progress: one week done, no final ranks yet.
const S2026 = season(2026,
  [[1, "Alpha II", "m1", 0, 0], [2, "Bravo", "m2", 0, 0], [3, "Charlie", "m3", 0, 0], [4, "Echo", "m5", 0, 0]],
  [matchup(1, 1, 100, 2, 90), matchup(1, 3, 60, 4, 50), matchup(2, 1, 0, 3, 0, "UNDECIDED"), matchup(2, 2, 0, 4, 0, "UNDECIDED")], 2);

const H = computeHistory([S2026, S2024, S2025], DH); // order shouldn't matter
const by = Object.fromEntries(H.managers.map(m => [m.id, m]));

test("managers follow the person, not the team slot", () => {
  assert.deepEqual(H.seasons, [2024, 2025, 2026]);
  assert.equal(H.managers.length, 5);
  assert.equal(by.m1.name, "Alpha II");          // latest team name
  assert.deepEqual(by.m1.names.map(n => n.name), ["Alpha", "Alpha II", "Alpha II"]);
  assert.equal(by.m4.seasons, 1);
  assert.equal(by.m4.active, false);
  assert.equal(by.m5.seasons, 2);
});

test("titles, playoffs, finishes", () => {
  assert.equal(by.m1.titles, 1);
  assert.equal(by.m2.titles, 1);
  assert.equal(by.m1.playoffs, 2);               // seeds 1 and 2 with 2 playoff teams
  assert.equal(by.m1.avgFinish, 1.5);
  assert.equal(by.m2.bySeason[2026].inProgress, true);
  assert.equal(by.m4.bySeason[2024].last, true);
  const s24 = H.summaries.find(s => s.season === 2024);
  assert.deepEqual(s24.champion.map(c => c.team), ["Alpha"]);
  assert.deepEqual(s24.last.map(c => c.team), ["Delta"]);
  assert.equal(H.summaries.find(s => s.season === 2026).complete, false);
});

test("lifetime doubleheader points and shotguns add up", () => {
  // 3 completed weeks x (2 H2H wins + 2 top-half) = 12 points; one shotgun per week.
  assert.equal(H.managers.reduce((a, m) => a + m.total, 0), 12);
  assert.equal(H.managers.reduce((a, m) => a + m.shotguns, 0), 3);
  assert.equal(by.m1.total, 2 + 0 + 2);           // 2024 W+top, 2025 nothing, 2026 W+top
  assert.equal(by.m1.shotguns, 1);               // 60 in 2025
});

test("records, with ties kept", () => {
  assert.equal(H.records.highScore.value, 150);
  assert.equal(H.records.highScore.holders[0].team, "Bravo");
  assert.equal(H.records.lowScore.value, 50);
  assert.equal(H.records.blowout.value, 90);
  assert.equal(H.records.closest.value, 5);
  // Best completed season: 2 points, shared by Alpha (2024), Bravo and Echo (2025).
  assert.equal(H.records.bestSeason.value, 2);
  assert.deepEqual(H.records.bestSeason.holders.map(h => `${h.team} ${h.season}`), ["Alpha 2024", "Bravo 2025", "Echo 2025"]);
});

test("shotguns only count from shotgunsSince; everything else unchanged", () => {
  const h = computeHistory([S2024, S2025, S2026], DH, { shotgunsSince: 2025 });
  const m = Object.fromEntries(h.managers.map(x => [x.id, x]));
  assert.equal(h.managers.reduce((a, x) => a + x.shotguns, 0), 2);  // 2025 + 2026 weeks only
  assert.equal(m.m4.shotguns, 0);                                    // Delta's 2024 shotgun dropped
  assert.equal(m.m4.bySeason[2024].shotguns, null);
  assert.equal(h.summaries.find(s => s.season === 2024).mostShotguns, null);
  assert.ok(h.records.mostShotguns.holders.every(x => x.season >= 2025));
  assert.equal(h.managers.reduce((a, x) => a + x.total, 0), 12);    // doubleheader points untouched
  assert.equal(m.m1.titles, 1);
});

test("a season that hasn't started yet is skipped", () => {
  const fresh = season(2027, [[1, "Alpha II", "m1", 0, 0], [2, "Bravo", "m2", 0, 0]],
    [matchup(1, 1, 0, 2, 0, "UNDECIDED")], 1);
  const h = computeHistory([S2024, fresh], DH);
  assert.equal(h.managers.find(m => m.id === "m1").seasons, 1);
});
