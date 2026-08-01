import { useState, useEffect, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, BarChart3, Table, CalendarDays, Wallet,
  TrendingUp, Settings, RefreshCw, Plus, Trash2, ArrowUpRight,
  ArrowDownRight, Shield, Clock, Landmark,
} from "lucide-react";

/* ================================================================
   TRi — Trading Journal & Finance Dashboard (Interactive Prototype)
   Demo data only. Visual language inspired by modern dark journals.
   ================================================================ */

// ---------------- THEME TOKENS ----------------
const T = {
  bg: "#0A0B0F",
  surface: "#12141B",
  raised: "#1A1D26",
  line: "rgba(255,255,255,0.07)",
  text: "#E8EAF0",
  dim: "#8A90A3",
  brand: "#5B8CFF",
  pos: "#2DD4A7",
  neg: "#FF5C7A",
  warn: "#FFB454",
};

// CORE-START ------------------------------------------------------
// Deterministic demo data + pure analytics (no UI code in this block)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260731);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const SYMBOLS = {
  forex: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"],
  crypto: ["BTCUSD", "ETHUSD", "SOLUSD"],
  indices: ["US500", "NAS100", "GER40"],
  stocks: ["AAPL", "NVDA", "TSLA"],
};
const CLASSES = ["forex", "crypto", "indices", "stocks"];
const START_BALANCE = 10000;

function genTrades() {
  const trades = [];
  let id = 1;
  for (let d = 91; d >= 0; d--) {
    const day = new Date(2026, 6, 31);
    day.setDate(day.getDate() - d);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // Mon–Fri markets
    const n = Math.floor(rnd() * 4); // 0–3 trades per day
    for (let i = 0; i < n; i++) {
      const cls = pick(CLASSES);
      const symbol = pick(SYMBOLS[cls]);
      const r = rnd();
      const hour = r < 0.2 ? 3 + Math.floor(rnd() * 6)
        : r < 0.65 ? 10 + Math.floor(rnd() * 6)
        : 16 + Math.floor(rnd() * 7);
      const open = new Date(day);
      open.setHours(hour, Math.floor(rnd() * 60), 0, 0);
      const style = rnd() < 0.72 ? "day" : "swing";
      const close = new Date(open);
      if (style === "day") {
        close.setMinutes(open.getMinutes() + 15 + Math.floor(rnd() * 240));
        if (close.toDateString() !== open.toDateString()) {
          close.setTime(open.getTime());
          close.setHours(23, 55, 0, 0); // day trades never roll past midnight
        }
      }
      else { close.setDate(close.getDate() + 1 + Math.floor(rnd() * 4)); close.setHours(9 + Math.floor(rnd() * 8)); }
      const direction = rnd() < 0.55 ? "long" : "short";
      // hidden "edge" so analytics show real patterns
      let p = 0.44;
      if (hour >= 10 && hour <= 15) p += 0.12;      // London hours
      if (dow === 2 || dow === 3) p += 0.08;         // Tue/Wed
      if (cls === "crypto" && direction === "short") p += 0.06;
      if (cls === "stocks") p -= 0.04;
      const win = rnd() < p;
      const risk = Math.round(50 + rnd() * 150);
      const rr = win ? +(0.7 + rnd() * 2.6).toFixed(2) : -+(0.4 + rnd() * 0.7).toFixed(2);
      const pnl = Math.round(rr * risk);
      trades.push({
        id: id++, symbol, cls, direction, style,
        open: open.getTime(), close: close.getTime(),
        hour, dow, risk, rr, pnl,
      });
    }
  }
  trades.sort((a, b) => a.close - b.close);
  return trades;
}
const TRADES = genTrades();

function stats(trades) {
  const n = trades.length;
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = n ? (wins.length / n) * 100 : 0;
  const pf = gl > 0 ? gw / gl : gw > 0 ? 99 : 0;
  const avgRR = n ? trades.reduce((s, t) => s + t.rr, 0) / n : 0;
  const avgWin = wins.length ? gw / wins.length : 0;
  const avgLoss = losses.length ? gl / losses.length : 0;
  return { n, net, winRate, pf, avgRR, avgWin, avgLoss, wins: wins.length };
}

function equitySeries(trades) {
  let bal = START_BALANCE;
  return trades.map((t) => { bal += t.pnl; return { t: t.close, bal }; });
}

function maxDrawdown(series) {
  let peak = START_BALANCE, dd = 0;
  for (const p of series) { peak = Math.max(peak, p.bal); dd = Math.max(dd, peak - p.bal); }
  return dd;
}

function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

const sessionOf = (h) => (h < 9 ? "asia" : h < 16 ? "london" : "ny");
// CORE-END --------------------------------------------------------

