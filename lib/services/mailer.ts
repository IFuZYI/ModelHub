import { logger } from "../infra/logger";
import { settingsService } from "./settingsService";

/**
 * Minimal SMTP mailer (ADR-0012). Uses Node's net/tls directly to avoid a new
 * dependency; supports STARTTLS(587) and implicit TLS(465) with AUTH LOGIN.
 * Best-effort: throws on hard failures so callers can surface a clear error.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function isMailerConfigured(): Promise<boolean> {
  const c = await settingsService.smtpConfig();
  return Boolean(c.host && c.port && c.from);
}

export async function sendMail(mail: Mail): Promise<void> {
  const c = await settingsService.smtpConfig();
  if (!c.host || !c.port || !c.from) {
    throw new Error("SMTP is not configured");
  }
  const net = await import("net");
  const tls = await import("tls");

  const implicitTls = c.port === 465;
  const socket = implicitTls
    ? tls.connect({ host: c.host, port: c.port, servername: c.host })
    : net.connect({ host: c.host, port: c.port });

  const read = () =>
    new Promise<string>((resolve, reject) => {
      const onData = (d: Buffer) => {
        socket.off("error", onErr);
        resolve(d.toString());
      };
      const onErr = (e: Error) => {
        socket.off("data", onData);
        reject(e);
      };
      socket.once("data", onData);
      socket.once("error", onErr);
    });
  const write = (line: string) =>
    new Promise<void>((resolve, reject) =>
      socket.write(line + "\r\n", (e) => (e ? reject(e) : resolve()))
    );
  const expect = async (codePrefix: string) => {
    const res = await read();
    if (!res.startsWith(codePrefix)) {
      throw new Error(`SMTP unexpected reply: ${res.trim()}`);
    }
    return res;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("secureConnect", () => resolve());
      socket.once("error", reject);
    });
    await expect("220");
    await write(`EHLO ${c.host}`);
    await expect("250");

    if (!implicitTls) {
      await write("STARTTLS");
      await expect("220");
      // Upgrade is required for AUTH; a plain fallback is refused for safety.
      throw new Error(
        "STARTTLS upgrade not supported by the built-in mailer; use port 465 (implicit TLS)"
      );
    }

    if (c.username && c.password) {
      await write("AUTH LOGIN");
      await expect("334");
      await write(Buffer.from(c.username).toString("base64"));
      await expect("334");
      await write(Buffer.from(c.password).toString("base64"));
      await expect("235");
    }
    await write(`MAIL FROM:<${c.from}>`);
    await expect("250");
    await write(`RCPT TO:<${mail.to}>`);
    await expect("250");
    await write("DATA");
    await expect("354");
    const body =
      `From: ${c.from}\r\n` +
      `To: ${mail.to}\r\n` +
      `Subject: ${mail.subject}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
      mail.text.replace(/\r?\n/g, "\r\n") +
      "\r\n.";
    await write(body);
    await expect("250");
    await write("QUIT");
  } finally {
    socket.end();
  }
  logger.info({ to: mail.to }, "sent mail");
}
