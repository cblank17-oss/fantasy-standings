import unittest

from standings import espn, rules


def matchup(week, home, hp, away=None, ap=None, winner=None, tier="NONE"):
    m = {"matchupPeriodId": week, "playoffTierType": tier,
         "home": {"teamId": home, "totalPoints": hp}}
    if away is not None:
        m["away"] = {"teamId": away, "totalPoints": ap}
        m["winner"] = winner or ("HOME" if hp > ap else "AWAY" if ap > hp else "TIE")
    return m


def raw_league(schedule, n=4):
    return {
        "id": 1, "seasonId": 2026,
        "settings": {"name": "Test League", "scheduleSettings": {"matchupPeriodCount": 14}},
        "status": {"currentMatchupPeriod": 3},
        "members": [{"id": f"m{i}", "displayName": f"owner{i}"} for i in range(1, n + 1)],
        "teams": [{"id": i, "name": f"Team {i}", "abbrev": f"T{i}", "owners": [f"m{i}"]}
                  for i in range(1, n + 1)],
        "schedule": schedule,
    }


DH = rules.PRESETS["doubleheader"]


class DoubleheaderTests(unittest.TestCase):
    def test_basic_week(self):
        # Scores: T1 120, T2 100, T3 90, T4 80. Top half = T1, T2.
        lg = espn.parse_league(raw_league([
            matchup(1, 1, 120, 2, 100),  # T1 beats T2
            matchup(1, 3, 90, 4, 80),    # T3 beats T4
        ]))
        res = rules.compute(lg, DH)
        pts = {s["teamId"]: s["total"] for s in res["standings"]}
        self.assertEqual(pts, {1: 2, 2: 1, 3: 1, 4: 0})
        by = {s["teamId"]: s["byRule"] for s in res["standings"]}
        self.assertEqual(by[2], {"h2h": 0, "tophalf": 1})
        self.assertEqual(by[3], {"h2h": 1, "tophalf": 0})

    def test_multiple_weeks_and_tiebreak_on_points_for(self):
        lg = espn.parse_league(raw_league([
            matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
            matchup(2, 1, 70, 3, 130), matchup(2, 2, 110, 4, 60),
        ]))
        res = rules.compute(lg, DH)
        order = [(s["teamId"], s["total"]) for s in res["standings"]]
        # T1: 2+0=2 (PF 190), T2: 1+2=3, T3: 1+2=3 (PF 220 > T2's 210), T4: 0
        self.assertEqual(order, [(3, 3), (2, 3), (1, 2), (4, 0)])
        self.assertEqual([s["rank"] for s in res["standings"]], [1, 2, 3, 4])

    def test_incomplete_week_excluded(self):
        sched = [matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
                 matchup(2, 1, 50, 2, 40), matchup(2, 3, 30, 4, 20)]
        sched[3]["winner"] = "UNDECIDED"
        lg = espn.parse_league(raw_league(sched))
        self.assertEqual(sorted(lg.weeks), [1])

    def test_playoffs_excluded_by_default(self):
        sched = [matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
                 matchup(15, 1, 100, 3, 90, tier="WINNERS_BRACKET")]
        self.assertEqual(sorted(espn.parse_league(raw_league(sched)).weeks), [1])
        self.assertEqual(sorted(espn.parse_league(raw_league(sched), True).weeks), [1, 15])

    def test_tie_at_cutoff_modes(self):
        scores = {1: 120, 2: 100, 3: 100, 4: 80}
        rule = {"points": 1, "count": "half"}
        self.assertEqual(rules._weekly_rank(scores, {**rule, "tieMode": "all"}), {1: 1, 2: 1, 3: 1})
        self.assertEqual(rules._weekly_rank(scores, {**rule, "tieMode": "split"}), {1: 1, 2: 0.5, 3: 0.5})
        self.assertEqual(rules._weekly_rank(scores, {**rule, "tieMode": "none"}), {1: 1})

    def test_odd_team_count_with_bye(self):
        lg = espn.parse_league(raw_league([
            matchup(1, 1, 120, 2, 100), matchup(1, 3, 90),  # T3 on bye
        ], n=3))
        res = rules.compute(lg, DH)
        pts = {s["teamId"]: s["total"] for s in res["standings"]}
        # 3 teams -> top 1 gets the point.
        self.assertEqual(pts, {1: 2, 2: 0, 3: 0})
        self.assertEqual(res["standings"][-1]["weekly"][1]["result"], "BYE")

    def test_h2h_tie(self):
        lg = espn.parse_league(raw_league([matchup(1, 1, 100, 2, 100), matchup(1, 3, 90, 4, 80)]))
        res = rules.compute(lg, DH)
        pts = {s["teamId"]: s["total"] for s in res["standings"]}
        self.assertEqual(pts, {1: 1.5, 2: 1.5, 3: 1, 4: 0})

    def test_week_range(self):
        lg = espn.parse_league(raw_league([
            matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
            matchup(2, 1, 70, 3, 130), matchup(2, 2, 110, 4, 60),
        ]))
        res = rules.compute(lg, DH, start_week=2)
        self.assertEqual(res["weeks"], [2])
        self.assertEqual({s["teamId"]: s["total"] for s in res["standings"]}, {1: 0, 2: 2, 3: 2, 4: 0})


class OtherRuleTests(unittest.TestCase):
    def test_all_play(self):
        lg = espn.parse_league(raw_league([matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80)]))
        res = rules.compute(lg, rules.PRESETS["allplay"])
        self.assertEqual({s["teamId"]: s["total"] for s in res["standings"]}, {1: 3, 2: 2, 3: 1, 4: 0})

    def test_bottom_penalty_rule(self):
        cfg = {"rules": [{"id": "low", "type": "weekly_rank", "side": "bottom",
                          "count": 1, "points": -1}], "tiebreakers": []}
        lg = espn.parse_league(raw_league([matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80)]))
        res = rules.compute(lg, cfg)
        self.assertEqual({s["teamId"]: s["total"] for s in res["standings"]}, {1: 0, 2: 0, 3: 0, 4: -1})

    def test_shared_rank_when_fully_tied(self):
        cfg = {"rules": [{"id": "low", "type": "weekly_rank", "count": 0, "points": 1}],
               "tiebreakers": []}
        lg = espn.parse_league(raw_league([matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80)]))
        self.assertEqual([s["rank"] for s in rules.compute(lg, cfg)["standings"]], [1, 1, 1, 1])

    def test_shotguns_count_last_place_weeks(self):
        lg = espn.parse_league(raw_league([
            matchup(1, 1, 120, 2, 100), matchup(1, 3, 90, 4, 80),
            matchup(2, 1, 70, 3, 130), matchup(2, 2, 70, 4, 90),  # T1 and T2 tie for last
        ]))
        res = rules.compute(lg, DH)
        self.assertEqual({s["teamId"]: s["shotguns"] for s in res["standings"]}, {1: 1, 2: 1, 3: 0, 4: 1})

    def test_invalid_config(self):
        lg = espn.parse_league(raw_league([]))
        with self.assertRaises(rules.ConfigError):
            rules.compute(lg, {"rules": [{"id": "x", "type": "nope"}]})

    def test_legacy_team_names(self):
        raw = raw_league([])
        raw["teams"][0] = {"id": 1, "location": "Big", "nickname": "Dogs", "owners": []}
        self.assertEqual(espn.parse_league(raw).teams[1].name, "Big Dogs")


if __name__ == "__main__":
    unittest.main()