// ---------------- I18N ----------------
const I18N = {
  he: {
    appTag: "Trade · Risk · Insight",
    nav_dash: "דשבורד", nav_analytics: "סטטיסטיקות", nav_trades: "עסקאות",
    nav_calendar: "לוח שנה", nav_finance: "פיננסי", nav_long: "Long Trades",
    nav_settings: "הגדרות",
    syncing: "מסנכרן מ-MT5…", synced: "סונכרן מ-MT5", syncBtn: "רענן נתונים",
    netPnl: "רווח/הפסד נטו", winRate: "אחוז הצלחה", profitFactor: "Profit Factor",
    avgRR: "RR ממוצע", maxDD: "Drawdown מקסימלי", balance: "יתרת חשבון",
    trades: "עסקאות", equity: "עקומת הון", rStrip: "60 העסקאות האחרונות (R)",
    recent: "עסקאות אחרונות", insights: "איפה אתה הכי רווחי",
    byWeekday: "רווח/הפסד לפי יום", bySession: "לפי סשן מסחר", byClass: "לפי סוג נכס",
    byDirection: "לפי כיוון", heatmap: "מפת חום — יום × סשן",
    session_asia: "אסיה", session_london: "לונדון", session_ny: "ניו יורק",
    long: "לונג", short: "שורט", day: "Day", swing: "Swing",
    forex: "פורקס", crypto: "קריפטו", indices: "מדדים", stocks: "מניות",
    all: "הכול", symbol: "נכס", dirCol: "כיוון", styleCol: "סגנון",
    risk: "סיכון", pnlCol: "P&L", timeCol: "נסגרה", filter: "סינון",
    income: "הכנסות", expenses: "הוצאות", monthNet: "מאזן חודשי",
    addEntry: "הוספה", entryLabel: "תיאור", amount: "סכום",
    typeIncome: "הכנסה", typeExpense: "הוצאה", finTitle: "מאזן פיננסי — יולי 2026",
    totalWealth: "שווי כולל (מסחר + לונג + מאזן)",
    longTitle: "השקעות ארוכות טווח (הזנה ידנית)",
    qty: "כמות", buyPrice: "מחיר קנייה", curVal: "שווי נוכחי",
    unreal: "רווח לא ממומש", updated: "עודכן", update: "עדכן",
    addPos: "הוספת פוזיציה",
    language: "שפה", currency: "מטבע תצוגה", mt5: "חשבון MT5 מחובר",
    investor: "חיבור לקריאה בלבד (Investor)", server: "שרת",
    settingsNote: "האב-טיפוס רץ על נתוני דמו. במוצר המלא: סנכרון אמיתי מ-MT5 בכל כניסה.",
    demo: "אב-טיפוס · נתוני דמו בלבד",
    weekdays: ["א", "ב", "ג", "ד", "ה", "ו", "ש"],
    calTitle: "יולי 2026", noTrades: "—",
    bestNote: "מבוסס על עסקאות סגורות · מינימום 5 עסקאות לקטגוריה",
  },
  en: {
    appTag: "Trade · Risk · Insight",
    nav_dash: "Dashboard", nav_analytics: "Analytics", nav_trades: "Trades",
    nav_calendar: "Calendar", nav_finance: "Finance", nav_long: "Long Trades",
    nav_settings: "Settings",
    syncing: "Syncing from MT5…", synced: "Synced from MT5", syncBtn: "Refresh data",
    netPnl: "Net P&L", winRate: "Win rate", profitFactor: "Profit factor",
    avgRR: "Avg RR", maxDD: "Max drawdown", balance: "Account balance",
    trades: "trades", equity: "Equity curve", rStrip: "Last 60 trades (R)",
    recent: "Recent trades", insights: "Where you are most profitable",
    byWeekday: "P&L by weekday", bySession: "By trading session", byClass: "By asset class",
    byDirection: "By direction", heatmap: "Heatmap — day × session",
    session_asia: "Asia", session_london: "London", session_ny: "New York",
    long: "Long", short: "Short", day: "Day", swing: "Swing",
    forex: "Forex", crypto: "Crypto", indices: "Indices", stocks: "Stocks",
    all: "All", symbol: "Symbol", dirCol: "Side", styleCol: "Style",
    risk: "Risk", pnlCol: "P&L", timeCol: "Closed", filter: "Filter",
    income: "Income", expenses: "Expenses", monthNet: "Monthly net",
    addEntry: "Add", entryLabel: "Label", amount: "Amount",
    typeIncome: "Income", typeExpense: "Expense", finTitle: "Personal finance — July 2026",
    totalWealth: "Total wealth (trading + long + balance)",
    longTitle: "Long-term positions (manual entry)",
    qty: "Qty", buyPrice: "Buy price", curVal: "Current value",
    unreal: "Unrealized P&L", updated: "Updated", update: "Update",
    addPos: "Add position",
    language: "Language", currency: "Display currency", mt5: "Connected MT5 account",
    investor: "Read-only (Investor) connection", server: "Server",
    settingsNote: "Prototype runs on demo data. Full product syncs from MT5 on every login.",
    demo: "Prototype · demo data only",
    weekdays: ["S", "M", "T", "W", "T", "F", "S"],
    calTitle: "July 2026", noTrades: "—",
    bestNote: "Closed trades only · minimum 5 trades per category",
  },
};

