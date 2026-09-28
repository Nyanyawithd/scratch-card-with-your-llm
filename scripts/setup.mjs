import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const env = `HOST=127.0.0.1\nPORT=3000\nPUBLIC_ORIGIN=http://127.0.0.1:3000\nDATABASE_PATH=./data/scratch.sqlite\nHUMAN_NICKNAME=我\nLLM_NICKNAME=小伴\nWEB_TOKEN=${randomBytes(32).toString("hex")}\nMCP_TOKEN=${randomBytes(32).toString("hex")}\nNODE_ENV=development\n`;
try {
  writeFileSync(".env", env, { flag: "wx", mode: 0o600 });
  console.log("已创建 .env，访问口令保存在文件中。");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env 已存在，保留现有配置。");
  else throw error;
}
