"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Barcode,
  CalendarX2,
  CheckCircle2,
  IdCard,
  Loader2,
  ScanLine,
  Search,
  SearchX,
  ShieldOff,
  User,
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
import { feedback, parseScan } from "./feedback";
import { useScannerGun } from "./use-scanner-gun";
import { formatClock, formatDayShort, formatTime } from "@/lib/format";
import type { EventDate } from "@/lib/types";

type Mode = "scan" | "document" | "search";
type Method = "QR" | "DOCUMENTO" | "BUSQUEDA";
const AUTO_RESET_MS = 3500;

interface Props {
  eventId: string;
  /** Enlace general de acreditación: si viene, las acciones no requieren sesión */
  accessKey?: string;
  eventName: string;
  timezone: string;
  dates: EventDate[];
  initialDateId: string;
  /** Nombre de quien acredita (se muestra en el encabezado) */
  operator?: string | null;
}

export function CheckinConsole({ eventId, accessKey, eventName, timezone, dates, initialDateId, operator }: Props) {
  const key = accessKey;
  const [dateId, setDateId] = useState(initialDateId);
  const [mode, setMode] = useState<Mode>("scan"); // el escáner QR siempre es la primera opción
  const [result, setResult] = useState<LookupResult | null>(null);
  const [method, setMethod] = useState<Method>("DOCUMENTO");
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
      window.scrollTo({ top: 0, behavior: "smooth" });
      feedback(r.state === "VALID" || r.justCheckedIn ? "ok" : "error");
      // Tras un ingreso exitoso volvemos solos a la cámara o al campo de documento
      if (r.justCheckedIn && mode !== "search") {
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
  /** Cámara, pistola lectora o campo de DNI: QR del ticket, DNI físico (barras/MRZ) o código. */
  const onRead = useCallback(
    (text: string) => {
      const parsed = parseScan(text);
      if (!parsed) {
        setMethod("QR");
        show({ state: "NOT_FOUND", person: null });
        return;
      }
      if ("token" in parsed) {
        setMethod("QR");
        run(() => lookupRegistration({ eventId, key, eventDateId: dateId, token: parsed.token, method: "QR" }));
      } else {
        setMethod("DOCUMENTO");
        run(() => lookupRegistration({ eventId, key, eventDateId: dateId, codes: parsed.codes, method: "DOCUMENTO" }));
      }
    },
    [eventId, key, dateId, run, show],
  );
  const onScan = onRead;
  const onCode = onRead;

  // Pistola lectora: funciona en cualquier modo, también con un resultado en pantalla
  const [gunFlash, setGunFlash] = useState(false);
  useEffect(() => {
    if (!gunFlash) return;
    const t = setTimeout(() => setGunFlash(false), 2000);
    return () => clearTimeout(t);
  }, [gunFlash]);
  useScannerGun((text) => {
    if (busy) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setGunFlash(true);
    onRead(text);
  });

  const onPick = (p: CheckinPerson) => {
    setMethod("BUSQUEDA");
    run(() => lookupRegistration({ eventId, key, eventDateId: dateId, registrationId: p.id, method: "BUSQUEDA" }));
  };

  const onCheckIn = (holder: boolean, companionIds: string[]) => {
    if (!result?.person) return;
    const registrationId = result.person.id;
    run(() => performCheckIn({ eventId, key, eventDateId: dateId, registrationId, holder, companionIds, method }));
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearResult();
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-slate-950 text-white">
      {/* Encabezado ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-10 space-y-3 border-b border-white/10 bg-slate-950/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-slate-400">
              Acreditación{operator ? ` · ${operator}` : ""}
            </p>
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

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Fecha activa">
          {dates.map((d) => (
            <button
              key={d.id}
              aria-pressed={d.id === dateId}
              disabled={busy}
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

        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1" inert={busy}>
          <ModeButton active={mode === "scan"} onClick={() => switchMode("scan")}>
            <ScanLine className="size-4" /> Escanear QR
          </ModeButton>
          <ModeButton active={mode === "document"} onClick={() => switchMode("document")}>
            <IdCard className="size-4" /> DNI o código
          </ModeButton>
          <ModeButton active={mode === "search"} onClick={() => switchMode("search")}>
            <Search className="size-4" /> Por nombre
          </ModeButton>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-200">
            <AlertTriangle className="size-4" /> {error}
          </p>
        )}

        {mode === "scan" && (
          // La cámara queda encendida pero oculta mientras se muestra el resultado (reanuda al instante)
          <div className={result ? "hidden" : "relative"}>
            <p className="mb-3 text-center text-sm text-slate-400">Coloca el QR del ticket o el código de barras del DNI frente a la cámara.</p>
            <QrScanner onScan={onScan} paused={busy || Boolean(result)} />
            {busy && !result && (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="size-10 animate-spin" />
              </div>
            )}
          </div>
        )}

        {mode === "document" && !result && <DocumentPanel onSubmit={onCode} busy={busy} />}

        {mode === "search" && !result && (
          <SearchPanel eventId={eventId} accessKey={key} activeDateId={dateId} onPick={onPick} busy={busy} />
        )}

        {result && (
          <ResultPanel
            key={`${result.person?.id ?? "x"}-${result.justCheckedIn ?? 0}-${result.state}`}
            result={result}
            timezone={timezone}
            busy={busy}
            onCheckIn={onCheckIn}
            onClose={clearResult}
          />
        )}

        {!result && (
          <p className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-xs transition ${gunFlash ? "bg-emerald-500/15 text-emerald-300" : "text-slate-500"}`}>
            <Barcode className="size-4 shrink-0" />
            ¿Tienes pistola lectora? Escanea el QR del ticket o el código del DNI físico en cualquier momento.
          </p>
        )}
      </main>
    </div>
  );
}

// =====================================================================================
// Ingreso por DNI o código de vendedor (búsqueda exacta)
// =====================================================================================

function DocumentPanel({ onSubmit, busy }: { onSubmit: (code: string) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v.length >= 3) onSubmit(v);
      }}
    >
      <label htmlFor="checkin-code" className="block text-sm font-medium text-slate-300">
        DNI o código del trabajador
      </label>
      <input
        ref={ref}
        id="checkin-code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Escribe o escanea el DNI"
        autoComplete="off"
        autoCapitalize="characters"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-center font-mono text-2xl tracking-widest text-white placeholder:text-base placeholder:tracking-normal placeholder:text-slate-500 outline-none focus:border-white/30 focus:ring-4 focus:ring-white/10"
      />
      <button type="submit" disabled={busy || value.trim().length < 3} className="btn w-full bg-white py-3.5 text-base text-slate-900 hover:bg-slate-100 disabled:opacity-50">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <IdCard className="size-5" />} Verificar asistencia
      </button>
      <p className="text-xs text-slate-400">Funciona con el DNI del titular o de sus acompañantes, el código del trabajador o la lectura de una pistola.</p>
    </form>
  );
}

// =====================================================================================
// Resultado de la validación (verde / rojo)
// =====================================================================================

function latestEntry(p: CheckinPerson) {
  const times = [p.holderCheckedInAt, ...p.companions.map((c) => c.checkedInAt)].filter(Boolean) as string[];
  return times.sort().at(-1) ?? null;
}

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
  onCheckIn: (holder: boolean, companionIds: string[]) => void;
  onClose: () => void;
}) {
  const { state, person, justCheckedIn } = result;
  const ok = state === "VALID" || Boolean(justCheckedIn);

  // Selección: por defecto todas las personas pendientes
  const [holder, setHolder] = useState(Boolean(person && !person.holderCheckedInAt));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(person?.companions.filter((c) => !c.checkedInAt).map((c) => c.id) ?? []),
  );
  const count = (holder ? 1 : 0) + selected.size;

  const firstEntry = person?.holderCheckedInAt ?? (person ? latestEntry(person) : null);
  const view = justCheckedIn
    ? {
        icon: <CheckCircle2 />,
        title: "Ingreso registrado",
        subtitle: justCheckedIn === 1 ? "Puede pasar" : `Pueden pasar ${justCheckedIn} personas`,
      }
    : {
        VALID: {
          icon: <CheckCircle2 />,
          title: "Registro válido",
          subtitle:
            person && (person.holderCheckedInAt || person.companions.some((c) => c.checkedInAt))
              ? "Hay personas pendientes de ingresar"
              : "Confirma el ingreso",
        },
        ALREADY_IN: {
          icon: <XCircle />,
          title: "Ya ingresó",
          subtitle: firstEntry ? `Esta persona ya ingresó al evento a las ${formatClock(firstEntry, timezone)} — no registres un nuevo ingreso` : "Este registro ya fue usado",
        },
        WRONG_DATE: {
          icon: <CalendarX2 />,
          title: "Fecha incorrecta",
          subtitle: result.registeredDay ? `Inscrito para el ${formatDayShort(result.registeredDay)}` : "Inscrito para otra fecha",
        },
        CANCELLED: { icon: <Ban />, title: "Inscripción cancelada", subtitle: "No tiene acceso" },
        NOT_FOUND: { icon: <SearchX />, title: "No encontrado", subtitle: "No hay inscripción con ese QR, documento o código en este evento" },
        NO_ACCESS: {
          icon: <ShieldOff />,
          title: "Sin acceso",
          subtitle: "Ya no tienes acceso a este evento. Consulta con el coordinador o supervisor.",
        },
      }[state];

  const canAct = state === "VALID" && !justCheckedIn;

  return (
    <section
      aria-live="assertive"
      className={["overflow-hidden rounded-2xl ring-2", ok ? "bg-emerald-600 ring-emerald-400" : "bg-red-600 ring-red-400"].join(" ")}
    >
      <div className="flex items-start gap-3 p-5">
        <span className="[&>svg]:size-12">{view.icon}</span>
        <div className="flex-1">
          <h2 className="text-2xl font-bold leading-tight sm:text-3xl">{view.title}</h2>
          {state === "ALREADY_IN" && !justCheckedIn && firstEntry ? (
            <>
              <p className="mt-1 text-white/90">Esta persona ya ingresó al evento a las</p>
              <p className="text-4xl font-extrabold tabular-nums leading-tight">{formatClock(firstEntry, timezone)}</p>
              <p className="mt-1 text-sm font-semibold text-white/90">No registres un nuevo ingreso.</p>
            </>
          ) : (
            <p className="mt-0.5 text-white/90">{view.subtitle}</p>
          )}
        </div>
        <button onClick={onClose} disabled={busy} aria-label="Cerrar resultado" className="grid size-11 place-items-center rounded-full hover:bg-white/15 disabled:opacity-50">
          <X className="size-5" />
        </button>
      </div>

      {person && (
        <ul className="space-y-2 bg-slate-950/25 p-4">
          <PersonRow
            icon={<User className="size-4" />}
            name={person.fullName}
            detail={[`${person.documentType} ${person.documentNumber}`, person.employeeCode && `Cód. ${person.employeeCode}`, person.company].filter(Boolean).join(" · ")}
            checkedAt={person.holderCheckedInAt}
            timezone={timezone}
            selectable={canAct}
            checked={holder}
            onToggle={() => setHolder((v) => !v)}
          />
          {person.companions.map((c, i) => (
            <PersonRow
              key={c.id}
              icon={<UserPlus className="size-4" />}
              name={c.fullName}
              detail={`Acompañante ${i + 1} · ${c.documentType} ${c.documentNumber}`}
              checkedAt={c.checkedInAt}
              timezone={timezone}
              selectable={canAct}
              checked={selected.has(c.id)}
              onToggle={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            />
          ))}
        </ul>
      )}

      <div className="p-4">
        {canAct ? (
          <button
            onClick={() => onCheckIn(holder, [...selected])}
            disabled={busy || count === 0}
            className="btn w-full bg-white py-3.5 text-base text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Users className="size-5" />}
            {count === 0 ? "Selecciona quién ingresa" : count === 1 ? "Confirmar ingreso" : `Confirmar ingreso de ${count} personas`}
          </button>
        ) : (
          <button onClick={onClose} className="btn w-full bg-white/15 py-3 text-white hover:bg-white/25">
            {justCheckedIn ? "Acreditar a otra persona" : "Volver"}
          </button>
        )}
      </div>
    </section>
  );
}

function PersonRow({
  icon,
  name,
  detail,
  checkedAt,
  timezone,
  selectable,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  checkedAt: string | null;
  timezone: string;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const pending = !checkedAt;
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-lg font-semibold leading-snug">{name}</p>
        <p className="break-words text-sm text-white/75">{detail}</p>
      </div>
      {checkedAt ? (
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-900">
          Ingresó {formatClock(checkedAt, timezone)}
        </span>
      ) : selectable ? (
        <input type="checkbox" checked={checked} onChange={onToggle} className="size-6 shrink-0 accent-white" aria-label={`Ingresa ${name}`} />
      ) : (
        <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">Pendiente</span>
      )}
    </>
  );
  return (
    <li>
      {selectable && pending ? (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl p-1">{content}</label>
      ) : (
        <div className="flex items-center gap-3 rounded-xl p-1">{content}</div>
      )}
    </li>
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
  const [searchError, setSearchError] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const id = ++reqId.current;
    setItems([]);
    setSearchError(false);
    if (term.length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchRegistrations({ eventId, key: accessKey, q: term });
        if (id === reqId.current) {
          setNoAccess(res === null);
          setItems(res ?? []);
          setLoading(false);
        }
      } catch {
        if (id === reqId.current) {
          setSearchError(true);
          setLoading(false);
        }
      }
    }, 250);
    return () => {
      clearTimeout(t);
      reqId.current++;
    };
  }, [q, eventId, accessKey]);

  return (
    <div className="space-y-3">
      <label htmlFor="checkin-search" className="block text-sm font-medium text-slate-300">Encuentra al asistente</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          id="checkin-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, correo, DNI o código…"
          inputMode="search"
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-11 pr-10 text-base text-white placeholder:text-slate-500 outline-none focus:border-white/30 focus:ring-4 focus:ring-white/10"
        />
        {loading && <Loader2 className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      <p role="status" className="text-sm text-slate-300">
        {loading
          ? "Buscando asistentes…"
          : noAccess
            ? ""
            : searchError
              ? "No se pudo buscar. Revisa tu conexión e inténtalo otra vez."
              : q.trim().length >= 2 && items.length
                ? `${items.length} coincidencias. Selecciona una para verificar el ingreso.`
                : ""}
      </p>

      {noAccess && !loading && (
        <div role="alert" className="flex gap-3 rounded-xl bg-red-600 p-4 text-white">
          <ShieldOff className="mt-0.5 size-6 shrink-0" />
          <div>
            <p className="font-semibold">Sin acceso</p>
            <p className="text-sm text-white/85">Ya no tienes acceso a este evento. Consulta con el coordinador o supervisor.</p>
          </div>
        </div>
      )}

      {q.trim().length >= 2 && !loading && !searchError && !noAccess && items.length === 0 && (
        <p className="py-8 text-center text-slate-400">Sin resultados para “{q.trim()}”.</p>
      )}

      <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-white/5">
        {items.map((p) => {
          const otherDate = p.eventDateId !== activeDateId;
          const done = Boolean(p.holderCheckedInAt) && p.companions.every((c) => c.checkedInAt);
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
                    {p.documentType} {p.documentNumber}
                    {p.employeeCode && ` · Cód. ${p.employeeCode}`}
                    {p.companions.length > 0 && ` · +${p.companions.length} acompañante${p.companions.length > 1 ? "s" : ""}`}
                  </p>
                </div>
                <StatusPill
                  label={p.status === "CANCELADO" ? "Cancelado" : otherDate ? "Otra fecha" : done ? "Ingresó" : "Pendiente"}
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
      aria-pressed={active}
      className={[
        "flex items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-xs font-semibold transition sm:text-sm",
        active ? "bg-white text-slate-900" : "text-slate-300 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
