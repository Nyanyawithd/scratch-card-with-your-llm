import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Game, DomainError, type Actor } from "../server/domain.ts";

const request_id = () => randomUUID();
function publish(game: Game, author: Actor, prices = [10, 20]) {
  const card = game.create(author, {
    action: "publish",
    cells: prices.map((price, i) => ({
      price,
      content: `secret-${author}-${i}`,
    })),
    request_id: request_id(),
  });
  const view = game.status(author, {
    section: "authored",
    card_id: card.id,
  }) as any;
  return { ...card, cells: view.items[0].cells };
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof DomainError && error.code === expected;
}

test("bidirectional flow: owner, secrecy, reward, reveal, archive, independent replacement", () => {
  const game = new Game(":memory:");
  try {
    const humanCard = publish(game, "llm", [10]);
    const llmCard = publish(game, "human");
    const overview = game.status("human") as any;
    assert.equal(overview.cards.length, 2);
    assert.ok(!JSON.stringify(overview).includes("secret-"));
    assert.ok(!JSON.stringify(overview).includes("content"));
    assert.deepEqual(
      (
        game.status("human", {
          section: "results",
          card_id: humanCard.id,
        }) as any
      ).cells,
      [],
    );
    assert.throws(
      () =>
        game.status("human", { section: "authored", card_id: humanCard.id }),
      code("FORBIDDEN"),
    );
    assert.throws(
      () =>
        game.scratch("human", {
          cell_id: llmCard.cells[0].id,
          request_id: request_id(),
        }),
      code("FORBIDDEN"),
    );
    assert.throws(
      () =>
        game.scratch("human", {
          cell_id: humanCard.cells[0].id,
          request_id: request_id(),
        }),
      code("INSUFFICIENT_POINTS"),
    );
    assert.equal(
      game.db.prepare("SELECT COUNT(*) AS n FROM ledger").get()!.n,
      0,
    );
    game.award("llm", {
      points: 10,
      reason: "一份鼓励",
      request_id: request_id(),
    });
    const input = { cell_id: humanCard.cells[0].id, request_id: request_id() };
    const result = game.scratch("human", input);
    assert.equal(result.content, "secret-llm-0");
    assert.equal(result.balance, 0);
    assert.equal(result.completed, true);
    assert.deepEqual(game.scratch("human", input), result);
    assert.throws(
      () => game.scratch("human", { ...input, request_id: request_id() }),
      code("ALREADY_SCRATCHED"),
    );
    assert.equal(
      (game.status("llm", { section: "results", card_id: humanCard.id }) as any)
        .cells[0].content,
      result.content,
    );
    assert.equal(
      (game.status("human", { section: "history" }) as any).total,
      1,
    );
    assert.equal(publish(game, "llm", [1]).owner_sequence, 2);
    assert.throws(() => publish(game, "human"), code("ACTIVE_CARD_EXISTS"));
    game.award("human", {
      points: 10,
      reason: "谢谢陪伴",
      request_id: request_id(),
    });
    assert.equal(
      game.scratch("llm", {
        cell_id: llmCard.cells[0].id,
        request_id: request_id(),
      }).content,
      "secret-human-0",
    );
    assert.equal(game.balance("llm"), 0);
  } finally {
    game.close();
  }
});

test("award idempotency, payload conflict, strict inputs and immutable ledger", () => {
  const game = new Game(":memory:");
  try {
    const input = { points: 30, reason: "谢谢", request_id: request_id() };
    assert.deepEqual(game.award("human", input), game.award("human", input));
    assert.equal(game.balance("llm"), 30);
    assert.equal(game.balance("human"), 0);
    assert.throws(
      () => game.award("human", { ...input, points: 40 }),
      code("IDEMPOTENCY_CONFLICT"),
    );
    for (const points of [-1, 0, 1.5, 1000001])
      assert.throws(() => game.award("human", { ...input, points }));
    assert.throws(() =>
      game.award("human", { ...input, beneficiary: "human" }),
    );
    assert.throws(() => game.db.exec("DELETE FROM ledger"));
    assert.throws(() => game.db.exec("UPDATE ledger SET amount=100"));
  } finally {
    game.close();
  }
});