const RATE = 3.7; // USD → ILS demo rate (auto-fetched in the full product)

// ---------------- SEED STATE ----------------
const FINANCE_SEED = [
  { id: 1, type: "income", label: "משכורת יולי / July salary", amount: 18500, date: "01.07" },
  { id: 2, type: "income", label: "פרויקט צד / Side project", amount: 3200, date: "14.07" },
  { id: 3, type: "expense", label: "שכר דירה / Rent", amount: 6200, date: "02.07" },
  { id: 4, type: "expense", label: "מזון ומסעדות / Food", amount: 2900, date: "20.07" },
  { id: 5, type: "expense", label: "רכב ודלק / Car & fuel", amount: 1400, date: "18.07" },
  { id: 6, type: "expense", label: "הפקדה לחשבון מסחר / Deposit to trading", amount: 3000, date: "05.07" },
];

const LONG_SEED = [
  { id: 1, symbol: "AAPL", qty: 25, buy: 182.4, cur: 236.1, updated: "28.07.2026" },
  { id: 2, symbol: "QQQ", qty: 10, buy: 418.0, cur: 512.3, updated: "28.07.2026" },
  { id: 3, symbol: "BTC", qty: 0.12, buy: 58200, cur: 104500, updated: "25.07.2026" },
];

// ---------------- SMALL UI ATOMS ----------------
function Card({ title, action, children, pad = true }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18 }}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div style={{ color: T.dim, fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>{title}</div>
          {action}
        </div>
      )}
      <div className={pad ? "px-4 pb-4 pt-1" : ""}>{children}</div>
    </div>
  );
}

function KPI({ label, value, sub, tone }) {
  const color = tone === "pos" ? T.pos : tone === "neg" ? T.neg : T.text;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18 }} className="px-4 py-3">
      <div style={{ color: T.dim, fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: T.dim, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Chip({ children, color }) {
  return (
    <span style={{
      background: `${color}22`, color, borderRadius: 999,
      padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function DarkTooltip({ active, payload, label, fmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, padding: "6px 10px", fontSize: 12 }}>
      <div style={{ color: T.dim }}>{label}</div>
      <div style={{ color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(payload[0].value)}</div>
    </div>
  );
}

// ---------------- MAIN APP ----------------
export default function App() {
  const [lang, setLang] = useState("he");
  const [cur, setCur] = useState("ILS");
  const [tab, setTab] = useState("dash");
  const [syncing, setSyncing] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [finance, setFinance] = useState(FINANCE_SEED);
  const [longs, setLongs] = useState(LONG_SEED);

  useEffect(() => {
    const to = setTimeout(() => { setSyncing(false); setLastSync(new Date()); }, 1400);
    return () => clearTimeout(to);
  }, []);

  const t = (k) => I18N[lang][k] ?? k;
  const rtl = lang === "he";
  const nf = (v, d = 0) => Number(v).toLocaleString(rtl ? "he-IL" : "en-US", { maximumFractionDigits: d });
  const usd = (v) => (cur === "USD" ? `$${nf(v)}` : `₪${nf(v * RATE)}`);
  const ils = (v) => (cur === "ILS" ? `₪${nf(v)}` : `$${nf(v / RATE)}`);

  const S = useMemo(() => stats(TRADES), []);
  const EQ = useMemo(() => equitySeries(TRADES), []);
  const DD = useMemo(() => maxDrawdown(EQ), [EQ]);
  const ctx = { t, rtl, lang, nf, usd, ils, S, EQ, DD, finance, setFinance, longs, setLongs, cur };

  const doSync = () => {
    if (syncing) return;
    setSyncing(true);
    setTimeout(() => { setSyncing(false); setLastSync(new Date()); }, 1200);
  };

  const NAV = [
    ["dash", t("nav_dash"), LayoutDashboard],
    ["analytics", t("nav_analytics"), BarChart3],
    ["trades", t("nav_trades"), Table],
    ["calendar", t("nav_calendar"), CalendarDays],
    ["finance", t("nav_finance"), Wallet],
    ["long", t("nav_long"), TrendingUp],
    ["settings", t("nav_settings"), Settings],
  ];

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: "'Heebo', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');
        ::-webkit-scrollbar{height:6px;width:6px} ::-webkit-scrollbar-thumb{background:#2a2e3a;border-radius:3px}
        select,input{outline:none}
        @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* Header */}
      <header style={{ borderBottom: `1px solid ${T.line}`, background: "rgba(10,11,15,0.9)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 20 }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div style={{
              width: 36, height: 36, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${T.brand}, #8B5BFF)`, fontWeight: 800, fontSize: 15, color: "#fff",
              fontFamily: "'IBM Plex Mono', monospace",
            }}>TRi</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>TRi</div>
              <div style={{ color: T.dim, fontSize: 11 }}>{t("appTag")}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={doSync} className="flex items-center gap-2 px-3 py-1.5"
              style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 999, fontSize: 12, color: syncing ? T.warn : T.pos, cursor: "pointer" }}>
              <RefreshCw size={13} style={syncing ? { animation: "spin 1s linear infinite" } : {}} />
              <span className="hidden sm:inline">
                {syncing ? t("syncing") : `${t("synced")} · ${lastSync ? lastSync.toLocaleTimeString(rtl ? "he-IL" : "en-US", { hour: "2-digit", minute: "2-digit" }) : ""}`}
              </span>
            </button>
            <button onClick={() => setLang(rtl ? "en" : "he")} className="px-3 py-1.5"
              style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 999, fontSize: 12, color: T.text, cursor: "pointer" }}>
              {rtl ? "EN" : "עב"}
            </button>
          </div>
        </div>
        {/* Nav */}
        <div className="max-w-6xl mx-auto px-2 pb-2 flex gap-1 overflow-x-auto">
          {NAV.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)} className="flex items-center gap-1.5 px-3 py-1.5"
              style={{
                borderRadius: 10, fontSize: 13, whiteSpace: "nowrap", cursor: "pointer", border: "none",
                background: tab === key ? T.raised : "transparent",
                color: tab === key ? T.text : T.dim, fontWeight: tab === key ? 700 : 500,
              }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5" style={{ opacity: syncing ? 0.45 : 1, transition: "opacity .4s" }}>
        {tab === "dash" && <DashView {...ctx} />}
        {tab === "analytics" && <AnalyticsView {...ctx} />}
        {tab === "trades" && <TradesView {...ctx} />}
        {tab === "calendar" && <CalendarView {...ctx} />}
        {tab === "finance" && <FinanceView {...ctx} />}
        {tab === "long" && <LongView {...ctx} />}
        {tab === "settings" && <SettingsView {...ctx} lang={lang} setLang={setLang} cur={cur} setCur={setCur} />}
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-6" style={{ color: T.dim, fontSize: 11 }}>
        {t("demo")}
      </footer>
    </div>
  );
}

