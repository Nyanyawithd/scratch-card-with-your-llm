import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Game } from "../server/domain.ts";
import { copyDatabase, inspectDatabase } from "../scripts/database-files.ts";

test("online WAL backup and restore retain secrets, notes, balances and idempotency without overwriting files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scratch-backup-test-"));
  const source = join(dir, "live.sqlite"),
    saved = join(dir, "backup.sqlite"),
    restored = join(dir, "restored.sqlite");
  const game = new Game(source);
  let recovered: Game | undefined;
  try {
    game.setNames({ human: "测试用户", llm: "测试助手" });
    const card = game.create("llm", {
      action: "publish",
      cells: [
        { price: 5, content: "已刮的内容" },
        { price: 5, content: "仍密封的内容" },
      ],
      request_id: randomUUID(),
    });
    const award = { points: 20, reason: "备份测试", request_id: randomUUID() };
    const awardResult = game.award("llm", award);
    const summary = game.status("human") as any;
    game.scratch("human", {
      cell_id: summary.cards[0].cells[0].id,
      request_id: randomUUID(),
    });
    game.note("human", {
      card_id: card.id,
      body: "备份里也要保留这句话",
      request_id: randomUUID(),
    });
    const report = await copyDatabase(source, saved);
    assert.equal(report.counts.notes, 1);
    assert.equal(report.counts.ledger, 2);
    const unchanged = readFileSync(saved);
    game.award("llm", {
      points: 9,
      reason: "备份之后才发生",
      request_id: randomUUID(),
    });
    await copyDatabase(saved, restored);
    assert.deepEqual(readFileSync(saved), unchanged);
    recovered = new Game(restored);
    assert.equal(recovered.balance("human"), 15);
    assert.equal(game.balance("human"), 24);
    assert.equal(recovered.settings()!.human, "测试用户");
    assert.deepEqual(recovered.award("llm", award), awardResult);
    assert.equal(recovered.balance("human"), 15);
    assert.ok(
      !JSON.stringify(recovered.status("human")).includes("仍密封的内容"),
    );
    assert.equal(
      (
        recovered.status("llm", {
          section: "authored",
          card_id: card.id,
        }) as any
      ).items[0].cells[1].content,
      "仍密封的内容",
    );
    assert.equal(
      (recovered.status("human", { section: "notes" }) as any).total,
      1,
    );
    await assert.rejects(copyDatabase(source, saved), /拒绝覆盖/);
    await assert.rejects(copyDatabase(saved, source), /拒绝覆盖/);
    assert.deepEqual(readFileSync(saved), unchanged);
    assert.equal(inspectDatabase(restored).version, 1);
  } finally {
    recovered?.close();
    game.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt or unrelated backup never produces a restored target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scratch-invalid-backup-"));
  try {
    const source = join(dir, "invalid.sqlite"),
      target = join(dir, "new.sqlite");
    writeFileSync(source, "not a SQLite database");
    await assert.rejects(copyDatabase(source, target));
    assert.equal(existsSync(target), false);
    writeFileSync(`${target}-wal`, "do not replace");
    await assert.rejects(copyDatabase(source, target), /拒绝覆盖/);
    assert.equal(readFileSync(`${target}-wal`, "utf8"), "do not replace");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
