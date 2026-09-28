import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Game } from "../server/domain.ts";

test("catalog covers older cards with pagination, excludes drafts and secrets; owner filters count correctly", () => {
  const game = new Game(":memory:");
  try {
    const humanCards: string[] = [];
    for (let i = 0; i < 53; i++) {
      const created = game.create("llm", {
        action: "publish",
        cells: [{ price: 1, content: `private ${i}` }],
        request_id: randomUUID(),
      });
      humanCards.push(created.id);
      game.award("llm", {
        points: 1,
        reason: "test",
        request_id: randomUUID(),
      });
      const summary = game.status("human", {
        section: "card",
        card_id: created.id,
      }) as any;
      assert.ok(!JSON.stringify(summary).includes("content"));
      game.scratch("human", {
        cell_id: summary.cells[0].id,
        request_id: randomUUID(),
      });
      game.note("human", {
        card_id: created.id,
        body: `note ${i}`,
        request_id: randomUUID(),
      });
    }
    game.create("human", {
      action: "publish",
      cells: [{ price: 1, content: "other owner" }],
      request_id: randomUUID(),
    });
    const draft = game.create("llm", {
      action: "save_draft",
      cells: [{ price: 1, content: "draft secret" }],
      request_id: randomUUID(),
    });
    const first = game.status("human", {
      section: "catalog",
      limit: 50,
    }) as any;
    assert.equal(first.total, 54);
    assert.equal(first.items.length, 50);
    const last = game.status("human", {
      section: "catalog",
      limit: 50,
      cursor: first.next_cursor,
    }) as any;
    assert.equal(last.items.length, 4);
    assert.equal(last.next_cursor, null);
    const combined = [...first.items, ...last.items];
    assert.equal(new Set(combined.map((c) => c.id)).size, 54);
    assert.ok(!JSON.stringify(combined).includes("private"));
    assert.ok(!combined.some((c) => c.id === draft.id));
    assert.equal(
      (game.status("human", { section: "history", owner: "human" }) as any)
        .total,
      53,
    );
    assert.equal(
      (game.status("human", { section: "history", owner: "llm" }) as any).total,
      0,
    );
    assert.equal(
      (game.status("human", { section: "ledger", owner: "human" }) as any)
        .total,
      106,
    );
    assert.equal(
      (game.status("human", { section: "ledger", owner: "llm" }) as any).total,
      0,
    );
    const notes = game.status("human", {
      section: "notes",
      card_id: humanCards[0],
      note_author: "human",
      limit: 1,
    }) as any;
    assert.equal(notes.total, 1);
    assert.equal(notes.items[0].body, "note 0");
    assert.throws(() =>
      game.status("human", { section: "card", card_id: draft.id }),
    );
  } finally {
    game.close();
  }
});
