import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Actor = "human" | "llm";
type Cell = {
  id: string;
  position: number;
  price: number;
  status: string;
  content?: string;
};
type Card = {
  id: string;
  owner: Actor;
  author: Actor;
  owner_sequence: number | null;
  status: string;
  cells: Cell[];
  completed_at?: string;
};
type Overview = {
  settings: { human: string; llm: string; initialized: number };
  balances: Record<Actor, number>;
  cards: Card[];
};
type Row = Record<string, any>;
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
async function api(path: string, body?: unknown, token?: string) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.message ?? "请求未完成。",
      response.status,
      data.code,
    );
  return data;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M7 10h4m-4 4h8m2-4h.01" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z" />
      </>
    ),
    archive: (
      <>
        <rect x="4" y="8" width="16" height="13" rx="2" />
        <path d="M3 3h18v5H3zm6 9h6" />
      </>
    ),
    ledger: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6m-6 4h6m-6 4h3" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    pen: (
      <>
        <path d="m4 16-1 5 5-1L20 8l-4-4zM14 6l4 4" />
      </>
    ),
    leaf: (
      <>
        <path d="M5 18C2 10 9 4 19 5c1 10-5 17-14 13Z" />
        <path d="M7 16 15 9m-5 4V10m2 2h3" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.card}
    </svg>
  );
}
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function ScratchReveal({
  content,
  alreadyOpened = false,
}: {
  content: string;
  alreadyOpened?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(alreadyOpened);
  const strokes = useRef(new Set<string>());
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d")!;
    context.fillStyle = "#c4c9bb";
    context.fillRect(0, 0, 600, 360);
    context.fillStyle = "#616955";
    context.font = "24px sans-serif";
    context.textAlign = "center";
    context.fillText("慢慢刮开，看看里面", 300, 185);
  }, []);
  const rub = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!(event.buttons & 1)) return;
    const el = event.currentTarget,
      box = el.getBoundingClientRect();
    const x = ((event.clientX - box.left) * 600) / box.width,
      y = ((event.clientY - box.top) * 360) / box.height;
    const context = el.getContext("2d")!;
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(x, y, 35, 0, Math.PI * 2);
    context.fill();
    strokes.current.add(`${Math.floor(x / 40)},${Math.floor(y / 40)}`);
    if (strokes.current.size > 65) setRevealed(true);
  };
  return (
    <>
      <div className="scratch-stage">
        <p className="result-text">{content}</p>
        {!revealed && (
          <canvas
            aria-label="按住拖动刮开，也可以用下方按钮直接揭晓"
            ref={canvas}
            width="600"
            height="360"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              rub(e);
            }}
            onPointerMove={rub}
          />
        )}
      </div>
      {!revealed && (
        <button className="subtle" onClick={() => setRevealed(true)}>
          直接揭晓
        </button>
      )}
      <p className="hint">已经收进你的卡片，随时可以回来看看。</p>
    </>
  );
}

