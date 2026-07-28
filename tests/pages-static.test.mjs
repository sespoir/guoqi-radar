import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships a self-contained GitHub Pages recruitment dashboard", async () => {
  const [html, css, script, workflow] = await Promise.all([
    readFile(new URL("docs/index.html", root), "utf8"),
    readFile(new URL("docs/styles.css", root), "utf8"),
    readFile(new URL("docs/app.js", root), "utf8"),
    readFile(new URL(".github/workflows/daily-crawl.yml", root), "utf8"),
  ]);

  assert.match(html, /国企雷达/);
  assert.match(html, /中物院（绵阳九院）/);
  assert.match(css, /\.job-card/);
  assert.match(script, /data\/jobs\.json/);
  assert.match(script, /全国/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /AZURE_OPENAI_API_KEY/);
  assert.doesNotMatch(html + css + script + workflow, /ddinfra-openai|api-key\s*[:=]\s*["'][^"']+/i);
});
