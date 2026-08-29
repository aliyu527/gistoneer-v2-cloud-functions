import {Resend} from 'resend';
import type {OtpPurpose} from './types';

const SUBJECT_BY_PURPOSE: Record<OtpPurpose, string> = {
  registration: 'Verify your email for Gistoneer',
  reset: 'Reset your Gistoneer password',
};

export async function sendVerificationEmail(
  apiKey: string,
  from: string,
  to: string,
  code: string,
  purpose: OtpPurpose,
): Promise<void> {
  const resend = new Resend(apiKey);
  const minutes = 10;

  await resend.emails.send({
    from,
    to,
    subject: SUBJECT_BY_PURPOSE[purpose],
    html: renderEmailHtml(code, minutes, purpose),
  });
}

function renderEmailHtml(code: string, minutes: number, purpose: OtpPurpose): string {
  const intro =
    purpose === 'reset'
      ? "We received a request to reset your Gistoneer password."
      : "Use the code below to verify your email and finish creating your Gistoneer account.";

  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; color: #161722;">Gistoneer</h1>
      <p style="font-size: 15px; color: #161722;">${intro}</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #00AEEF; margin: 24px 0;">${code}</p>
      <p style="font-size: 13px; color: #86878B;">This code expires in ${minutes} minutes. If you didn't request this, you can safely ignore this email — no changes will be made to your account.</p>
    </div>
  `.trim();
}
