import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  linkSync,
  unlinkSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const tables = [
  "settings",
  "cards",
  "cells",
  "ledger",
  "notes",
  "requests",
] as const;

export function inspectDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const checks = db.prepare("PRAGMA integrity_check").all();
    if (checks.length !== 1 || checks[0].integrity_check !== "ok")
      throw new Error("数据库完整性校验失败。");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("数据库关联校验失败。");
    const version = Number(
      db.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version !== 1) throw new Error(`不支持的数据库版本：${version}`);
    const counts = Object.fromEntries(
      tables.map((table) => [
        table,
        Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n),
      ]),
    );
    if (counts.settings !== 1) throw new Error("数据库设置记录不完整。");
    return { version, counts };
  } finally {
    db.close();
  }
}

/** SQLite online backup, staged + validated, then atomically published without replacement. */
export async function copyDatabase(source: string, target: string) {
  const sourcePath = resolve(source),
    targetPath = resolve(target);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile())
    throw new Error("源数据库不存在。");
  if ([targetPath, `${targetPath}-wal`, `${targetPath}-shm`].some(existsSync))
    throw new Error("目标或其 WAL 文件已存在，拒绝覆盖；请选择全新路径。");
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  const tempDir = mkdtempSync(join(dirname(targetPath), ".scratch-backup-"));
  chmodSync(tempDir, 0o700);
  const staged = join(tempDir, "snapshot.sqlite");
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(sourceDb, staged);
    chmodSync(staged, 0o600);
    const report = inspectDatabase(staged);
    // Same filesystem hard link gives exclusive creation without a partial target file.
    linkSync(staged, targetPath);
    return { path: targetPath, ...report };
  } finally {
    sourceDb.close();
    for (const file of [staged, `${staged}-wal`, `${staged}-shm`])
      if (existsSync(file)) unlinkSync(file);
    rmdirSync(tempDir);
  }
}
