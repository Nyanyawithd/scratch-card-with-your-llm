import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export type Actor = "human" | "llm";
export class DomainError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const requestId = z.string().min(8).max(128);
const bodyText = z.string().trim().min(1).max(2000);
const points = z.number().int().min(1).max(1_000_000);
export const awardSchema = z
  .object({
    points,
    reason: z.string().trim().min(1).max(500),
    request_id: requestId,
  })
  .strict();
export const createSchema = z
  .object({
    cells: z
      .array(z.object({ price: points, content: bodyText }).strict())
      .min(1)
      .max(12),
    action: z.enum(["save_draft", "publish"]),
    draft_id: z.string().uuid().optional(),
    request_id: requestId,
  })
  .strict();
export const scratchSchema = z
  .object({ cell_id: z.string().uuid(), request_id: requestId })
  .strict();
export const noteSchema = z
  .object({
    card_id: z.string().uuid(),
    cell_id: z.string().uuid().optional(),
    body: bodyText,
    request_id: requestId,
  })
  .strict();
export const statusSchema = z
  .object({
    section: z
      .enum([
        "overview",
        "history",
        "ledger",
        "notes",
        "authored",
        "results",
        "catalog",
        "card",
      ])
      .default("overview"),
    card_id: z.string().uuid().optional(),
    cursor: z.string().regex(/^\d+$/).max(9).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    note_author: z.enum(["human", "llm"]).optional(),
    owner: z.enum(["human", "llm"]).optional(),
  })
  .strict();
type Card = {
  id: string;
  owner: Actor;
  author: Actor;
  owner_sequence: number | null;
  status: string;
  created_at: string;
  published_at: string | null;
  completed_at: string | null;
};
type Cell = {
  id: string;
  card_id: string;
  position: number;
  price: number;
  status: string;
  scratched_at: string | null;
  content: string;
};
const other = (actor: Actor): Actor => (actor === "human" ? "llm" : "human");
const now = () => new Date().toISOString();

