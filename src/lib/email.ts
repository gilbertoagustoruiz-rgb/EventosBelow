import "server-only";
import { appUrl, formatDay, formatTime } from "@/lib/format";

interface ConfirmationEmail {
  to: string;
  fullName: string;
  eventName: string;
  eventSlug: string;
  venue: string | null;
  brandColor: string;
  day: string;
  startsAt: string;
  endsAt: string;
  token: string;
  companionNames: string[];
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render(m: ConfirmationEmail) {
  const ticketUrl = appUrl(`/evento/${m.eventSlug}/ticket/${m.token}`);
  const qrUrl = appUrl(`/api/qr/${m.token}`);
  const when = `${formatDay(m.day)} · ${formatTime(m.startsAt)} – ${formatTime(m.endsAt)}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:${m.brandColor};height:8px"></td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Registro confirmado</p>
        <h1 style="margin:8px 0 16px;font-size:24px">${escape(m.eventName)}</h1>
        <p style="margin:0 0 4px">Hola <strong>${escape(m.fullName)}</strong>, tu lugar está reservado.</p>
        <p style="margin:0 0 4px;color:#334155">${escape(when)}</p>
        ${m.venue ? `<p style="margin:0 0 4px;color:#334155">${escape(m.venue)}</p>` : ""}
        ${m.companionNames.length ? `<p style="margin:12px 0 0;color:#334155">${m.companionNames.length === 1 ? "Acompañante" : "Acompañantes"}: <strong>${m.companionNames.map(escape).join(", ")}</strong></p>` : ""}
        <div style="text-align:center;margin:28px 0">
          <img src="${qrUrl}" width="220" height="220" alt="Código QR de acceso" style="border:1px solid #e2e8f0;border-radius:12px;padding:8px" />
          <p style="margin:8px 0 0;font-family:monospace;font-size:12px;color:#64748b">${m.token.slice(0, 8).toUpperCase()}</p>
        </div>
        <p style="margin:0 0 20px;color:#334155">Presenta este código en el ingreso junto con tu documento de identidad.</p>
        <a href="${ticketUrl}" style="display:inline-block;background:${m.brandColor};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Ver mi ticket</a>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = `Registro confirmado: ${m.eventName}\n${when}\n${m.venue ?? ""}\n\nTu ticket: ${ticketUrl}`;
  return { html, text };
}

/** Dirección de EMAIL_FROM ("Nombre <correo>" o solo el correo). */
function fromAddress() {
  const raw = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  return raw.match(/<([^>]+)>/)?.[1] ?? raw.trim();
}

/**
 * Envía el correo de confirmación. Con RESEND_API_KEY usa Resend;
 * sin ella, simula el envío en consola (útil en desarrollo).
 * Nunca lanza: un fallo de correo no debe anular un registro válido.
 */
export async function sendConfirmationEmail(m: ConfirmationEmail): Promise<{ sent: boolean; simulated: boolean }> {
  const { html, text } = render(m);
  const subject = `Tu registro para ${m.eventName}`;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(`[email:simulado] para=${m.to} asunto="${subject}" ticket=${appUrl(`/evento/${m.eventSlug}/ticket/${m.token}`)}`);
    return { sent: false, simulated: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Marca blanca: el remitente se muestra con el nombre del evento
        from: `${m.eventName.replace(/[<>"]/g, "")} <${fromAddress()}>`,
        to: [m.to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) console.error("[email] Resend respondió", res.status, await res.text());
    return { sent: res.ok, simulated: false };
  } catch (err) {
    console.error("[email] error enviando confirmación", err);
    return { sent: false, simulated: false };
  }
}
