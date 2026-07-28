import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../docs/data/jobs.json", import.meta.url);
const payload = JSON.parse(await readFile(file, "utf8"));

assert.ok(Array.isArray(payload.jobs), "jobs must be an array");
assert.ok(payload.jobs.length > 0, "the public feed must contain at least one job");
assert.equal(typeof payload.status, "object", "status must be an object");
assert.ok(payload.status.sourceCount >= 20, "the feed must report the configured sources");

for (const job of payload.jobs) {
  assert.equal(typeof job.id, "string");
  assert.equal(typeof job.company, "string");
  assert.equal(typeof job.title, "string");
  assert.match(job.sourceUrl, /^https?:\/\//);
}

console.log(`Validated ${payload.jobs.length} public recruitment records.`);
