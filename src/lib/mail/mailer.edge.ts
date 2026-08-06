/**
 * Outbound mail, as the Edge runtime sees it: nothing.
 *
 * The same shape of problem as `src/lib/secrets/manager.edge.ts`, and for the same reason.
 * Next compiles `instrumentation.ts` for Edge as well as for Node, and everything reachable
 * from it comes along — including `./instrumentation-node`, which now checks at startup
 * whether this deployment can send mail at all. That check reaches nodemailer, nodemailer
 * reaches `path`, `fs` and `crypto` through its DKIM signer, and none of those exist on Edge,
 * so the build fails on a module that can never run there. `serverExternalPackages` lists
 * nodemailer already and does not help: it covers the Node server bundle only.
 *
 * `next.config.ts` points the Edge build here instead. The only Edge code in the app is
 * `middleware.ts`, which imports one pure host-parsing helper and sends no mail, so a
 * transport that reports itself unavailable is not a degraded mode — it is an accurate
 * description of a code path that does not run.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendMail(_message: MailMessage): Promise<boolean> {
  return false;
}

export async function verifyMailTransport(): Promise<boolean> {
  return false;
}