test("one-million point boundary completes award, publish and scratch", () => {
  const game = new Game(":memory:");
  try {
    const award = game.award("llm", {
      points: 1_000_000,
      reason: "边界值奖励",
      request_id: request_id(),
    });
    assert.equal(award.balance, 1_000_000);
    assert.equal(game.balance("human"), 1_000_000);
    assert.equal(
      game.db
        .prepare("SELECT amount FROM ledger WHERE id=?")
        .get(award.id)!.amount,
      1_000_000,
    );

    const card = publish(game, "llm", [1_000_000]);
    assert.equal(card.cells[0].price, 1_000_000);
    const result = game.scratch("human", {
      cell_id: card.cells[0].id,
      request_id: request_id(),
    });
    assert.equal(result.spent, 1_000_000);
    assert.equal(result.balance, 0);
    assert.equal(result.completed, true);
    assert.equal(result.content, "secret-llm-0");

    assert.throws(
      () =>
        game.create("human", {
          action: "publish",
          cells: [{ price: 1_000_001, content: "越界" }],
          request_id: request_id(),
        }),
      (error: unknown) => error instanceof Error,
    );
  } finally {
    game.close();
  }
});

test("drafts remain private, publishing locks them, notes enforce card relationship", () => {
  const game = new Game(":memory:");
  try {
    const draft = game.create("human", {
      action: "save_draft",
      cells: [{ price: 5, content: "draft-secret" }],
      request_id: request_id(),
    });
    assert.equal((game.status("llm") as any).cards.length, 0);
    assert.throws(
      () => game.status("llm", { section: "results", card_id: draft.id }),
      code("NOT_FOUND"),
    );
    assert.throws(
      () =>
        game.note("human", {
          card_id: draft.id,
          body: "hi",
          request_id: request_id(),
        }),
      code("FORBIDDEN"),
    );
    const card = game.create("human", {
      action: "publish",
      draft_id: draft.id,
      cells: [{ price: 5, content: "final" }],
      request_id: request_id(),
    });
    assert.throws(
      () =>
        game.create("human", {
          action: "save_draft",
          draft_id: card.id,
          cells: [{ price: 5, content: "changed" }],
          request_id: request_id(),
        }),
      code("NOT_FOUND"),
    );
    const another = publish(game, "llm");
    assert.throws(
      () =>
        game.note("human", {
          card_id: card.id,
          cell_id: another.cells[0].id,
          body: "hi",
          request_id: request_id(),
        }),
      code("VALIDATION_ERROR"),
    );
    const input = {
      card_id: card.id,
      body: "期待！",
      request_id: request_id(),
    };
    assert.deepEqual(game.note("llm", input), game.note("llm", input));
    assert.equal(
      (game.status("human", { section: "notes", note_author: "llm" }) as any)
        .total,
      1,
    );
    assert.throws(() => game.db.exec("DELETE FROM notes"));
  } finally {
    game.close();
  }
});

test("failed transaction rolls back reveal, charge and idempotency, and can retry", () => {
  const game = new Game(":memory:");
  try {
    const card = publish(game, "llm", [10]);
    game.award("llm", { points: 10, reason: "hi", request_id: request_id() });
    game.db.exec(
      "CREATE TRIGGER fail_charge BEFORE INSERT ON ledger WHEN NEW.kind='scratch' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    const input = { cell_id: card.cells[0].id, request_id: request_id() };
    assert.throws(() => game.scratch("human", input));
    assert.equal(game.balance("human"), 10);
    assert.equal(
      game.db.prepare("SELECT status FROM cells WHERE id=?").get(input.cell_id)!
        .status,
      "sealed",
    );
    assert.equal(
      game.db
        .prepare("SELECT COUNT(*) AS n FROM requests WHERE request_id=?")
        .get(input.request_id)!.n,
      0,
    );
    game.db.exec("DROP TRIGGER fail_charge");
    assert.equal(game.scratch("human", input).balance, 0);
  } finally {
    game.close();
  }
});

test("disk persistence and migration survive reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "scratch-test-"));
  const path = join(dir, "game.sqlite");
  try {
    const game = new Game(path);
    game.setNames({ human: "小明", llm: "小伴" });
    game.award("llm", { points: 7, reason: "saved", request_id: request_id() });
    game.close();
    const reopened = new Game(path);
    assert.equal(reopened.balance("human"), 7);
    assert.equal(reopened.settings()!.human, "小明");
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
