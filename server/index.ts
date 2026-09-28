import { Game } from "./domain.ts";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是有效端口。");
const game = new Game(
  process.env.DATABASE_PATH ?? "./data/scratch.sqlite",
  process.env.HUMAN_NICKNAME,
  process.env.LLM_NICKNAME,
);
const app = createApp(game, {
  webToken: process.env.WEB_TOKEN ?? "",
  mcpToken: process.env.MCP_TOKEN ?? "",
  origin: process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
  production: process.env.NODE_ENV === "production",
});
const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(
    `刮刮卡已启动：${process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      game.close();
      process.exit(0);
    }),
  );
