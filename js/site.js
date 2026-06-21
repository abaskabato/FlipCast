// Fullscreen on first tap — feels like a real phone.
// Android Chrome: requestFullscreen() hides everything.
// iOS Safari: no Fullscreen API, but PWA standalone mode + meta tags hide chrome.
//             Also scrolls to 0,0 on touch to collapse the address bar.
// If the page is already in standalone mode (added to home screen), skip.

(function () {
    // Already standalone (added to home screen on iOS/Android)
    if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) return;

    function enterFS() {
        try { document.documentElement.requestFullscreen(); } catch (_) {}
        window.scrollTo(0, 0);
        document.removeEventListener('pointerdown', enterFS);
        document.removeEventListener('touchstart', enterFS);
    }

    // iOS: collapsing the URL bar on scroll requires a real scroll.
    // We do it on touchstart so the address bar collapses before the user sees anything.
    function collapseBar() {
        window.scrollTo(0, 0);
        document.removeEventListener('touchstart', collapseBar);
    }

    document.addEventListener('pointerdown', enterFS);
    document.addEventListener('touchstart', enterFS);
    document.addEventListener('touchstart', collapseBar);
})();

// ---------- newsletter signup ----------
(function () {
    const toggle = document.getElementById('newsletterToggle');
    const form = document.getElementById('newsletterForm');
    const input = form?.querySelector('.nl-input');
    if (!toggle || !form || !input) return;

    toggle.addEventListener('click', () => {
        const open = form.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        if (open) setTimeout(() => input.focus(), 250);
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        const nl = document.getElementById('newsletter');
        if (nl && !nl.contains(e.target)) {
            form.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = input.value.trim();
        if (!email) return;

        const btn = form.querySelector('.nl-submit');
        const orig = btn.textContent;
        btn.textContent = 'Sending…';
        btn.disabled = true;

        try {
            const res = await fetch('/api/newsletter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            if (!res.ok) throw new Error('Failed');
            const fb = document.createElement('p');
            fb.className = 'nl-feedback';
            fb.textContent = 'You\'re in. No spam, ever.';
            form.querySelector('.nl-hint')?.replaceWith(fb);
            input.value = '';
            input.style.display = 'none';
            btn.textContent = 'Done';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        } catch {
            btn.textContent = 'Try again';
            btn.disabled = false;
            input.focus();
        }
    });
})();