function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [logged, setLogged] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState<Actor>("human");
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Cell | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draft, setDraft] = useState([
    { price: 20, content: "" },
    { price: 20, content: "" },
    { price: 20, content: "" },
    { price: 20, content: "" },
  ]);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [noteCard, setNoteCard] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("");
  const [listOwner, setListOwner] = useState("");
  const [catalog, setCatalog] = useState<Card[]>([]);
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePreview, setNotePreview] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [jump, setJump] = useState("");
  const noteLatest = useRef(false);
  const [contextCard, setContextCard] = useState<Card | null>(null);
  const [pending, setPending] = useState<{
    path: string;
    body: Row;
    done: (data: any) => void;
  } | null>(null);
  const mutationLock = useRef(false);
  const names = overview?.settings ?? {
    human: "我",
    llm: "助手",
    initialized: 0,
  };
  const card = overview?.cards.find((c) => c.owner === owner);
  const pageSize = page === "notes" ? 1 : 20;
  const catalogChoices = [
    ...new Map(
      [
        ...(overview?.cards ?? []),
        ...catalog,
        ...(contextCard ? [contextCard] : []),
      ].map((c) => [c.id, c]),
    ).values(),
  ];

  async function loadCatalog(cursor?: string) {
    setCatalogBusy(true);
    try {
      const data = await api(
        `status?section=catalog&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      );
      setCatalog((previous) =>
        cursor
          ? [
              ...new Map(
                [...previous, ...data.items].map((c: Card) => [c.id, c]),
              ).values(),
            ]
          : data.items,
      );
      setCatalogCursor(data.next_cursor);
    } catch (error) {
      errorMessage(error);
    } finally {
      setCatalogBusy(false);
    }
  }

  async function refresh() {
    const data: Overview = await api("status");
    setOverview(data);
    setLogged(true);
    const revealed = await Promise.all(
      data.cards.map((c) => api(`status?section=results&card_id=${c.id}`)),
    );
    setResults(
      Object.fromEntries(
        revealed.flatMap((result) =>
          result.cells.map((c: Cell) => [c.id, c.content]),
        ),
      ),
    );
    if (!data.settings.initialized) setModal("settings");
  }
  function errorMessage(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setLogged(false);
      setOverview(null);
      setModal(null);
      setResults({});
    }
    setMessage(
      error instanceof Error ? error.message : "连接暂时中断，请重试。",
    );
  }
  useEffect(() => {
    refresh().catch((error) => {
      if (error instanceof ApiError && error.status === 401) setLogged(false);
      else errorMessage(error);
    });
  }, []);
  useEffect(() => {
    if (!logged || modal || pending) return;
    const update = () => {
      if (document.visibilityState === "visible") refresh().catch(errorMessage);
    };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [logged, modal, pending]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pending]);
  useEffect(() => {
    if (logged && page === "notes") void loadCatalog();
  }, [logged, page]);
  useEffect(() => {
    if (!logged || page === "home") return;
    let cancelled = false;
    setListLoading(true);
    const params = new URLSearchParams({
      section: page,
      limit: page === "notes" ? "1" : "20",
      cursor: String(offset),
    });
    if (page === "notes" && noteCard) params.set("card_id", noteCard);
    if (page === "notes" && noteAuthor) params.set("note_author", noteAuthor);
    if (page !== "notes" && listOwner) params.set("owner", listOwner);
    api(`status?${params}`)
      .then((data) => {
        if (cancelled) return;
        if (
          page === "notes" &&
          noteLatest.current &&
          data.total > 1 &&
          offset !== data.total - 1
        ) {
          noteLatest.current = false;
          setOffset(data.total - 1);
          return;
        }
        noteLatest.current = false;
        if (data.total > 0 && offset >= data.total) {
          setOffset(Math.floor((data.total - 1) / pageSize) * pageSize);
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setListLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setListLoading(false);
          errorMessage(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [page, offset, noteCard, noteAuthor, listOwner, logged, overview]);
  async function mutate(
    path: string,
    body: Row,
    done: (data: any) => void = () => setModal(null),
  ) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setMessage("");
    const operation = {
      path,
      body: { ...body, request_id: body.request_id ?? crypto.randomUUID() },
      done,
    };
    try {
      const data = await api(path, operation.body);
      setPending(null);
      done(data);
      try {
        await refresh();
      } catch {
        setMessage("操作已完成，页面暂未更新，请刷新查看。");
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) {
        setPending(operation);
        setMessage(
          "正在确认这次操作的结果。请点“确认结果”，会复用原请求，不会重复记账。",
        );
      } else {
        setPending(null);
        errorMessage(error);
      }
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  function navigate(next: string) {
    if (next === page) return;
    noteLatest.current = next === "notes";
    setPage(next);
    setOffset(0);
    setRows([]);
    setTotal(0);
    setJump("");
  }
  async function writeCard() {
    try {
      const data = await api("status?section=authored");
      if (data.items[0]) {
        setDraftId(data.items[0].id);
        setDraft(
          data.items[0].cells.map((c: Cell) => ({
            price: c.price,
            content: c.content!,
          })),
        );
      } else {
        setDraftId(undefined);
        setDraft(Array.from({ length: 4 }, () => ({ price: 20, content: "" })));
      }
      setPreview(false);
      setDirty(false);
      setModal("write");
    } catch (error) {
      errorMessage(error);
    }
  }
  function closeModal() {
    if (busy || pending) return;
    if (dirty && !window.confirm("还有没保存的文字，确定离开吗？")) return;
    setDirty(false);
    setModal(null);
    setSelected(null);
    setReveal(null);
  }
  async function leaveNote(target: Card, cell?: Cell) {
    try {
      const data = await api(`status?section=card&card_id=${target.id}`);
      setContextCard({ ...data.card, cells: data.cells });
      setSelected(cell ?? null);
      setNoteBody("");
      setNotePreview(false);
      setDirty(false);
      setMessage("");
      setModal("note");
      void loadCatalog();
    } catch (error) {
      errorMessage(error);
    }
  }
  async function openCard(target: Card, authored = false) {
    try {
      const data = await api(
        `status?section=${authored ? "authored" : "results"}&card_id=${target.id}`,
      );
      setContextCard(
        authored ? data.items[0] : { ...data.card, cells: data.cells },
      );
      setModal(authored ? "author" : "archive");
    } catch (error) {
      errorMessage(error);
    }
  }
  const formValues = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget));
  };

  if (logged === null)
    return (
      <main className="welcome">
        <Icon name="leaf" size={40} />
        <h1>正在翻开我们的卡片…</h1>
        {message && <p role="alert">{message}</p>}
      </main>
    );
  if (!logged)
    return (
      <main className="welcome">
        <div className="brand-mark">
          <Icon name="leaf" size={32} />
        </div>
        <p className="eyebrow">一人一张 · 慢慢揭晓</p>
        <h1>
          把小小的惊喜
          <br />
          留给彼此
        </h1>
        <p className="intro">
          你和助手的刮刮卡、奖励，还有碎碎念
          <br />
          都收在这个小地方
        </p>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api("login", {}, token);
              setToken("");
              setMessage("");
              await refresh();
            } catch (error) {
              errorMessage(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            访问口令
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="输入你的网页访问口令"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在开门…" : "进入我们的卡片"}
          </button>
        </form>
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        <p className="footnote">不用赶进度，好事可以慢慢来。</p>
      </main>
    );

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark">
            <Icon name="leaf" />
          </span>
          <span>
            我们的刮刮卡<small>收集一些小小的开心</small>
          </span>
        </button>
        <nav aria-label="更多页面">
          {[
            ["notes", "book", "碎碎念"],
            ["history", "archive", "归档册"],
            ["ledger", "ledger", "流水"],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
          <button onClick={() => setModal("settings")}>
            <Icon name="settings" />
            <span>设置</span>
          </button>
        </nav>
      </header>
      <main>
        <section className="balance-strip">
          <span>
            <i className="dot human" />
            {names.human}
            <strong>{overview?.balances.human ?? 0}</strong>
            <small>分</small>
          </span>
          <span>
            <i className="dot llm" />
            {names.llm}
            <strong>{overview?.balances.llm ?? 0}</strong>
            <small>分</small>
          </span>
          <button className="subtle" onClick={() => setModal("award")}>
            <Icon name="plus" size={16} />
            送出一点鼓励
          </button>
        </section>
        {message && (
          <div className="notice" role="status">
            {message}
            {pending && (
              <button
                disabled={busy}
                onClick={() => mutate(pending.path, pending.body, pending.done)}
              >
                确认结果
              </button>
            )}
            <button
              className="subtle"
              onClick={() => {
                setMessage("");
                if (!pending) refresh().catch(errorMessage);
              }}
              disabled={!!pending}
            >
              收起
            </button>
          </div>
        )}
        {page === "home" ? (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {owner === "human"
                    ? "留给你的，小小心意"
                    : "把心意，藏进一张卡"}
                </p>
                <h1>
                  {owner === "human"
                    ? "今天，想揭晓哪一格？"
                    : `等${names.llm}慢慢刮开。`}
                </h1>
                <p>
                  {owner === "human"
                    ? "不着急，每一份惊喜都在这里等你。"
                    : "价格由你决定，惊喜由对方发现。"}
                </p>
              </div>
              {owner === "llm" && (
                <button className="outline" onClick={writeCard}>
                  <Icon name="pen" size={17} />
                  写一张卡
                </button>
              )}
            </div>
            {card ? (
              <section className="ticket">
                <div className="ticket-header">
                  <div>
                    <span className="ticket-label">给 {names[card.owner]}</span>
                    <h2>
                      第 {String(card.owner_sequence).padStart(2, "0")} 张 ·
                      一点小期待
                    </h2>
                    <p>{names[card.author]} 写给你的</p>
                  </div>
                  <span className="stamp">
                    {card.status === "completed" ? "已收好" : "慢慢来"}
                  </span>
                </div>
                <div className="perforation" />
                <div className="cell-grid">
                  {card.cells.map((cell) => (
                    <button
                      key={cell.id}
                      className={`scratch-cell ${cell.status === "scratched" ? "opened" : ""}`}
                      aria-label={`第 ${cell.position} 格，${cell.price} 分，${cell.status === "scratched" ? "已揭晓" : "密封"}`}
                      disabled={cell.status !== "scratched" && owner === "llm"}
                      onClick={() => {
                        setSelected(cell);
                        setReveal(
                          cell.status === "scratched"
                            ? (results[cell.id] ?? null)
                            : null,
                        );
                        setModal("scratch");
                      }}
                    >
                      <span className="cell-number">
                        {String(cell.position).padStart(2, "0")}
                      </span>
                      {cell.status === "scratched" ? (
                        <>
                          <Icon name="leaf" size={26} />
                          <strong className="cell-excerpt">
                            {results[cell.id] ?? "查看惊喜"}
                          </strong>
                          <small>已经揭晓</small>
                        </>
                      ) : (
                        <>
                          <span className="seal-drawing">
                            <Icon name="card" size={32} />
                          </span>
                          <strong>
                            {cell.price} <small>分</small>
                          </strong>
                          <span className="cell-tip">一份还没拆开的心意</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
                <div className="ticket-footer">
                  <span>
                    已揭晓{" "}
                    {card.cells.filter((c) => c.status === "scratched").length}{" "}
                    / {card.cells.length}
                  </span>
                  <button className="subtle" onClick={() => leaveNote(card)}>
                    <Icon name="pen" size={15} />
                    留句话
                  </button>
                </div>
              </section>
            ) : (
              <section className="empty-card">
                <Icon name="card" size={44} />
                <h2>给下一份惊喜，留个位置。</h2>
                <p>
                  {owner === "human"
                    ? `等${names.llm}写好，这里就会出现一张新卡。`
                    : `写下你的心意，等${names.llm}来揭晓。`}
                </p>
                {owner === "llm" && (
                  <button className="primary" onClick={writeCard}>
                    写第一张卡
                  </button>
                )}
              </section>
            )}
            <div className="under-card">
              {card?.status === "completed" ? (
                <span>这一张已经刮完，等下一份惊喜。</span>
              ) : (
                <span>积分只用来打开惊喜，没有惩罚，也没有倒计时。</span>
              )}
              {card && owner === "llm" && (
                <button className="subtle" onClick={() => openCard(card, true)}>
                  查看我写的内容
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">那些值得留下的小事</p>
                <h1>
                  {page === "notes"
                    ? "我们的碎碎念"
                    : page === "history"
                      ? "好好收着，每一份心意。"
                      : "每一分，都有来处。"}
                </h1>
              </div>
              {page === "notes" && (
                <button
                  className="outline"
                  disabled={!catalogChoices.length}
                  onClick={() => {
                    const target =
                      catalogChoices.find((c) => c.id === noteCard) ??
                      catalogChoices[0];
                    if (target) void leaveNote(target);
                  }}
                >
                  <Icon name="pen" size={17} />
                  写一条碎碎念
                </button>
              )}
            </div>
            {page === "notes" && (
              <div className="filters">
                <label>
                  卡片
                  <select
                    value={noteCard}
                    onChange={(e) => {
                      setNoteCard(e.target.value);
                      noteLatest.current = false;
                      setOffset(0);
                    }}
                  >
                    <option value="">全部卡片</option>
                    {catalogChoices.map((c) => (
                      <option value={c.id} key={c.id}>
                        {names[c.owner]} · 第 {c.owner_sequence} 张
                      </option>
                    ))}
                    {noteCard &&
                      !catalogChoices.some((c) => c.id === noteCard) && (
                        <option value={noteCard}>选中的归档卡片</option>
                      )}
                  </select>
                </label>
                <label>
                  留言者
                  <select
                    value={noteAuthor}
                    onChange={(e) => {
                      setNoteAuthor(e.target.value);
                      noteLatest.current = false;
                      setOffset(0);
                    }}
                  >
                    <option value="">所有人</option>
                    <option value="human">{names.human}</option>
                    <option value="llm">{names.llm}</option>
                  </select>
                </label>
                {catalogCursor && (
                  <button
                    className="subtle"
                    disabled={catalogBusy}
                    onClick={() => loadCatalog(catalogCursor)}
                  >
                    加载更早的卡片
                  </button>
                )}
              </div>
            )}
            {(page === "history" || page === "ledger") && (
              <div className="filters">
                <label>
                  {page === "history" ? "卡片归属" : "积分归属"}
                  <select
                    value={listOwner}
                    onChange={(e) => {
                      setListOwner(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">双方</option>
                    <option value="human">{names.human}</option>
                    <option value="llm">{names.llm}</option>
                  </select>
                </label>
              </div>
            )}
            {listLoading && rows.length === 0 ? (
              <p className="loading-state" role="status">
                正在翻找这些小事…
              </p>
            ) : rows.length === 0 ? (
              <div className="empty-card">
                <Icon name={page === "notes" ? "book" : "archive"} size={36} />
                <h2>
                  {page === "notes"
                    ? "这里还没有留言。"
                    : page === "history"
                      ? "刮完的卡，会好好收在这里。"
                      : "第一份鼓励，还在路上。"}
                </h2>
              </div>
            ) : page === "notes" ? (
              <article className="notebook">
                <span className="ticket-label">
                  {names[rows[0].author as Actor]} 留下的话
                </span>
                <h2>
                  {names[rows[0].owner as Actor]} · 第 {rows[0].owner_sequence}{" "}
                  张{rows[0].position ? ` / 第 ${rows[0].position} 格` : ""}
                </h2>
                <p className="note-body">{rows[0].body}</p>
                <small>{date(rows[0].created_at)}</small>
                <button
                  className="subtle"
                  onClick={() => {
                    void leaveNote({
                      id: rows[0].card_id,
                      owner: rows[0].owner,
                      owner_sequence: rows[0].owner_sequence,
                    } as Card);
                  }}
                >
                  也留一句
                </button>
              </article>
            ) : (
              <div className="list-paper">
                {rows.map((row) =>
                  page === "ledger" ? (
                    <div className="ledger-row" key={row.id}>
                      <span
                        className={`amount ${row.kind === "award" ? "positive" : ""}`}
                      >
                        {row.kind === "award" ? "+" : "−"}
                        {row.amount}
                      </span>
                      <div>
                        <strong>
                          {names[row.beneficiary as Actor]} ·{" "}
                          {row.kind === "award" ? "收到鼓励" : "刮开惊喜"}
                        </strong>
                        <p>{row.reason}</p>
                        <small>{date(row.created_at)}</small>
                        {row.kind === "scratch" && (
                          <button
                            className="subtle"
                            onClick={() =>
                              openCard({ id: row.card_id } as Card)
                            }
                          >
                            看看这份惊喜
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      className="archive-row"
                      key={row.id}
                      onClick={() => openCard(row as Card)}
                    >
                      <Icon name="archive" />
                      <span>
                        <strong>
                          {names[row.owner as Actor]}的第 {row.owner_sequence}{" "}
                          张
                        </strong>
                        <small>{date(row.completed_at)} · 已收好</small>
                      </span>
                      <span>翻开</span>
                    </button>
                  ),
                )}
              </div>
            )}
            {total > 0 && (
              <div className="pagination">
                <button
                  disabled={offset === 0 || listLoading}
                  onClick={() =>
                    setOffset(Math.max(0, offset - (page === "notes" ? 1 : 20)))
                  }
                >
                  上一页
                </button>
                <span>
                  {Math.floor(offset / (page === "notes" ? 1 : 20)) + 1} /{" "}
                  {Math.ceil(total / (page === "notes" ? 1 : 20))}
                </span>
                <button
                  disabled={
                    offset + (page === "notes" ? 1 : 20) >= total || listLoading
                  }
                  onClick={() =>
                    setOffset(offset + (page === "notes" ? 1 : 20))
                  }
                >
                  下一页
                </button>
                <form
                  className="page-jump"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const target = Number(jump);
                    const maximum = Math.ceil(total / pageSize);
                    if (
                      Number.isInteger(target) &&
                      target >= 1 &&
                      target <= maximum
                    ) {
                      noteLatest.current = false;
                      setOffset((target - 1) * pageSize);
                      setJump("");
                    }
                  }}
                >
                  <label>
                    跳到
                    <input
                      aria-label="跳到第几页"
                      type="number"
                      min={1}
                      max={Math.ceil(total / pageSize)}
                      value={jump}
                      onChange={(e) => setJump(e.target.value)}
                      required
                    />
                    页
                  </label>
                  <button disabled={listLoading}>前往</button>
                </form>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="dock" aria-label="选择卡位">
        <button
          className={page === "home" && owner === "llm" ? "selected" : ""}
          onClick={() => {
            setOwner("llm");
            navigate("home");
          }}
        >
          <Icon name="pen" /><span>待{names.llm}刮</span>
        </button>
        <button
          className={page === "home" && owner === "human" ? "selected" : ""}
          onClick={() => {
            setOwner("human");
            navigate("home");
          }}
        >
          <Icon name="card" /><span>待{names.human}刮</span>
        </button>
      </footer>
      {modal && (
        <Modal
          title={
            {
              settings: "记住我们的名字",
              award: `给${names.llm}一点鼓励`,
              write: `写给${names.llm}的卡`,
              scratch: `第 ${selected?.position ?? ""} 格 · 小小惊喜`,
              note: "写一条碎碎念",
              archive: "收好的心意",
              author: "我写下的内容",
            }[modal] ?? ""
          }
          onClose={closeModal}
          locked={busy || !!pending}
        >
          {modal === "settings" && (
            <form
              onSubmit={async (e) => {
                const values = formValues(e);
                setBusy(true);
                try {
                  await api("settings", values);
                  setModal(null);
                  await refresh();
                } catch (error) {
                  errorMessage(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                你的昵称
                <input
                  name="human"
                  maxLength={30}
                  defaultValue={names.human}
                  required
                />
              </label>
              <label>
                助手昵称
                <input
                  name="llm"
                  maxLength={30}
                  defaultValue={names.llm}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                收好名字
              </button>
              <button
                type="button"
                className="subtle"
                onClick={async () => {
                  await api("logout", {});
                  setLogged(false);
                  setOverview(null);
                  setModal(null);
                  setResults({});
                }}
              >
                退出登录
              </button>
            </form>
          )}
          {modal === "award" && (
            <form
              onSubmit={(e) => {
                const values = formValues(e);
                void mutate("award", {
                  points: Number(values.points),
                  reason: values.reason,
                });
              }}
            >
              <p className="hint">每一点鼓励，都值得有一句理由。</p>
              <label>
                奖励分数
                <input
                  name="points"
                  type="number"
                  min={1}
                  max={1000000}
                  defaultValue={20}
                  required
                />
              </label>
              <label>
                想说的话
                <textarea
                  name="reason"
                  maxLength={500}
                  required
                  placeholder="谢谢你今天陪我把事情慢慢理清楚。"
                />
              </label>
              <button className="primary" disabled={busy || !!pending}>
                送出积分
              </button>
            </form>
          )}
          {modal === "write" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const action =
                  (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                    "value",
                  ) ?? "save_draft";
                if (
                  action === "publish" &&
                  !window.confirm("发布后价格和内容就固定了，准备好了吗？")
                )
                  return;
                void mutate(
                  "cards",
                  {
                    cells: draft,
                    action,
                    ...(draftId ? { draft_id: draftId } : {}),
                  },
                  () => {
                    setDirty(false);
                    setModal(null);
                    setMessage(
                      action === "publish"
                        ? "卡片已经放好了，等对方来刮。"
                        : "草稿已经收好。",
                    );
                  },
                );
              }}
            >
              <div className="editor-top">
                <label>
                  格数
                  <select
                    value={draft.length}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (
                        n < draft.length &&
                        draft.slice(n).some((c) => c.content) &&
                        !window.confirm(
                          "减少格数会移除末尾格子的内容，继续吗？",
                        )
                      )
                        return;
                      setDraft(
                        Array.from(
                          { length: n },
                          (_, i) => draft[i] ?? { price: 20, content: "" },
                        ),
                      );
                      setDirty(true);
                    }}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="subtle"
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "继续编辑" : "预览密封效果"}
                </button>
              </div>
              {preview ? (
                <div className="cell-grid preview">
                  {draft.map((c, i) => (
                    <div className="scratch-cell" key={i}>
                      <Icon name="card" />
                      <strong>{c.price} 分</strong>
                      <small>第 {i + 1} 格 · 密封</small>
                    </div>
                  ))}
                </div>
              ) : (
                draft.map((cell, i) => (
                  <fieldset key={i}>
                    <legend>第 {i + 1} 格</legend>
                    <label>
                      需要的积分
                      <input
                        aria-label={`第 ${i + 1} 格价格`}
                        type="number"
                        min={1}
                        max={1000000}
                        required
                        value={cell.price}
                        onChange={(e) => {
                          setDraft(
                            draft.map((c, j) =>
                              j === i
                                ? { ...c, price: Number(e.target.value) }
                                : c,
                            ),
                          );
                          setDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      藏在里面的心意
                      <textarea
                        aria-label={`第 ${i + 1} 格内容`}
                        maxLength={2000}
                        required
                        value={cell.content}
                        placeholder="一首小诗、一个故事，或一次一起散步的约定。"
                        onChange={(e) => {
                          setDraft(
                            draft.map((c, j) =>
                              j === i ? { ...c, content: e.target.value } : c,
                            ),
                          );
                          setDirty(true);
                        }}
                      />
                    </label>
                  </fieldset>
                ))
              )}
              <p className="hint">
                发布后价格和内容固定。当前卡没刮完时，可以先保存草稿。
              </p>
              <div className="actions">
                <button value="save_draft" disabled={busy || !!pending}>
                  保存草稿
                </button>
                <button
                  className="primary"
                  value="publish"
                  disabled={
                    busy ||
                    !!pending ||
                    overview?.cards.some(
                      (c) => c.owner === "llm" && c.status === "active",
                    )
                  }
                >
                  发布这张卡
                </button>
              </div>
            </form>
          )}
          {modal === "scratch" &&
            selected &&
            (reveal !== null ? (
              <>
                <ScratchReveal
                  content={reveal}
                  alreadyOpened={selected.status === "scratched"}
                />
                {card && (
                  <button
                    className="outline"
                    onClick={() => leaveNote(card, selected)}
                  >
                    写点感想
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="spend">
                  {selected.price}
                  <small> 分</small>
                </p>
                <p>你现在有 {overview?.balances.human} 分</p>
                <p className="hint">开始后扣分，关掉页面也能回来查看。</p>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !!pending ||
                    (overview?.balances.human ?? 0) < selected.price
                  }
                  onClick={() =>
                    mutate("scratch", { cell_id: selected.id }, (data) =>
                      setReveal(data.content),
                    )
                  }
                >
                  花 {selected.price} 分，开始刮
                </button>
                {(overview?.balances.human ?? 0) < selected.price && (
                  <p className="hint">
                    还差 {selected.price - (overview?.balances.human ?? 0)}{" "}
                    分，可以先看看其他格子。
                  </p>
                )}
              </>
            ))}
          {modal === "note" && contextCard && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteBody.trim()) return;
                if (!notePreview) {
                  setNotePreview(true);
                  return;
                }
                void mutate(
                  "notes",
                  {
                    card_id: contextCard.id,
                    ...(selected ? { cell_id: selected.id } : {}),
                    body: noteBody,
                  },
                  () => {
                    setDirty(false);
                    setModal(null);
                    setMessage("这句话已经留在本子里了。");
                    if (page === "notes") {
                      noteLatest.current = true;
                      setOffset(0);
                    }
                  },
                );
              }}
            >
              {notePreview ? (
                <>
                  <p className="hint">{names.human} · 发送前再看一眼</p>
                  <article className="note-preview">
                    <strong>
                      {names[contextCard.owner]}的第{" "}
                      {contextCard.owner_sequence} 张
                      {selected ? ` · 第 ${selected.position} 格` : ""}
                    </strong>
                    <p>{noteBody}</p>
                  </article>
                </>
              ) : (
                <>
                  <label>
                    关联卡片
                    <select
                      value={contextCard.id}
                      disabled={busy || !!pending}
                      onChange={async (e) => {
                        const id = e.target.value;
                        setBusy(true);
                        try {
                          const data = await api(
                            `status?section=card&card_id=${id}`,
                          );
                          setContextCard({ ...data.card, cells: data.cells });
                          setSelected(null);
                          setDirty(true);
                        } catch (error) {
                          errorMessage(error);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {catalogChoices.map((c) => (
                        <option value={c.id} key={c.id}>
                          {names[c.owner]} · 第 {c.owner_sequence} 张
                        </option>
                      ))}
                    </select>
                  </label>
                  {catalogCursor && (
                    <button
                      type="button"
                      className="subtle"
                      disabled={catalogBusy}
                      onClick={() => loadCatalog(catalogCursor)}
                    >
                      加载更早的卡片
                    </button>
                  )}
                  <label>
                    关联格子
                    <select
                      value={selected?.id ?? ""}
                      disabled={busy || !!pending}
                      onChange={(e) => {
                        setSelected(
                          contextCard.cells.find(
                            (c) => c.id === e.target.value,
                          ) ?? null,
                        );
                        setDirty(true);
                      }}
                    >
                      <option value="">整张卡</option>
                      {contextCard.cells.map((c) => (
                        <option key={c.id} value={c.id}>
                          第 {c.position} 格 ·{" "}
                          {c.status === "scratched" ? "已揭晓" : "密封"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">
                    {names[contextCard.owner]}的第 {contextCard.owner_sequence}{" "}
                    张{selected ? ` · 第 ${selected.position} 格` : ""}
                  </p>
                  <label>
                    想留下的话
                    <textarea
                      name="body"
                      maxLength={2000}
                      required
                      value={noteBody}
                      disabled={busy || !!pending}
                      onChange={(e) => {
                        setNoteBody(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="期待、感想，或随口的一句，都可以。"
                    />
                  </label>
                </>
              )}
              <p className="hint">双方都能看见，写下后会一直留在本子里。</p>
              {notePreview && (
                <button
                  type="button"
                  disabled={busy || !!pending}
                  onClick={() => setNotePreview(false)}
                >
                  再改一下
                </button>
              )}
              <button className="primary" disabled={busy || !!pending}>
                {notePreview ? "确认写下" : "预览这句话"}
              </button>
            </form>
          )}
          {(modal === "archive" || modal === "author") && contextCard && (
            <>
              <p className="hint">
                {modal === "author"
                  ? "这是作者视图，查看不会揭晓格子或扣分。"
                  : `${names[contextCard.owner]}的第 ${contextCard.owner_sequence} 张`}
              </p>
              {contextCard.cells.map((cell) => (
                <section className="result-block" key={cell.id}>
                  <small>
                    第 {cell.position} 格 · {cell.price} 分
                  </small>
                  <p>{cell.content}</p>
                  <button
                    className="subtle"
                    onClick={() => leaveNote(contextCard, cell)}
                  >
                    留句话
                  </button>
                </section>
              ))}
              <button
                className="outline"
                onClick={() => {
                  setNoteCard(contextCard.id);
                  setModal(null);
                  navigate("notes");
                }}
              >
                翻看这张卡的碎碎念
              </button>
            </>
          )}
          {message && (
            <div className="notice" role="alert">
              {message}
              {pending && (
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate(pending.path, pending.body, pending.done)
                  }
                >
                  确认结果
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  locked,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  locked: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          aria-label="关闭"
          className="subtle"
          disabled={locked}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
