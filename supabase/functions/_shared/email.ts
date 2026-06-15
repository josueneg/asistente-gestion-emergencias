// Envío de notificaciones por correo vía Brevo (api.brevo.com).
// Si BREVO_API_KEY no está configurada, no hace nada: el flujo de
// aprobación/rechazo de documentos sigue funcionando sin notificar.

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ?? "josueneg@hotmail.com";
const FROM_NAME = "Asistente de Gestión de Emergencias - COE";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(
  to: string,
  toName: string | null | undefined,
  subject: string,
  html: string,
): Promise<void> {
  if (!BREVO_API_KEY) {
    console.log(`BREVO_API_KEY no configurada; no se envía correo a ${to}`);
    return;
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: to, name: toName || undefined }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      console.error(`Error de Brevo (${res.status}):`, await res.text());
    }
  } catch (err) {
    console.error("Error enviando correo:", err);
  }
}
