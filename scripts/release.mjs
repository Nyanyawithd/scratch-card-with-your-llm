import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const dir = join(root, "release");
mkdirSync(dir, { recursive: true });
const target = join(
  dir,
  `scratch-card-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`,
);
// Explicit allowlist: no .env, SQLite data, backups, cache or node_modules.
const files = [
  "dist",
  "server",
  "scripts",
  "deploy",
  "package.json",
  "package-lock.json",
  ".env.example",
  "README.md",
  "LICENSE",
];
const result = spawnSync("tar", ["-czf", target, "-C", root, ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else console.log(`发布包：${target}`);
