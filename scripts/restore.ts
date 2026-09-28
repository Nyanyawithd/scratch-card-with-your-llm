import { copyDatabase } from "./database-files.ts";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error(
    "用法：npm run restore -- <备份文件> <全新数据库路径>（不会覆盖已有文件）",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await copyDatabase(source, target), null, 2));
    console.log(
      "校验通过。停服后将 DATABASE_PATH 切换到此文件，再启动服务。原数据库保留。",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "恢复失败。");
    process.exitCode = 1;
  }
}
