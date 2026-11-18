// THROWAWAY: turns results/s9-soak.json into a short table for results/s9-soak.md. node s9-soak/summarize.mjs
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../results/s9-soak.json', import.meta.url), 'utf8'));
const rows = data.samples.filter((s) => s.procMB?.total);
const slope = (points) => {
  // Least-squares slope in MB per minute.
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return den === 0 ? 0 : (num / den) * 60;
};
const series = (key) => rows.map((s) => ({ x: s.tSec, y: key === 'heap' ? s.heapMB : (s.procMB[key] ?? 0) })).filter((p) => p.y !== null);
const lines = [];
lines.push(`minutes: ${data.minutes}, cycles: ${data.cycles}, seeks: ${data.seeks}, samples: ${rows.length}, page errors: ${data.errors.length}`);
lines.push('');
lines.push('| minute | total MB | renderer MB | gpu MB | browser MB | JS heap MB |');
lines.push('|---|---|---|---|---|---|');
const bucket = Math.max(1, Math.round(rows.length / 12));
for (let i = 0; i < rows.length; i += bucket) {
  const s = rows[i];
  lines.push(`| ${(s.tSec / 60).toFixed(1)} | ${s.procMB.total} | ${s.procMB.renderer ?? ''} | ${s.procMB.gpu ?? ''} | ${s.procMB.browser ?? ''} | ${s.heapMB ?? ''} |`);
}
const half = Math.floor(rows.length / 2);
const second = rows.slice(half);
const maxTotal = Math.max(...rows.map((r) => r.procMB.total));
lines.push('');
lines.push(`first / last / max total: ${rows[0].procMB.total} / ${rows.at(-1).procMB.total} / ${maxTotal} MB`);
lines.push(`slope over the whole run (MB per minute): total ${slope(series('total')).toFixed(1)}, renderer ${slope(series('renderer')).toFixed(1)}, gpu ${slope(series('gpu')).toFixed(1)}, js heap ${slope(series('heap')).toFixed(1)}`);
lines.push(`slope over the second half: total ${slope(second.map((s) => ({ x: s.tSec, y: s.procMB.total }))).toFixed(1)} MB per minute`);
if (data.errors.length > 0) lines.push('', 'page errors (first 5):', ...data.errors.slice(0, 5).map((e) => `- ${e.slice(0, 160)}`));
console.log(lines.join('\n'));
