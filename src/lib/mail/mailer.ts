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
 * Says at boot whether this deployment can send mail at all.
 *
 * Every send failure below is logged and swallowed, deliberately — the reset flow has to
 * answer identically whether or not an address exists, and that means it cannot report an
 * SMTP error either. The cost is that a deployment which cannot send mail looks exactly like
 * one that can, from the outside and from the screen, until someone forgets their password
 * and is simply never let back in.
 *
 * Production was in that state: `SMTP_HOST=localhost` pointing at the mailpit port from the
 * dev compose profile, which is not running there. Nothing was listening, every reset mail
 * failed with ECONNREFUSED, and the only self-service way back into an account had been dead
 * for as long as anyone had been able to check — with the screen still saying "check your
 * email". The one remaining route in was the operator setting a password by hand, which until
 * this week left no record either.
 *
 * So it is checked once, at startup, where a wrong answer is cheap to notice and a deploy is
 * the moment someone is already looking. `verify()` opens a connection and authenticates
 * without sending anything.
 */
export async function verifyMailTransport(): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    console.error(
      '[mail] SMTP_HOST is not set: password reset cannot deliver, and the only way back ' +
        'into a locked-out account is the operator setting a password by hand.',
    );
    return false;
  }

  try {
    await transport.verify();
    console.warn(`[mail] outbound mail ready via ${env().SMTP_HOST}:${env().SMTP_PORT}`);
    return true;
  } catch (error) {
    console.error(
      `[mail] SMTP at ${env().SMTP_HOST}:${env().SMTP_PORT} is unreachable — password reset ` +
        'will accept the request and deliver nothing:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

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
