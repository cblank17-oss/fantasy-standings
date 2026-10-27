import tempfile
import unittest
from pathlib import Path

import build


class StampTests(unittest.TestCase):
    def test_every_css_and_js_reference_gets_the_same_version(self):
        with tempfile.TemporaryDirectory() as d:
            site = Path(d)
            (site / "js").mkdir()
            (site / "index.html").write_text(
                '<link rel="stylesheet" href="css/styles.css"><script type="module" src="js/main.js"></script>')
            (site / "js" / "main.js").write_text(
                'import { a } from "./espn.js";\nimport { b } from "./render.js";\nconst x = "not/a/ref.js";')
            (site / "js" / "espn.js").write_text("export const a = 1;")
            v = build.stamp_assets(site)
            html = (site / "index.html").read_text()
            js = (site / "js" / "main.js").read_text()
            self.assertIn(f'href="css/styles.css?v={v}"', html)
            self.assertIn(f'src="js/main.js?v={v}"', html)
            self.assertIn(f'from "./espn.js?v={v}"', js)
            self.assertIn(f'from "./render.js?v={v}"', js)
            self.assertIn('"not/a/ref.js"', js)  # plain strings are left alone


if __name__ == "__main__":
    unittest.main()
