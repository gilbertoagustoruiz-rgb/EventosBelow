"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarX2,
  CheckCircle2,
  Loader2,
  ScanLine,
  Search,
  SearchX,
  User,
  UserCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  getDateStats,
  lookupRegistration,
  performCheckIn,
  searchRegistrations,
  type CheckinPerson,
  type DateStats,
  type LookupResult,
} from "@/app/checkin/actions";
import { QrScanner } from "./qr-scanner";
import { extractToken, feedback } from "./feedback";
import { formatClock, formatDayShort, formatTime } from "@/lib/format";
import type { EventDate } from "@/lib/types";

type Mode = "scan" | "search";
const AUTO_RESET_MS = 3500;

interface Props {
  eventId: string;
  /** Enlace secreto de acreditación: si viene, las acciones no requieren sesión */
  accessKey?: string;
  eventName: string;
  timezone: string;
  dates: EventDate[];
  initialDateId: string;
}

export function CheckinConsole({ eventId, accessKey, eventName, timezone, dates, initialDateId }: Props) {
  const key = accessKey;
  const [dateId, setDateId] = useState(initialDateId);
  const [mode, setMode] = useState<Mode>("scan");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [stats, setStats] = useState<DateStats | null>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Métricas --------------------------------------------------------------------
  const refreshStats = useCallback(() => {
    getDateStats(eventId, dateId, key).then(setStats).catch(() => {});
  }, [eventId, dateId, key]);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 30_000);
    return () => clearInterval(id);
  }, [refreshStats]);

  const clearResult = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setResult(null);
    setError(null);
  }, []);

  useEffect(clearResult, [dateId, clearResult]);

  const show = useCallback(
    (r: LookupResult) => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      setResult(r);
      feedback(r.state === "VALID" || r.justCheckedIn ? "ok" : "error");
      // En modo escáner, tras un ingreso exitoso volvemos a la cámara solos
      if (r.justCheckedIn && mode === "scan") {
        resetTimer.current = setTimeout(() => setResult(null), AUTO_RESET_MS);
      }
      if (r.justCheckedIn) refreshStats();
    },
    [mode, refreshStats],
  );

  const run = useCallback(
    (fn: () => Promise<LookupResult>) => {
      setError(null);
      startBusy(async () => {
        try {
          show(await fn());
        } catch {
          setError("Error de conexión. Intenta nuevamente.");
          feedback("error");
        }
      });
    },
    [show],
  );

  // --- Acciones --------------------------------------------------------------------
  const onScan = useCallback(
    (text: string) => {
      const token = extractToken(text);
      if (!token) {
        show({ state: "NOT_FOUND", person: null });
        return;
      }
      run(() => lookupRegistration({ eventId, key, eventDateId: dateId, token }));
    },
    [eventId, key, dateId, run, show],
  );

  const onPick = (p: CheckinPerson) =>
    run(() => lookupRegistration({ eventId, key, eventDateId: dateId, registrationId: p.id }));

  const onCheckIn = (target: "HOLDER" | "COMPANION" | "BOTH") => {
    if (!result?.person) return;
    const registrationId = result.person.id;
    run(() => performCheckIn({ eventId, key, eventDateId: dateId, registrationId, target }));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-slate-950 text-white">
      {/* Encabezado ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-10 space-y-3 border-b border-white/10 bg-slate-950/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-slate-400">Acreditación</p>
            <h1 className="truncate text-lg font-semibold">{eventName}</h1>
          </div>
          {stats && (
            <div className="shrink-0 text-right">
              <p className="text-2xl font-bold tabular-nums leading-none">
                {stats.peopleCheckedIn}
                <span className="text-base font-medium text-slate-400">/{stats.seatsTaken}</span>
              </p>
              <p className="text-xs text-slate-400">ingresados</p>
            </div>
          )}
        </div>

        {stats && stats.seatsTaken > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, (stats.peopleCheckedIn / stats.seatsTaken) * 100)}%` }}
            />
          </div>
        )}

        {/* Selector de fecha activa */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Fecha activa">
          {dates.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === dateId}
              onClick={() => setDateId(d.id)}
              className={[
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                d.id === dateId ? "bg-white text-slate-900" : "bg-white/10 text-slate-200 hover:bg-white/15",
              ].join(" ")}
            >
              {formatDayShort(d.event_day)} · {formatTime(d.starts_at)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
          <ModeButton active={mode === "scan"} onClick={() => { setMode("scan"); clearResult(); }}>
            <ScanLine className="size-4" /> Escanear QR
          </ModeButton>
          <ModeButton active={mode === "search"} onClick={() => { setMode("search"); clearResult(); }}>
            <Search className="size-4" /> Buscar
          </ModeButton>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {error && (
          <p className="flex items-center gap-2 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-200">
            <AlertTriangle className="size-4" /> {error}
          </p>
        )}

        {mode === "scan" && (
          <div className="relative">
            <QrScanner onScan={onScan} paused={busy || Boolean(result)} />
            {busy && !result && (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="size-10 animate-spin" />
              </div>
            )}
          </div>
        )}

        {mode === "search" && !result && <SearchPanel eventId={eventId} accessKey={key} activeDateId={dateId} onPick={onPick} busy={busy} />}

        {result && (
          <ResultPanel
            result={result}
            timezone={timezone}
            busy={busy}
            onCheckIn={onCheckIn}
            onClose={clearResult}
          />
        )}
      </main>
    </div>
  );
}

// =====================================================================================
// Resultado de la validación (verde / rojo)
// =====================================================================================

function ResultPanel({
  result,
  timezone,
  busy,
  onCheckIn,
  onClose,
}: {
  result: LookupResult;
  timezone: string;
  busy: boolean;
  onCheckIn: (t: "HOLDER" | "COMPANION" | "BOTH") => void;
  onClose: () => void;
}) {
  const { state, person, justCheckedIn } = result;
  const ok = state === "VALID" || justCheckedIn;

  const view = justCheckedIn
    ? { icon: <CheckCircle2 />, title: "Ingreso registrado", subtitle: "Puede pasar" }
    : {
        VALID: { icon: <CheckCircle2 />, title: "Registro válido", subtitle: "Confirma el ingreso" },
        ALREADY_IN: { icon: <XCircle />, title: "Ya ingresó", subtitle: "Este registro ya fue usado" },
        WRONG_DATE: {
          icon: <CalendarX2 />,
          title: "Fecha incorrecta",
          subtitle: result.registeredDay ? `Registrado para el ${formatDayShort(result.registeredDay)}` : "Registrado para otra fecha",
        },
        CANCELLED: { icon: <Ban />, title: "Registro cancelado", subtitle: "No tiene acceso" },
        NOT_FOUND: { icon: <SearchX />, title: "No encontrado", subtitle: "El código no pertenece a este evento" },
      }[state];

  const holderPending = person && !person.holderCheckedInAt;
  const companionPending = person?.hasCompanion && !person.companionCheckedInAt;
  const canAct = state === "VALID";

  return (
    <section
      aria-live="assertive"
      className={[
        "overflow-hidden rounded-2xl ring-2",
        ok ? "bg-emerald-600 ring-emerald-400" : "bg-red-600 ring-red-400",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-5">
        <span className="[&>svg]:size-12">{view.icon}</span>
        <div className="flex-1">
          <h2 className="text-2xl font-bold leading-tight">{view.title}</h2>
          <p className="text-white/85">{view.subtitle}</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-full p-1.5 hover:bg-white/15">
          <X className="size-5" />
        </button>
      </div>

      {person && (
        <div className="space-y-3 bg-slate-950/25 p-5">
          <PersonLine
            icon={<User className="size-4" />}
            name={person.fullName}
            detail={`${person.documentType} ${person.documentNumber}${person.company ? ` · ${person.company}` : ""}`}
            checkedAt={person.holderCheckedInAt}
            timezone={timezone}
          />
          {person.hasCompanion && (
            <PersonLine
              icon={<UserPlus className="size-4" />}
              name={person.companionFullName ?? "Acompañante"}
              detail={`Acompañante${person.companionDocumentNumber ? ` · ${person.companionDocumentNumber}` : ""}`}
              checkedAt={person.companionCheckedInAt}
              timezone={timezone}
            />
          )}
        </div>
      )}

      {canAct && (
        <div className="grid gap-2 p-4">
          {holderPending && companionPending && (
            <ActionButton onClick={() => onCheckIn("BOTH")} busy={busy} primary>
              <Users className="size-5" /> Ingresar ambos
            </ActionButton>
          )}
          <div className={`grid gap-2 ${holderPending && companionPending ? "grid-cols-2" : ""}`}>
            {holderPending && (
              <ActionButton onClick={() => onCheckIn("HOLDER")} busy={busy} primary={!companionPending}>
                <UserCheck className="size-5" /> {companionPending ? "Solo titular" : "Marcar ingreso"}
              </ActionButton>
            )}
            {companionPending && (
              <ActionButton onClick={() => onCheckIn("COMPANION")} busy={busy} primary={!holderPending}>
                <UserPlus className="size-5" /> {holderPending ? "Solo acompañante" : "Ingresar acompañante"}
              </ActionButton>
            )}
          </div>
        </div>
      )}

      {!canAct && (
        <div className="p-4">
          <button onClick={onClose} className="btn w-full bg-white/15 py-3 text-white hover:bg-white/25">
            {justCheckedIn ? "Siguiente" : "Continuar"}
          </button>
        </div>
      )}
    </section>
  );
}

function PersonLine({
  icon,
  name,
  detail,
  checkedAt,
  timezone,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  checkedAt: string | null;
  timezone: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-sm text-white/75">{detail}</p>
      </div>
      <span
        className={[
          "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
          checkedAt ? "bg-white text-slate-900" : "bg-white/15 text-white",
        ].join(" ")}
      >
        {checkedAt ? `Ingresó ${formatClock(checkedAt, timezone)}` : "Pendiente"}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={[
        "btn py-3.5 text-base",
        primary ? "bg-white text-emerald-800 hover:bg-emerald-50" : "bg-white/15 text-white hover:bg-white/25",
      ].join(" ")}
    >
      {busy ? <Loader2 className="size-5 animate-spin" /> : children}
    </button>
  );
}

// =====================================================================================
// Búsqueda manual predictiva
// =====================================================================================

function SearchPanel({
  eventId,
  accessKey,
  activeDateId,
  onPick,
  busy,
}: {
  eventId: string;
  accessKey?: string;
  activeDateId: string;
  onPick: (p: CheckinPerson) => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CheckinPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await searchRegistrations({ eventId, key: accessKey, q: term }).catch(() => []);
      if (id === reqId.current) {
        setItems(res);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, eventId, accessKey]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="DNI, nombre o correo…"
          inputMode="search"
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-11 pr-10 text-base text-white placeholder:text-slate-500 outline-none focus:border-white/30 focus:ring-4 focus:ring-white/10"
        />
        {loading && <Loader2 className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      {q.trim().length >= 2 && !loading && items.length === 0 && (
        <p className="py-8 text-center text-slate-400">Sin resultados para “{q.trim()}”.</p>
      )}

      <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-white/5">
        {items.map((p) => {
          const otherDate = p.eventDateId !== activeDateId;
          const done = Boolean(p.holderCheckedInAt) && (!p.hasCompanion || Boolean(p.companionCheckedInAt));
          return (
            <li key={p.id}>
              <button
                onClick={() => onPick(p)}
                disabled={busy}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5 disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.fullName}</p>
                  <p className="truncate text-sm text-slate-400">
                    {p.documentType} {p.documentNumber} · {p.email}
                    {p.hasCompanion && ` · +1 ${p.companionFullName ?? ""}`}
                  </p>
                </div>
                <StatusPill
                  label={
                    p.status === "CANCELADO" ? "Cancelado" : otherDate ? "Otra fecha" : done ? "Ingresó" : "Pendiente"
                  }
                  tone={p.status === "CANCELADO" || otherDate ? "red" : done ? "slate" : "green"}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "green" | "red" | "slate" }) {
  const cls = {
    green: "bg-emerald-500/15 text-emerald-300",
    red: "bg-red-500/15 text-red-300",
    slate: "bg-white/10 text-slate-300",
  }[tone];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition",
        active ? "bg-white text-slate-900" : "text-slate-300 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
