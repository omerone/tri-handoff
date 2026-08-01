import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

/**
 * Outbound mail. Password reset is the only thing TRi sends — SPEC §5 puts alerts out of
 * scope — so the transport is created lazily and kept simple.
 */

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  const config = env();
  if (!config.SMTP_HOST) return null;

  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return transporter;
}

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Returns true when the message was handed to the SMTP server.
 *
 * A failure is logged and swallowed on purpose: the password-reset flow must answer the
 * user identically whether or not the address exists and whether or not mail went out, so
 * that it cannot be used to enumerate accounts.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    console.warn('[mail] SMTP_HOST is not configured; message not sent:', message.subject);
    return false;
  }

  try {
    await transport.sendMail({
      from: env().SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return true;
  } catch (error) {
    console.error('[mail] send failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
