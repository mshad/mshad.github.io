import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync("index.html", "utf8");
const errors = [];

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
for (const id of new Set(ids)) {
  if (ids.filter((candidate) => candidate === id).length > 1) errors.push(`Duplicate id: ${id}`);
}

for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|mailto:|data:)/.test(ref)) continue;
  const localPath = ref.split(/[?#]/, 1)[0];
  if (!existsSync(resolve(localPath))) errors.push(`Missing local reference: ${ref}`);
}

for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  try { JSON.parse(match[1]); } catch (error) { errors.push(`Invalid JSON-LD: ${error.message}`); }
}

if (!html.includes('href="#main-content"')) errors.push("Missing skip link");
if (!html.includes('rel="canonical"')) errors.push("Missing canonical URL");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Site checks passed (${ids.length} unique IDs, all local references present).`);
}