export class Game {
  readonly db: DatabaseSync;
  constructor(path: string, human = "我", llm = "小伴") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 1)
      throw new Error("数据库版本高于当前程序，请使用匹配版本。");
    if (version === 0)
      this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), human TEXT NOT NULL, llm TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE cards (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL CHECK(owner IN ('human','llm')),
        author TEXT NOT NULL CHECK(author IN ('human','llm') AND author<>owner),
        owner_sequence INTEGER, status TEXT NOT NULL CHECK(status IN ('draft','active','completed')),
        created_at TEXT NOT NULL, published_at TEXT, completed_at TEXT,
        UNIQUE(owner,owner_sequence)
      );
      CREATE UNIQUE INDEX one_active ON cards(owner) WHERE status='active';
      CREATE UNIQUE INDEX one_draft ON cards(owner) WHERE status='draft';
      CREATE TABLE cells (
        id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), position INTEGER NOT NULL,
        price INTEGER NOT NULL CHECK(price>0), content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sealed' CHECK(status IN ('sealed','scratched')), scratched_at TEXT,
        UNIQUE(card_id,position)
      );
      CREATE TABLE ledger (
        id TEXT PRIMARY KEY, beneficiary TEXT NOT NULL CHECK(beneficiary IN ('human','llm')),
        kind TEXT NOT NULL CHECK(kind IN ('award','scratch')), amount INTEGER NOT NULL CHECK(amount>0),
        reason TEXT NOT NULL, actor TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('web','mcp')),
        cell_id TEXT REFERENCES cells(id), request_id TEXT NOT NULL, created_at TEXT NOT NULL,
        CHECK((kind='scratch' AND cell_id IS NOT NULL) OR (kind='award' AND cell_id IS NULL))
      );
      CREATE UNIQUE INDEX one_charge ON ledger(cell_id) WHERE kind='scratch';
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), cell_id TEXT REFERENCES cells(id),
        author TEXT NOT NULL CHECK(author IN ('human','llm')), body TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX notes_card ON notes(card_id,created_at,id);
      CREATE INDEX ledger_beneficiary ON ledger(beneficiary,created_at);
      CREATE TABLE requests (actor TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor,operation,request_id));
      CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
      CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
      CREATE TRIGGER notes_no_update BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT,'immutable notes'); END;
      CREATE TRIGGER notes_no_delete BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT,'immutable notes'); END;
      PRAGMA user_version=1;
      COMMIT;
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO settings(id,human,llm) VALUES(1,?,?)")
      .run(human, llm);
  }
  close() {
    this.db.close();
  }
  settings() {
    return this.db
      .prepare("SELECT human,llm,initialized FROM settings WHERE id=1")
      .get();
  }
  setNames(input: unknown) {
    const names = z
      .object({
        human: z.string().trim().min(1).max(30),
        llm: z.string().trim().min(1).max(30),
      })
      .strict()
      .parse(input);
    this.db
      .prepare("UPDATE settings SET human=?,llm=?,initialized=1 WHERE id=1")
      .run(names.human, names.llm);
    return this.settings();
  }
  balance(actor: Actor) {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE kind WHEN 'award' THEN amount ELSE -amount END),0) AS balance FROM ledger WHERE beneficiary=?",
        )
        .get(actor)!.balance,
    );
  }
  private mutate<T>(
    actor: Actor,
    operation: string,
    payload: { request_id: string },
    fn: () => T,
  ): T {
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare(
          "SELECT payload_hash,result FROM requests WHERE actor=? AND operation=? AND request_id=?",
        )
        .get(actor, operation, payload.request_id);
      if (old) {
        if (old.payload_hash !== hash)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "这个请求编号已用于不同内容，请检查重试参数。",
            409,
          );
        this.db.exec("COMMIT");
        return JSON.parse(old.result as string) as T;
      }
      const result = fn();
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?,?,?)")
        .run(
          actor,
          operation,
          payload.request_id,
          hash,
          JSON.stringify(result),
          now(),
        );
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private card(id: string, actor: Actor): Card {
    const card = this.db.prepare("SELECT * FROM cards WHERE id=?").get(id) as
      Card | undefined;
    if (!card || (card.status === "draft" && card.author !== actor))
      fail("NOT_FOUND", "没有找到这张卡。", 404);
    return card!;
  }
  private cells(id: string, mode: "summary" | "results" | "author") {
    // Projection happens in SQL: sealed content cannot accidentally leak through object spreading.
    if (mode === "summary")
      return this.db
        .prepare(
          "SELECT id,card_id,position,price,status,scratched_at FROM cells WHERE card_id=? ORDER BY position",
        )
        .all(id);
    if (mode === "results")
      return this.db
        .prepare(
          "SELECT id,card_id,position,price,status,scratched_at,content FROM cells WHERE card_id=? AND status='scratched' ORDER BY position",
        )
        .all(id);
    return this.db
      .prepare("SELECT * FROM cells WHERE card_id=? ORDER BY position")
      .all(id);
  }
  award(actor: Actor, input: unknown) {
    const payload = awardSchema.parse(input);
    return this.mutate(actor, "award", payload, () => {
      const beneficiary = other(actor);
      const balance = this.balance(beneficiary) + payload.points;
      if (!Number.isSafeInteger(balance))
        fail("VALIDATION_ERROR", "积分总额超出允许范围。");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          beneficiary,
          "award",
          payload.points,
          payload.reason,
          actor,
          actor === "human" ? "web" : "mcp",
          null,
          payload.request_id,
          now(),
        );
      return { id, beneficiary, balance };
    });
  }
  create(actor: Actor, input: unknown) {
    const payload = createSchema.parse(input);
    return this.mutate(actor, "create", payload, () => {
      const owner = other(actor);
      const existing = this.db
        .prepare("SELECT * FROM cards WHERE owner=? AND status='draft'")
        .get(owner) as Card | undefined;
      if (payload.draft_id && (!existing || existing.id !== payload.draft_id))
        fail("NOT_FOUND", "草稿不存在或已发布。", 404);
      if (existing && !payload.draft_id)
        fail("DRAFT_EXISTS", "已有草稿，请指定 draft_id 更新它。", 409);
      if (
        payload.action === "publish" &&
        this.db
          .prepare("SELECT id FROM cards WHERE owner=? AND status='active'")
          .get(owner)
      )
        fail(
          "ACTIVE_CARD_EXISTS",
          "对方的当前卡还没刮完，可以先保存草稿。",
          409,
        );
      const id = existing?.id ?? randomUUID();
      const status = payload.action === "publish" ? "active" : "draft";
      const sequence =
        status === "active"
          ? Number(
              this.db
                .prepare(
                  "SELECT COALESCE(MAX(owner_sequence),0)+1 AS n FROM cards WHERE owner=?",
                )
                .get(owner)!.n,
            )
          : null;
      if (existing) {
        this.db
          .prepare(
            "UPDATE cards SET status=?,owner_sequence=?,published_at=? WHERE id=?",
          )
          .run(status, sequence, status === "active" ? now() : null, id);
        this.db.prepare("DELETE FROM cells WHERE card_id=?").run(id);
      } else
        this.db
          .prepare("INSERT INTO cards VALUES(?,?,?,?,?,?,?,?)")
          .run(
            id,
            owner,
            actor,
            sequence,
            status,
            now(),
            status === "active" ? now() : null,
            null,
          );
      const insert = this.db.prepare(
        "INSERT INTO cells(id,card_id,position,price,content) VALUES(?,?,?,?,?)",
      );
      payload.cells.forEach((cell, i) =>
        insert.run(randomUUID(), id, i + 1, cell.price, cell.content),
      );
      return { id, owner, status, owner_sequence: sequence };
    });
  }
  scratch(actor: Actor, input: unknown) {
    const payload = scratchSchema.parse(input);
    const result = this.mutate(actor, "scratch", payload, () => {
      const cell = this.db
        .prepare("SELECT * FROM cells WHERE id=?")
        .get(payload.cell_id) as Cell | undefined;
      if (!cell) fail("NOT_FOUND", "没有找到这个格子。", 404);
      const card = this.card(cell!.card_id, actor);
      if (card.owner !== actor)
        fail("FORBIDDEN", "只能刮对方写给你的卡。", 403);
      if (cell!.status === "scratched")
        fail("ALREADY_SCRATCHED", "这个格子已经刮开，可以直接查看结果。", 409);
      if (card.status !== "active") fail("FORBIDDEN", "这张卡还不能刮。", 403);
      const balance = this.balance(actor);
      if (balance < cell!.price)
        fail(
          "INSUFFICIENT_POINTS",
          `还差 ${cell!.price - balance} 分，可以先看看其他格子。`,
          409,
        );
      const at = now();
      const updated = this.db
        .prepare(
          "UPDATE cells SET status='scratched',scratched_at=? WHERE id=? AND status='sealed'",
        )
        .run(at, cell!.id);
      if (updated.changes !== 1)
        fail("ALREADY_SCRATCHED", "这个格子已经刮开。", 409);
      this.db
        .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          actor,
          "scratch",
          cell!.price,
          `刮开第 ${card.owner_sequence} 张卡 · 第 ${cell!.position} 格`,
          actor,
          actor === "human" ? "web" : "mcp",
          cell!.id,
          payload.request_id,
          at,
        );
      const completed = !this.db
        .prepare(
          "SELECT id FROM cells WHERE card_id=? AND status='sealed' LIMIT 1",
        )
        .get(card.id);
      if (completed)
        this.db
          .prepare(
            "UPDATE cards SET status='completed',completed_at=? WHERE id=?",
          )
          .run(at, card.id);
      return {
        cell_id: cell!.id,
        card_id: card.id,
        spent: cell!.price,
        balance: balance - cell!.price,
        completed,
      };
    });
    // Store a reference in the idempotency log, not another copy of the secret.
    return {
      ...result,
      content: this.db
        .prepare("SELECT content FROM cells WHERE id=? AND status='scratched'")
        .get(result.cell_id)!.content as string,
    };
  }
  note(actor: Actor, input: unknown) {
    const payload = noteSchema.parse(input);
    return this.mutate(actor, "note", payload, () => {
      const card = this.card(payload.card_id, actor);
      if (card.status === "draft") fail("FORBIDDEN", "发布后才能留言。", 403);
      if (
        payload.cell_id &&
        !this.db
          .prepare("SELECT id FROM cells WHERE id=? AND card_id=?")
          .get(payload.cell_id, card.id)
      )
        fail("VALIDATION_ERROR", "这个格子不属于所选卡片。");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO notes VALUES(?,?,?,?,?,?)")
        .run(id, card.id, payload.cell_id ?? null, actor, payload.body, now());
      return { id };
    });
  }
  status(actor: Actor, input: unknown = {}) {
    const query = statusSchema.parse(input);
    if (query.section === "overview") {
      const cards = this.db
        .prepare(
          "SELECT * FROM cards WHERE status='active' OR (status='completed' AND NOT EXISTS (SELECT 1 FROM cards AS newer WHERE newer.owner=cards.owner AND newer.owner_sequence>cards.owner_sequence)) ORDER BY owner",
        )
        .all() as Card[];
      return {
        settings: this.settings(),
        balances: { human: this.balance("human"), llm: this.balance("llm") },
        cards: cards.map((card) => ({
          ...card,
          cells: this.cells(card.id, "summary"),
        })),
      };
    }
    if (query.section === "results" || query.section === "card") {
      if (!query.card_id) fail("VALIDATION_ERROR", "请选择卡片。");
      const card = this.card(query.card_id!, actor);
      return {
        card,
        cells: this.cells(
          card.id,
          query.section === "card" ? "summary" : "results",
        ),
      };
    }
    if (query.section === "authored") {
      const cards = query.card_id
        ? [this.card(query.card_id, actor)]
        : (this.db
            .prepare("SELECT * FROM cards WHERE author=? AND status='draft'")
            .all(actor) as Card[]);
      if (cards.some((card) => card.author !== actor))
        fail("FORBIDDEN", "只能查看自己写的密封内容。", 403);
      return {
        items: cards.map((card) => ({
          ...card,
          cells: this.cells(card.id, "author"),
        })),
      };
    }
    const offset = Number(query.cursor ?? 0);
    let rows;
    let total;
    if (query.section === "history" || query.section === "catalog") {
      const where =
        query.section === "history" ? "status='completed'" : "status<>'draft'";
      const order =
        query.section === "history" ? "completed_at" : "published_at";
      rows = this.db
        .prepare(
          `SELECT * FROM cards WHERE ${where} AND (? IS NULL OR owner=?) ORDER BY ${order} DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .all(query.owner ?? null, query.owner ?? null, query.limit, offset);
      total = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM cards WHERE ${where} AND (? IS NULL OR owner=?)`,
        )
        .get(query.owner ?? null, query.owner ?? null)!.n;
    } else if (query.section === "ledger") {
      rows = this.db
        .prepare(
          "SELECT ledger.*,cells.card_id FROM ledger LEFT JOIN cells ON cells.id=ledger.cell_id WHERE (? IS NULL OR beneficiary=?) ORDER BY ledger.created_at DESC,ledger.id DESC LIMIT ? OFFSET ?",
        )
        .all(query.owner ?? null, query.owner ?? null, query.limit, offset);
      total = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM ledger WHERE (? IS NULL OR beneficiary=?)",
        )
        .get(query.owner ?? null, query.owner ?? null)!.n;
    } else {
      const where =
        "WHERE (? IS NULL OR notes.card_id=?) AND (? IS NULL OR notes.author=?)";
      const args = [
        query.card_id ?? null,
        query.card_id ?? null,
        query.note_author ?? null,
        query.note_author ?? null,
      ];
      rows = this.db
        .prepare(
          `SELECT notes.*,cards.owner,cards.owner_sequence,cells.position FROM notes JOIN cards ON cards.id=notes.card_id LEFT JOIN cells ON cells.id=notes.cell_id ${where} ORDER BY notes.created_at,notes.id LIMIT ? OFFSET ?`,
        )
        .all(...args, query.limit, offset);
      total = this.db
        .prepare(`SELECT COUNT(*) AS n FROM notes ${where}`)
        .get(...args)!.n;
    }
    return {
      items: rows,
      total: Number(total),
      next_cursor:
        offset + rows.length < Number(total)
          ? String(offset + rows.length)
          : null,
    };
  }
}
