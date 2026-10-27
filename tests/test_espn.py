import unittest

from standings import espn

RAW = {
    "id": 1, "seasonId": 2026, "scoringPeriodId": 8, "draftDetail": {"drafted": True},
    "status": {"currentMatchupPeriod": 8, "isActive": True},
    "settings": {"name": "Test League", "scoringSettings": {}},
    "members": [{"id": "m1", "displayName": "owner1", "notificationSettings": []}],
    "teams": [{"id": 1, "name": "Team 1", "abbrev": "T1", "owners": ["m1"], "roster": {}}],
    "schedule": [
        {"matchupPeriodId": 1, "playoffTierType": "NONE", "winner": "HOME", "id": 9,
         "home": {"teamId": 1, "totalPoints": 100, "rosterForCurrentScoringPeriod": {}},
         "away": {"teamId": 2, "totalPoints": 90}},
        {"matchupPeriodId": 8, "playoffTierType": "NONE", "winner": "UNDECIDED",
         "home": {"teamId": 1, "totalPoints": 0, "totalPointsLive": 12.5, "totalProjectedPointsLive": 101.2},
         "away": {"teamId": 2, "totalPoints": 0}},
        {"matchupPeriodId": 9, "playoffTierType": "NONE", "home": {"teamId": 1, "totalPoints": 0}},
    ],
}


class TrimTests(unittest.TestCase):
    def test_public_trim_drops_owners_and_extra_fields(self):
        t = espn.trim(RAW)
        self.assertNotIn("members", t)
        self.assertNotIn("draftDetail", t)
        self.assertEqual(t["teams"], [{"id": 1, "name": "Team 1", "abbrev": "T1"}])
        self.assertEqual(t["status"], {"currentMatchupPeriod": 8})
        self.assertEqual(t["settings"], {"name": "Test League", "scheduleSettings": {}})
        self.assertEqual(t["schedule"][0]["home"], {"teamId": 1, "totalPoints": 100})
        self.assertEqual(t["schedule"][1]["home"]["totalProjectedPointsLive"], 101.2)
        self.assertNotIn("away", t["schedule"][2])

    def test_local_trim_keeps_owner_names(self):
        t = espn.trim(RAW, keep_members=True)
        self.assertEqual(t["members"], [{"id": "m1", "displayName": "owner1"}])
        self.assertEqual(t["teams"][0]["owners"], ["m1"])

    def test_managers_replace_espn_ids(self):
        t = espn.trim(RAW, managers={"m1": "x1"})
        self.assertEqual(t["teams"][0]["manager"], "x1")
        self.assertNotIn("m1", str(t))

    def test_manager_ids_follow_owners_across_seasons(self):
        from standings import history
        s1 = {"teams": [{"id": 1, "primaryOwner": "A"}, {"id": 2, "owners": ["B"]}]}
        s2 = {"teams": [{"id": 2, "primaryOwner": "C"}, {"id": 1, "primaryOwner": "B"}]}
        self.assertEqual(history.manager_ids([(2020, s1), (2021, s2)]), {"A": "m1", "B": "m2", "C": "m3"})

    def test_finished_matchups(self):
        self.assertEqual(espn.finished_matchups(RAW), 1)


if __name__ == "__main__":
    unittest.main()
