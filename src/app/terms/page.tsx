import type { Metadata } from 'next';

import { ContactLine, LegalPage } from '@/components/flipcast/legal-page';

export const metadata: Metadata = { title: 'Terms — Flipcast' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <section>
        <h2>The service</h2>
        <p>
          Flipcast converts a video you choose into other aspect ratios. The conversion runs in
          your browser on your own device; speed depends on that device, and very long or large
          files may not finish.
        </p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You keep all rights to your videos. Because they are never uploaded, we do not see,
          store or license them. You are responsible for having the right to use the footage
          you convert.
        </p>
      </section>

      <section>
        <h2>Plans and limits</h2>
        <ul>
          <li>Each plan includes a monthly allowance of source video seconds, reset each calendar month.</li>
          <li>Unused allowance does not roll over.</li>
          <li>A failed or cancelled render is refunded to your allowance.</li>
        </ul>
      </section>

      <section>
        <h2>Billing</h2>
        <ul>
          <li>Paid plans renew automatically, monthly or yearly, until cancelled.</li>
          <li>
            You can cancel any time from “Manage billing”. You keep your plan until the end of
            the period you have paid for, then return to the free tier.
          </li>
          <li>Plan changes are prorated by Stripe.</li>
          <li>
            If something went wrong with a charge, <ContactLine /> and we will make it right.
          </li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not use Flipcast to process content you have no right to, or try to get around plan
          limits or disrupt the service. We may suspend accounts that do.
        </p>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          Flipcast is provided as is. To the extent the law allows, our liability is limited to
          the amount you paid us in the twelve months before the claim.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We may update these terms. If a change is material we will tell you by email before it
          takes effect.
        </p>
      </section>
    </LegalPage>
  );
}
