import { join } from "node:path";
import { copyDatabase } from "./database-files.ts";

const source = process.env.DATABASE_PATH ?? "./data/scratch.sqlite";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target =
  process.argv[2] ??
  join(process.env.BACKUP_DIR ?? "./backups", `scratch-${stamp}.sqlite`);
try {
  console.log(JSON.stringify(await copyDatabase(source, target), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "备份失败。");
  process.exitCode = 1;
}
