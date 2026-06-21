// FLIPCAST Newsletter signup — Vercel serverless function.
//
// Backed by Buttondown (https://buttondown.com) — has a free tier and a
// single-key API, so there's nothing to maintain here.
//
// To go live:
//   1. Make a free account at https://buttondown.com
//   2. Copy your API key from https://buttondown.com/settings/programming
//   3. In Vercel → Project → Settings → Environment Variables, add:
//        BUTTONDOWN_API_KEY = <your key>
//   4. Redeploy. That's it — no code change needed.
//
// Until the key is set, signups are just logged (and still report success),
// so the form keeps working in local dev and before launch.

const BUTTONDOWN_URL = 'https://api.buttondown.com/v1/subscribers';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
    }

    const key = process.env.BUTTONDOWN_API_KEY;

    // No provider configured yet — log and succeed so the form still works.
    if (!key) {
        console.log('[newsletter] (no provider) would subscribe:', email);
        return res.status(200).json({ ok: true });
    }

    try {
        const bd = await fetch(BUTTONDOWN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Token ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email_address: email,
                tags: ['flipcast'],
            }),
        });

        // 201 = created. 400 most commonly means "already subscribed" —
        // treat that as success so we don't leak who's on the list or
        // bounce a returning visitor.
        if (bd.status === 201 || bd.status === 400) {
            return res.status(200).json({ ok: true });
        }

        const detail = await bd.text();
        console.error('[newsletter] buttondown error', bd.status, detail);
        return res.status(502).json({ error: 'Subscription failed' });
    } catch (err) {
        console.error('[newsletter] request failed', err);
        return res.status(502).json({ error: 'Subscription failed' });
    }
}
