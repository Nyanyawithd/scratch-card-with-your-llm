import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Game } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("HTTP + official MCP client: auth isolation, no SSE, complete two-sided flow, concurrent spending", async () => {
  const game = new Game(":memory:");
  const webToken = "w".repeat(40),
    mcpToken = "m".repeat(40);
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  server.on(
    "request",
    createApp(game, { webToken, mcpToken, origin, production: false }),
  );
  let cookie = "";
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const responseTypes: string[] = [];
  const transport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    {
      requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (init?.method === "POST" && response.status === 200)
          responseTypes.push(response.headers.get("content-type") ?? "");
        return response;
      },
    },
  );
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  try {
    assert.equal((await request("/api/status")).status, 401);
    assert.equal(
      (await request("/api/login", {}, { Authorization: `Bearer ${mcpToken}` }))
        .status,
      401,
    );
    assert.equal(
      (await request("/mcp", {}, { Authorization: `Bearer ${webToken}` }))
        .status,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/login",
          {},
          {
            Authorization: `Bearer ${webToken}`,
            Origin: "https://evil.example",
          },
        )
      ).status,
      403,
    );
    const login = await request(
      "/api/login",
      {},
      { Authorization: `Bearer ${webToken}` },
    );
    assert.equal(login.status, 200);
    const rawCookie = login.headers.get("set-cookie")!;
    assert.match(rawCookie, /HttpOnly/);
    assert.match(rawCookie, /SameSite=Strict/);
    cookie = rawCookie.split(";")[0];
    assert.equal(
      (
        await request(
          "/api/award",
          { points: 10, reason: "hi", request_id: randomUUID() },
          { Origin: "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/award", {
          points: 10,
          reason: "hi",
          beneficiary: "human",
          request_id: randomUUID(),
        })
      ).status,
      400,
    );
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 5);
    assert.equal(
      (
        await request("/mcp", undefined, {
          Authorization: `Bearer ${mcpToken}`,
        })
      ).status,
      405,
    );
    const humanCard = await tool("scratchcard_create", {
      action: "publish",
      cells: [
        { price: 10, content: "给你一首诗" },
        { price: 10, content: "给你一个故事" },
      ],
      request_id: randomUUID(),
    });
    await tool("scratchcard_award", {
      points: 10,
      reason: "谢谢你今天的认真",
      request_id: randomUUID(),
    });
    const overviewResponse = await request("/api/status");
    assert.equal(overviewResponse.headers.get("cache-control"), "no-store");
    const overview = await overviewResponse.json();
    assert.ok(!JSON.stringify(overview).includes("content"));
    const cells = overview.cards[0].cells;
    const responses = await Promise.all(
      cells.map((cell: any) =>
        request("/api/scratch", { cell_id: cell.id, request_id: randomUUID() }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(game.balance("human"), 0);
    assert.equal(
      game.db
        .prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='scratch'")
        .get()!.n,
      1,
    );
    const stillSealed = game.db
      .prepare("SELECT id FROM cells WHERE status='sealed' AND card_id=?")
      .get(humanCard.id)!.id;
    await tool("scratchcard_award", {
      points: 10,
      reason: "还有一点鼓励",
      request_id: randomUUID(),
    });
    const repeated = await Promise.all(
      [1, 2].map(() =>
        request("/api/scratch", {
          cell_id: stillSealed,
          request_id: randomUUID(),
        }),
      ),
    );
    assert.deepEqual(repeated.map((r) => r.status).sort(), [200, 409]);
    assert.equal(game.balance("human"), 0);
    const llmCardResponse = await request("/api/cards", {
      action: "publish",
      cells: [{ price: 5, content: "一起编一个故事" }],
      request_id: randomUUID(),
    });
    assert.equal(llmCardResponse.status, 200);
    const llmCard = await llmCardResponse.json();
    await request("/api/award", {
      points: 5,
      reason: "写得真好",
      request_id: randomUUID(),
    });
    const status = await tool("scratchcard_status", {});
    const llmCell = status.cards.find((c: any) => c.id === llmCard.id).cells[0];
    const scratched = await tool("scratchcard_scratch", {
      cell_id: llmCell.id,
      request_id: randomUUID(),
    });
    assert.equal(scratched.content, "一起编一个故事");
    assert.equal(scratched.completed, true);
    await tool("scratchcard_note", {
      card_id: llmCard.id,
      body: "我很喜欢这张卡。",
      request_id: randomUUID(),
    });
    assert.equal(
      (await (await request("/api/status?section=notes")).json()).total,
      1,
    );
    assert.ok(responseTypes.length > 0);
    assert.ok(
      responseTypes.every((value) => value.startsWith("application/json")),
    );
    await request("/api/logout", {});
    assert.equal((await request("/api/status")).status, 401);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    game.close();
  }
});
