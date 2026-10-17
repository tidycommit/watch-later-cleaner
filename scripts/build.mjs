// Package the extension into dist/watch-later-cleaner.zip (and an unpacked copy in dist/extension).
// Usage: node scripts/build.mjs [extra-output-path.zip]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const dist = path.join(root, 'dist');
const zipPath = path.join(dist, 'watch-later-cleaner.zip');

// Sanity checks: valid MV3 manifest, every referenced file exists, no remote code.
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
const referenced = [
  ...manifest.content_scripts.flatMap((c) => c.js),
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
];
for (const f of referenced) if (!fs.existsSync(path.join(src, f))) throw new Error(`missing file: ${f}`);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(src).filter((f) => /\.(js|html)$/.test(f))) {
  const text = fs.readFileSync(f, 'utf8');
  if (/<script[^>]+src=["']https?:|import\s*\(\s*["']https?:|\beval\s*\(|new Function\s*\(/.test(text)) {
    throw new Error(`possible remote/dynamic code in ${path.relative(root, f)}`);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(src, path.join(dist, 'extension'), { recursive: true });
const entries = fs.readdirSync(src);
execFileSync('python3', ['-m', 'zipfile', '-c', zipPath, ...entries], { cwd: src, stdio: 'inherit' });
console.log(`Built ${path.relative(root, zipPath)} (${fs.statSync(zipPath).size} bytes)`);

const extra = process.argv[2];
if (extra) {
  fs.copyFileSync(zipPath, path.resolve(extra));
  console.log(`Copied to ${path.resolve(extra)}`);
}
