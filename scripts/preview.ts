// Local-only, disposable sample data. Never use these credentials for deployment.
import { randomUUID } from "node:crypto";
import { Game } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
const game = new Game(":memory:");
game.setNames({ human: "我", llm: "小伴" });
// A completed card makes archive, filters and old-card notes reviewable.
const archived = game.create("llm", { action: "publish", request_id: randomUUID(), cells: [{ price: 5, content: "把昨天的一个小开心，认真记下来。" }] });
game.award("llm", { points: 5, reason: "送给昨天的一个小开心。", request_id: randomUUID() });
const archivedSummary = game.status("human", { section: "card", card_id: archived.id }) as any;
game.scratch("human", { cell_id: archivedSummary.cells[0].id, request_id: randomUUID() });
game.note("human", { card_id: archived.id, body: "旧卡也好好收着了，偶尔翻回来看看。", request_id: randomUUID() });
const humanCard = game.create("llm", {
  action: "publish",
  request_id: randomUUID(),
  cells: [
    {
      price: 20,
      content: "给你写一首关于今天的小诗。\n把平凡的小事，也轻轻收好。",
    },
    { price: 15, content: "一起给今天取个可爱的名字。" },
    { price: 25, content: "为你编一个只有三分钟的睡前故事。" },
    { price: 30, content: "一起列出三件让人开心的小事。" },
  ],
});
game.create("human", {
  action: "publish",
  request_id: randomUUID(),
  cells: [
    { price: 10, content: "今天由你选一个话题，我们慢慢聊。" },
    { price: 20, content: "一起创作一个小角色。" },
  ],
});
game.award("llm", {
  points: 95,
  reason: "谢谢你今天也在认真照顾自己。",
  request_id: randomUUID(),
});
game.award("human", {
  points: 35,
  reason: "谢谢你陪我把想法慢慢理清楚。",
  request_id: randomUUID(),
});
const cell = (game.status("human") as any).cards.find(
  (c: any) => c.id === humanCard.id,
).cells[1];
game.scratch("human", { cell_id: cell.id, request_id: randomUUID() });
game.note("llm", {
  card_id: humanCard.id,
  body: "想知道你会先挑哪一格。\n不用急，留一点期待也很好。",
  request_id: randomUUID(),
});
const app = createApp(game, {
  webToken: "local-preview-only-do-not-deploy-12345",
  mcpToken: "local-preview-mcp-do-not-deploy-12345",
  origin: "http://127.0.0.1:3001",
  production: false,
});
app.listen(3001, "127.0.0.1", () =>
  console.log("本地样例预览：http://127.0.0.1:3001（内存数据，重启重置）"),
);
