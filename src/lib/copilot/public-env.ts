/**
 * The only build-time flag the browser is allowed to see.
 *
 * Spec 12.1 keeps budgets, models and prices in backend environment. Nothing
 * from there is readable here. This file exists so there is exactly one place
 * a `NEXT_PUBLIC_` name appears in the client, and so it can be pointed at.
 *
 * The demo path is off unless this is literally "true". It is a deliberate
 * choice made when the site is built or deployed — a Vercel preview that wants
 * the demo has to set it — and never something a failure switches on.
 */
export const COPILOT_DEMO_ENABLED =
  process.env.NEXT_PUBLIC_ARANJE_COPILOT_DEMO === "true";