// ---------------- DASHBOARD ----------------
function DashView({ t, usd, nf, S, EQ, DD, rtl }) {
  const balance = START_BALANCE + S.net;
  const recent = [...TRADES].slice(-6).reverse();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label={t("balance")} value={usd(balance)} sub={`${S.n} ${t("trades")}`} />
        <KPI label={t("netPnl")} value={(S.net >= 0 ? "+" : "") + usd(S.net)} tone={S.net >= 0 ? "pos" : "neg"} />
        <KPI label={t("winRate")} value={`${S.winRate.toFixed(1)}%`} sub={`${S.wins}/${S.n}`} />
        <KPI label={t("avgRR")} value={`${S.avgRR.toFixed(2)}R`} tone={S.avgRR >= 0 ? "pos" : "neg"} />
        <KPI label={t("profitFactor")} value={S.pf.toFixed(2)} />
        <KPI label={t("maxDD")} value={usd(-DD)} tone="neg" />
      </div>

      {/* Signature: R-strip */}
      <Card title={t("rStrip")}>
        <div className="flex items-stretch overflow-x-auto py-1" style={{ height: 72, gap: 3 }}>
          {TRADES.slice(-60).map((tr) => {
            const h = (Math.min(Math.abs(tr.rr), 3.5) / 3.5) * 30 + 4;
            const winSide = tr.pnl > 0;
            return (
              <div key={tr.id} title={`${tr.symbol} · ${tr.rr}R`} className="flex flex-col justify-center" style={{ width: 5, flexShrink: 0 }}>
                <div style={{ height: 32, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  {winSide && <div style={{ width: 5, height: h, background: T.pos, borderRadius: 2 }} />}
                </div>
                <div style={{ height: 1, background: T.line }} />
                <div style={{ height: 32, display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
                  {!winSide && <div style={{ width: 5, height: h, background: T.neg, borderRadius: 2, opacity: 0.9 }} />}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title={t("equity")}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={EQ.map((p, i) => ({ i, bal: p.bal }))}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.brand} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={T.brand} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={T.line} vertical={false} />
                  <XAxis dataKey="i" hide />
                  <YAxis stroke={T.dim} fontSize={11} width={54} tickFormatter={(v) => nf(v)}
                    domain={["dataMin - 200", "dataMax + 200"]} orientation={rtl ? "right" : "left"} />
                  <Tooltip content={<DarkTooltip fmt={(v) => usd(v)} />} />
                  <ReferenceLine y={START_BALANCE} stroke={T.dim} strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="bal" stroke={T.brand} strokeWidth={2} fill="url(#eq)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <Card title={t("recent")}>
          <div className="flex flex-col gap-2">
            {recent.map((tr) => (
              <div key={tr.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${T.line}` }}>
                <div className="flex items-center gap-2">
                  {tr.direction === "long"
                    ? <ArrowUpRight size={14} color={T.pos} />
                    : <ArrowDownRight size={14} color={T.neg} />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{tr.symbol}</div>
                    <div style={{ fontSize: 11, color: T.dim }}>{t(tr.cls)} · {t(tr.style === "day" ? "day" : "swing")}</div>
                  </div>
                </div>
                <div style={{ textAlign: rtl ? "left" : "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: tr.pnl >= 0 ? T.pos : T.neg }}>
                    {tr.pnl >= 0 ? "+" : ""}{usd(tr.pnl)}
                  </div>
                  <div style={{ fontSize: 11, color: T.dim }}>{tr.rr}R</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------- ANALYTICS ----------------
function AnalyticsView({ t, usd, nf, rtl }) {
  const DAY_KEYS = [1, 2, 3, 4, 5];
  const dayName = (d) => I18N[rtl ? "he" : "en"].weekdays[d];

  const byDay = useMemo(() => {
    const g = groupBy(TRADES, (tr) => tr.dow);
    return DAY_KEYS.map((d) => {
      const s = stats(g.get(d) || []);
      return { key: dayName(d), pnl: s.net, rr: s.avgRR, n: s.n, wr: s.winRate };
    });
  }, [rtl]);

  const bySession = useMemo(() => {
    const g = groupBy(TRADES, (tr) => sessionOf(tr.hour));
    return ["asia", "london", "ny"].map((k) => {
      const s = stats(g.get(k) || []);
      return { key: t(`session_${k}`), pnl: s.net, rr: s.avgRR, n: s.n, wr: s.winRate };
    });
  }, [t]);

  const byClass = useMemo(() => {
    const g = groupBy(TRADES, (tr) => tr.cls);
    return CLASSES.map((k) => {
      const s = stats(g.get(k) || []);
      return { key: t(k), pnl: s.net, rr: s.avgRR, n: s.n, wr: s.winRate };
    });
  }, [t]);

  const byDir = useMemo(() => {
    const g = groupBy(TRADES, (tr) => tr.direction);
    return ["long", "short"].map((k) => {
      const s = stats(g.get(k) || []);
      return { key: t(k), pnl: s.net, rr: s.avgRR, n: s.n, wr: s.winRate };
    });
  }, [t]);

  const insights = useMemo(() => {
    const all = [...byDay, ...bySession, ...byClass, ...byDir].filter((x) => x.n >= 5);
    return all.sort((a, b) => b.rr - a.rr).slice(0, 5);
  }, [byDay, bySession, byClass, byDir]);

  const heat = useMemo(() => {
    const cells = [];
    let maxAbs = 1;
    for (const d of DAY_KEYS) for (const s of ["asia", "london", "ny"]) {
      const list = TRADES.filter((tr) => tr.dow === d && sessionOf(tr.hour) === s);
      const pnl = list.reduce((a, b) => a + b.pnl, 0);
      maxAbs = Math.max(maxAbs, Math.abs(pnl));
      cells.push({ d, s, pnl, n: list.length });
    }
    return { cells, maxAbs };
  }, []);

  const BarCard = ({ title, data }) => (
    <Card title={title}>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke={T.line} vertical={false} />
            <XAxis dataKey="key" stroke={T.dim} fontSize={11} tickLine={false} axisLine={false} reversed={rtl} />
            <YAxis stroke={T.dim} fontSize={10} width={44} tickFormatter={(v) => nf(v)} orientation={rtl ? "right" : "left"} />
            <Tooltip content={<DarkTooltip fmt={(v) => usd(v)} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <ReferenceLine y={0} stroke={T.dim} />
            <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
              {data.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? T.pos : T.neg} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {data.map((e) => (
          <div key={e.key} style={{ fontSize: 11, color: T.dim }}>
            {e.key}: <span style={{ color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{e.rr.toFixed(2)}R</span> · {e.wr.toFixed(0)}%
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("insights")}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {insights.map((x, i) => (
            <div key={x.key} style={{ background: T.raised, border: `1px solid ${i === 0 ? T.pos : T.line}`, borderRadius: 14 }} className="px-3 py-2.5">
              <div style={{ fontSize: 12, color: T.dim }}>{x.key}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.pos, fontFamily: "'IBM Plex Mono', monospace" }}>{x.rr.toFixed(2)}R</div>
              <div style={{ fontSize: 11, color: T.dim }}>{x.wr.toFixed(0)}% · {x.n} {t("trades")}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>{t("bestNote")}</div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BarCard title={t("byWeekday")} data={byDay} />
        <BarCard title={t("bySession")} data={bySession} />
        <BarCard title={t("byClass")} data={byClass} />
        <BarCard title={t("byDirection")} data={byDir} />
      </div>

      <Card title={t("heatmap")}>
        <div className="overflow-x-auto">
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(3, minmax(90px,1fr))", gap: 6, minWidth: 380 }}>
            <div />
            {["asia", "london", "ny"].map((s) => (
              <div key={s} style={{ color: T.dim, fontSize: 11, textAlign: "center" }}>{t(`session_${s}`)}</div>
            ))}
            {[1, 2, 3, 4, 5].map((d) => (
              [
                <div key={`l${d}`} style={{ color: T.dim, fontSize: 12, display: "flex", alignItems: "center" }}>{dayName(d)}</div>,
                ...["asia", "london", "ny"].map((s) => {
                  const c = heat.cells.find((x) => x.d === d && x.s === s);
                  const a = Math.min(Math.abs(c.pnl) / heat.maxAbs, 1) * 0.8 + 0.06;
                  const bg = c.pnl >= 0 ? `rgba(45,212,167,${a})` : `rgba(255,92,122,${a})`;
                  return (
                    <div key={`${d}${s}`} style={{ background: bg, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: "#0A0B0F" }}>
                        {c.pnl >= 0 ? "+" : ""}{usd(c.pnl)}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(10,11,15,0.7)" }}>{c.n} {t("trades")}</div>
                    </div>
                  );
                }),
              ]
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------- TRADES ----------------
function TradesView({ t, usd, rtl }) {
  const [cls, setCls] = useState("all");
  const [dir, setDir] = useState("all");
  const [style, setStyle] = useState("all");

  const list = useMemo(() => [...TRADES].reverse().filter((tr) =>
    (cls === "all" || tr.cls === cls) &&
    (dir === "all" || tr.direction === dir) &&
    (style === "all" || tr.style === style)
  ), [cls, dir, style]);

  const S = useMemo(() => stats(list), [list]);
  const sel = { background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, color: T.text, fontSize: 12, padding: "6px 10px" };

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("filter")}>
        <div className="flex flex-wrap items-center gap-2">
          <select value={cls} onChange={(e) => setCls(e.target.value)} style={sel}>
            <option value="all">{t("all")}</option>
            {CLASSES.map((c) => <option key={c} value={c}>{t(c)}</option>)}
          </select>
          <select value={dir} onChange={(e) => setDir(e.target.value)} style={sel}>
            <option value="all">{t("all")}</option>
            <option value="long">{t("long")}</option>
            <option value="short">{t("short")}</option>
          </select>
          <select value={style} onChange={(e) => setStyle(e.target.value)} style={sel}>
            <option value="all">{t("all")}</option>
            <option value="day">Day</option>
            <option value="swing">Swing</option>
          </select>
          <div style={{ fontSize: 12, color: T.dim, marginInlineStart: "auto" }} className="flex gap-4">
            <span>{S.n} {t("trades")}</span>
            <span style={{ color: S.net >= 0 ? T.pos : T.neg, fontFamily: "'IBM Plex Mono', monospace" }}>
              {S.net >= 0 ? "+" : ""}{usd(S.net)}
            </span>
            <span>{S.avgRR.toFixed(2)}R</span>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: T.dim, fontSize: 11 }}>
                {[t("timeCol"), t("symbol"), "", t("dirCol"), t("styleCol"), t("risk"), "RR", t("pnlCol")].map((h, i) => (
                  <th key={i} style={{ textAlign: rtl ? "right" : "left", padding: "10px 14px", borderBottom: `1px solid ${T.line}`, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 40).map((tr) => (
                <tr key={tr.id} style={{ borderBottom: `1px solid ${T.line}` }}>
                  <td style={{ padding: "9px 14px", color: T.dim, fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(tr.close).toLocaleDateString(rtl ? "he-IL" : "en-GB", { day: "2-digit", month: "2-digit" })}
                    {" · "}
                    {new Date(tr.close).toLocaleTimeString(rtl ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "9px 14px", fontWeight: 700 }}>{tr.symbol}</td>
                  <td style={{ padding: "9px 14px" }}><Chip color={T.brand}>{t(tr.cls)}</Chip></td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ color: tr.direction === "long" ? T.pos : T.neg, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      {tr.direction === "long" ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                      {t(tr.direction)}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", color: T.dim, fontSize: 12 }}>{tr.style === "day" ? "Day" : "Swing"}</td>
                  <td style={{ padding: "9px 14px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{usd(tr.risk)}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <Chip color={tr.rr >= 0 ? T.pos : T.neg}>{tr.rr >= 0 ? "+" : ""}{tr.rr}R</Chip>
                  </td>
                  <td style={{ padding: "9px 14px", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: tr.pnl >= 0 ? T.pos : T.neg }}>
                    {tr.pnl >= 0 ? "+" : ""}{usd(tr.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------- CALENDAR ----------------
function CalendarView({ t, usd, rtl }) {
  const daysInMonth = 31; // July 2026
  const firstDow = new Date(2026, 6, 1).getDay();
  const byDate = useMemo(() => {
    const m = new Map();
    for (const tr of TRADES) {
      const d = new Date(tr.close);
      if (d.getMonth() !== 6 || d.getFullYear() !== 2026) continue;
      const k = d.getDate();
      if (!m.has(k)) m.set(k, { pnl: 0, n: 0 });
      const o = m.get(k); o.pnl += tr.pnl; o.n += 1;
    }
    return m;
  }, []);

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <Card title={t("calTitle")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {I18N[rtl ? "he" : "en"].weekdays.map((w, i) => (
          <div key={i} style={{ color: T.dim, fontSize: 11, textAlign: "center", padding: 4 }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const o = byDate.get(d);
          const bg = !o ? T.raised : o.pnl >= 0 ? "rgba(45,212,167,0.14)" : "rgba(255,92,122,0.14)";
          const bd = !o ? T.line : o.pnl >= 0 ? "rgba(45,212,167,0.4)" : "rgba(255,92,122,0.4)";
          return (
            <div key={d} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 12, minHeight: 66, padding: "6px 8px" }}>
              <div style={{ fontSize: 11, color: T.dim }}>{d}</div>
              {o ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: o.pnl >= 0 ? T.pos : T.neg }}>
                    {o.pnl >= 0 ? "+" : ""}{usd(o.pnl)}
                  </div>
                  <div style={{ fontSize: 10, color: T.dim }}>{o.n} {t("trades")}</div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: T.dim, opacity: 0.5 }}>{t("noTrades")}</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------- FINANCE ----------------
function FinanceView({ t, ils, usd, nf, finance, setFinance, S, longs }) {
  const [type, setType] = useState("expense");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const income = finance.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0);
  const expense = finance.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0);
  const net = income - expense;
  const longVal = longs.reduce((s, p) => s + p.cur * p.qty, 0);
  const tradingUsd = START_BALANCE + S.net;
  const totalIls = net + (tradingUsd + longVal) * RATE;

  const add = () => {
    const a = parseFloat(amount);
    if (!label.trim() || !a || a <= 0) return;
    setFinance([{ id: Date.now(), type, label: label.trim(), amount: a, date: "31.07" }, ...finance]);
    setLabel(""); setAmount("");
  };
  const remove = (id) => setFinance(finance.filter((f) => f.id !== id));

  const inp = { background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, color: T.text, fontSize: 13, padding: "8px 10px" };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={t("income")} value={ils(income)} tone="pos" />
        <KPI label={t("expenses")} value={ils(expense)} tone="neg" />
        <KPI label={t("monthNet")} value={(net >= 0 ? "+" : "") + ils(net)} tone={net >= 0 ? "pos" : "neg"} />
        <KPI label={t("totalWealth")} value={ils(totalIls)} sub="₪ ↔ $ · 3.70" />
      </div>

      <Card title={t("finTitle")}>
        <div className="flex flex-wrap items-center gap-2 pb-3" style={{ borderBottom: `1px solid ${T.line}` }}>
          <select value={type} onChange={(e) => setType(e.target.value)} style={inp}>
            <option value="income">{t("typeIncome")}</option>
            <option value="expense">{t("typeExpense")}</option>
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("entryLabel")} style={{ ...inp, flex: 1, minWidth: 140 }} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${t("amount")} (₪)`} type="number" style={{ ...inp, width: 120 }} />
          <button onClick={add} className="flex items-center gap-1.5 px-3 py-2"
            style={{ background: T.brand, border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <Plus size={14} /> {t("addEntry")}
          </button>
        </div>
        <div className="flex flex-col">
          {finance.map((f) => (
            <div key={f.id} className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${T.line}` }}>
              <div className="flex items-center gap-3">
                <div style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: f.type === "income" ? T.pos : T.neg,
                }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: T.dim }}>{f.date}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: f.type === "income" ? T.pos : T.neg, fontSize: 13 }}>
                  {f.type === "income" ? "+" : "-"}{ils(f.amount)}
                </div>
                <button onClick={() => remove(f.id)} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------- LONG TRADES ----------------
function LongView({ t, usd, nf, longs, setLongs, rtl }) {
  const [sym, setSym] = useState("");
  const [qty, setQty] = useState("");
  const [buy, setBuy] = useState("");
  const [edits, setEdits] = useState({});

  const totalCost = longs.reduce((s, p) => s + p.buy * p.qty, 0);
  const totalCur = longs.reduce((s, p) => s + p.cur * p.qty, 0);
  const unreal = totalCur - totalCost;

  const add = () => {
    const q = parseFloat(qty), b = parseFloat(buy);
    if (!sym.trim() || !q || !b || q <= 0 || b <= 0) return;
    setLongs([...longs, { id: Date.now(), symbol: sym.trim().toUpperCase(), qty: q, buy: b, cur: b, updated: "31.07.2026" }]);
    setSym(""); setQty(""); setBuy("");
  };
  const updateCur = (id) => {
    const v = parseFloat(edits[id]);
    if (!v || v <= 0) return;
    setLongs(longs.map((p) => (p.id === id ? { ...p, cur: v, updated: "31.07.2026" } : p)));
    setEdits({ ...edits, [id]: "" });
  };
  const remove = (id) => setLongs(longs.filter((p) => p.id !== id));

  const inp = { background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, color: T.text, fontSize: 13, padding: "8px 10px" };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <KPI label={t("buyPrice")} value={usd(totalCost)} />
        <KPI label={t("curVal")} value={usd(totalCur)} />
        <KPI label={t("unreal")} value={(unreal >= 0 ? "+" : "") + usd(unreal)} tone={unreal >= 0 ? "pos" : "neg"}
          sub={`${totalCost ? ((unreal / totalCost) * 100).toFixed(1) : 0}%`} />
      </div>

      <Card title={t("longTitle")}>
        <div className="flex flex-wrap items-center gap-2 pb-3" style={{ borderBottom: `1px solid ${T.line}` }}>
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder={t("symbol")} style={{ ...inp, width: 110 }} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t("qty")} type="number" style={{ ...inp, width: 100 }} />
          <input value={buy} onChange={(e) => setBuy(e.target.value)} placeholder={`${t("buyPrice")} ($)`} type="number" style={{ ...inp, width: 140 }} />
          <button onClick={add} className="flex items-center gap-1.5 px-3 py-2"
            style={{ background: T.brand, border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <Plus size={14} /> {t("addPos")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: T.dim, fontSize: 11 }}>
                {[t("symbol"), t("qty"), t("buyPrice"), t("curVal"), t("unreal"), t("updated"), ""].map((h, i) => (
                  <th key={i} style={{ textAlign: rtl ? "right" : "left", padding: "10px 12px", borderBottom: `1px solid ${T.line}`, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {longs.map((p) => {
                const u = (p.cur - p.buy) * p.qty;
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${T.line}` }}>
                    <td style={{ padding: "9px 12px", fontWeight: 700 }}>{p.symbol}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{p.qty}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>${nf(p.buy, 2)}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>${nf(p.cur, 2)}</span>
                        <input value={edits[p.id] || ""} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })}
                          placeholder="$" type="number" style={{ ...inp, width: 84, padding: "4px 8px", fontSize: 12 }} />
                        <button onClick={() => updateCur(p.id)}
                          style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 8, color: T.brand, fontSize: 11, padding: "4px 8px", cursor: "pointer" }}>
                          {t("update")}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: u >= 0 ? T.pos : T.neg }}>
                      {u >= 0 ? "+" : ""}{usd(u)}
                    </td>
                    <td style={{ padding: "9px 12px", color: T.dim, fontSize: 11 }}>
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {p.updated}</span>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <button onClick={() => remove(p.id)} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer" }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------- SETTINGS ----------------
function SettingsView({ t, lang, setLang, cur, setCur }) {
  const Toggle = ({ options, value, onChange }) => (
    <div className="flex gap-1" style={{ background: T.raised, borderRadius: 10, padding: 3, border: `1px solid ${T.line}` }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className="px-3 py-1.5"
          style={{
            borderRadius: 8, fontSize: 13, cursor: "pointer", border: "none",
            background: value === v ? T.brand : "transparent",
            color: value === v ? "#fff" : T.dim, fontWeight: value === v ? 700 : 500,
          }}>{label}</button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <Card title={t("language")}>
        <Toggle options={[["he", "עברית"], ["en", "English"]]} value={lang} onChange={setLang} />
      </Card>
      <Card title={t("currency")}>
        <Toggle options={[["ILS", "₪ שקל / ILS"], ["USD", "$ דולר / USD"]]} value={cur} onChange={setCur} />
      </Card>
      <Card title={t("mt5")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div style={{ width: 38, height: 38, borderRadius: 10, background: T.raised, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Landmark size={18} color={T.brand} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "'IBM Plex Mono', monospace" }}>#5021-4437</div>
              <div style={{ fontSize: 11, color: T.dim }}>{t("server")}: MetaQuotes-Live01</div>
            </div>
          </div>
          <Chip color={T.pos}>
            <span className="inline-flex items-center gap-1"><Shield size={11} /> {t("investor")}</span>
          </Chip>
        </div>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 12 }}>{t("settingsNote")}</div>
      </Card>
    </div>
  );
}
