import type { Metadata } from 'next';

import { ContactLine, LegalPage } from '@/components/flipcast/legal-page';

export const metadata: Metadata = { title: 'Privacy — Flipcast' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <section>
        <h2>The short version</h2>
        <p>
          Your videos are processed inside your own browser and are never uploaded to us. We
          store your account, a record of what you rendered, and — if you subscribe — a link to
          your Stripe customer record. We do not sell data and we do not run advertising
          trackers.
        </p>
      </section>

      <section>
        <h2>What we store</h2>
        <ul>
          <li>Account: your email address, name, and a hashed password.</li>
          <li>
            Sessions: a sign-in cookie, plus the IP address and browser user-agent of each
            session, so you can stay signed in and we can spot abuse.
          </li>
          <li>
            Render history: file name, duration, dimensions, size, the formats you chose and
            whether the render succeeded. Never the video itself.
          </li>
          <li>Usage: seconds of video rendered this month, to enforce plan limits.</li>
          <li>
            How you found us: when you sign up, the tag on the link you first arrived from (such as
            ?ref=tiktok) and the referring website&apos;s domain, never the full address. It is kept
            in your browser until then, and tells us which channels are worth our time.
          </li>
          <li>
            Error reports: when something fails in your browser (a video that cannot be read,
            captions or tracking that could not run), the error message, your browser version and
            the page, so we can fix it. File names are removed first, and reports are deleted
            after 30 days.
          </li>
          <li>
            Billing: your plan and Stripe customer ID. Card details go directly to Stripe and
            never touch our servers.
          </li>
        </ul>
      </section>

      <section>
        <h2>Who processes it</h2>
        <ul>
          <li>Vercel — hosts the website and API.</li>
          <li>Neon — hosts the database.</li>
          <li>Stripe — handles payments, for paid plans only.</li>
        </ul>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          We set only the cookies needed to keep you signed in. There are no analytics or
          advertising cookies.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can ask us to export or delete your account and render history at any time — <ContactLine />.
          Deleting your account removes your render history with it. Stripe keeps payment
          records it is legally required to retain.
        </p>
      </section>
    </LegalPage>
  );
}
