/* lynxr — the public pages. One script, two of them:

     /            the marketing page. No form. All this file does there is
                  carry a ?ref= / ?utm_ campaign tag onto the "try it" link so
                  attribution survives the hop.
     /waitlist/   the form. Takes an email, writes it to Supabase, mirrors it
                  to a Google Sheet.

   Every wiring below is guarded on its element existing, which is what lets
   one file serve both pages — and what stops a missing element on one of them
   throwing before the other page's wiring has run.

   Neither app is mentioned on either page. Both live on unlisted paths handed
   out by invitation, and a link on a public page would undo that. A returning
   creator has the URL already; these pages do not need to help them. */

/* THE WHOLE FILE IS AN IIFE, AND THAT IS LOAD-BEARING — NOT STYLE.
   The merged landing page (Stage A, 2026-08-26) loads home.js AND creator.js
   as classic scripts on ONE document for the first time. Both declared
   top-level `const SB_URL` / `const SB_KEY`; the second declaration is an
   early SyntaxError that aborted ALL of creator.js before one statement ran —
   the hero composer and the gate simply never wired. Both also declare
   `say()`, which would not even error: the later declaration silently rebinds
   the earlier one's calls. Wrapping THIS file (248 lines, nothing outside it
   references any of its names — verified) rather than creator.js (7,600
   lines whose globals the verification harness uses) makes every top-level
   name here private and retires both collisions at once. Do not unwrap; do
   not add a new top-level declaration below outside the IIFE. */
(function () {


const SB_URL = "https://esakjfogplfszievvabi.supabase.co";
// Public by design — the repo is public. It is safe only because the waitlist
// policy grants INSERT and nothing else: no one can read the list back with it.
const SB_KEY = "sb_publishable_pTFNX2B94PE_DFLL799w4A_4VcH2xTN";

/* A convenience mirror of the waitlist into a Google Sheet, so signups show up
   somewhere you actually look instead of only in the Supabase dashboard.

   Paste the Apps Script /exec URL here — see supabase/waitlist-sheet.gs for the
   two-minute deploy. Left empty, the mirror is simply skipped and Supabase
   still gets every signup, so shipping this before the script is deployed
   breaks nothing.

   Sheet: docs.google.com/spreadsheets/d/1ypPfMkF6jpyQJ-9WCNoyjcjTenXrePhMz2uv96LjScY */
const WAITLIST_SHEET_URL =
  "https://script.google.com/macros/s/AKfycbyFGbycer3b7rH2FS-tzHGcYcX4ywQpBrWpVFkXaEzKHlUWDn82fnZhv5DddT4gGqjG/exec";

const $ = (id) => document.getElementById(id);

/* WHERE THE SIGNUP CAME FROM.

   `source` is a column the schema always had ("which page/campaign") that this
   page never filled in — every row said "landing", so the list could tell you
   how many people joined and never which link they came from.

   Order matters, most trustworthy first:

     1. ?ref=... — a tag YOU put on a link before sharing it. The only one that
        survives everywhere, because it's part of the URL rather than something
        the platform decides to pass along.
     2. ?utm_source=... — same idea, for links that already carry UTMs.
     3. The referring site's HOSTNAME, recorded as "ref:tiktok.com".
        Weak: TikTok and the Instagram in-app browser usually strip the
        referrer entirely, so treat a bare "landing" as "unknown", not "typed
        it in directly".

   Only the hostname is ever stored, never the full referring URL — that can
   carry search terms or private path segments, and none of it is our business.

   Read at load rather than at submit, so it reflects how the visitor actually
   arrived. */
const SOURCE_MAX = 40;

/** Keep it to a small, boring charset. Nothing renders this column, but it
    lands in a database and a spreadsheet, and neither wants surprises. */
function cleanSource(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9._:-]/g, "");
  return s.slice(0, SOURCE_MAX);
}

function signupSource() {
  try {
    const q = new URLSearchParams(location.search);
    const tagged = cleanSource(q.get("ref") || q.get("utm_source"));
    if (tagged) return tagged;

    if (document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^www\./, "");
      // Ignore our own pages — arriving from lynxr.io isn't a traffic source.
      if (host && host !== location.hostname) {
        const tag = cleanSource("ref:" + host);
        if (tag) return tag;
      }
    }
  } catch { /* a malformed URL or referrer is not worth failing a signup over */ }
  return "landing";
}

const SOURCE = signupSource();

/* WHAT THEY AGREED TO.
   Stored per signup, because the promise on the page has already been reworded
   more than once and "what did this person actually consent to" is answerable
   only if each row carries its own answer.

   A version TAG, not the sentence: the sentence is in index.html (.wait-sub)
   and in git history. Bump this whenever that promise changes MEANING — going
   from "we'll email you at launch" to anything broader is a new tag, and the
   old rows keep the narrower one they were given.

   Needs supabase/waitlist_consent.sql to have been run. Until then the column
   does not exist and PostgREST rejects the whole insert, so this is sent only
   when the column is confirmed present — see the retry in the submit handler. */
/* v2 (2026-08-17) widened the promise from "we'll notify you when we launch" to
   launch news PLUS occasional product updates. The tag changed with it, which
   is the whole point of having one: rows carrying launch-notify-v1 agreed to a
   single launch email and NOTHING else, so a product update may not be sent to
   them without asking first. Do not retro-fit v2 onto old rows. */
const CONSENT = "launch-and-updates-v2";

/** Fire-and-forget. Apps Script answers with a 302 the browser will not let us
    read, so this is mode:"no-cors" and its success cannot be confirmed from
    here — which is why it is never allowed to affect what the visitor sees.
    Supabase is the record; this is a copy. */
function mirrorToSheet(email) {
  if (!WAITLIST_SHEET_URL) return;
  try {
    fetch(WAITLIST_SHEET_URL, {
      method: "POST",
      mode: "no-cors",
      // text/plain keeps it a CORS "simple request" — a JSON content-type
      // would trigger a preflight that Apps Script does not answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ email, source: SOURCE, created_at: new Date().toISOString() }),
    }).catch(() => {});
  } catch { /* the signup is already in Supabase; the mirror is optional */ }
}

function say(text, kind) {
  const el = $("wait-msg");
  el.textContent = text;
  el.className = "wait-msg" + (kind ? " " + kind : "");
}

/* Deliberately loose. A regex that "properly" validates an address rejects
   real ones, and the cost of a typo here is one dead row — while the cost of
   turning away a real creator is the whole point of the page. */
const looksLikeEmail = (s) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s);

/* CARRYING A CAMPAIGN TAG ONTO EVERY LINK THAT NEEDS IT, on / only.

   The wait list is a separate page now, so a campaign tag put on the link that
   was shared — lynxr.io/?ref=tiktokbio — sits in the URL of the page BEFORE the
   form and would be dropped at the hop. Every signup would then read "landing",
   which is the exact blindness the source column was added to fix.

   Used to be one hard-coded element (#try-it, the old CTA). The merged home
   dropped that element and added a second link that needs the same treatment
   — the gate's seats-full fallback (#gate-full-link) — so this is now a loop
   over every element carrying data-carry-utm rather than a single lookup.

   Only the two keys signupSource() actually reads are carried (`ref`, and
   anything utm_*): forwarding the whole query string would drag arbitrary
   visitor-supplied junk onto our own URL for no gain. An existing key on the
   href always wins, so a hand-written link cannot be overridden by a query
   param. Failure on any one link must never break the others or the page —
   each is wrapped separately, and every plain href is a working navigation on
   its own with JS off entirely. */
for (const el of document.querySelectorAll("[data-carry-utm]")) {
  try {
    const from = new URLSearchParams(location.search);
    const to = new URL(el.getAttribute("href"), location.href);
    for (const [k, v] of from) {
      if ((k === "ref" || k.startsWith("utm_")) && !to.searchParams.has(k)) {
        to.searchParams.set(k, v);
      }
    }
    if (to.search) el.setAttribute("href", to.pathname + to.search);
  } catch { /* a malformed query is not worth breaking the only button on */ }
}

/* THE INTRO VIDEO (owner, 2026-11-13; plan ~/.claude/plans/landing-intro-video.md). index.html section#lp-intro,
   app.css .lp-intro-card. It plays ONCE, with sound where the browser allows it (SOUND FIRST, MUTED IF REFUSED, below), when
   half of it is on screen, then rests on its last frame; there
   is no loop, so it stops moving. An autoplay pauses when less than half is on screen and picks up again when it
   comes back. Once the visitor has played, paused or scrubbed it, it is theirs: it only pauses when the card is
   fully off screen (or hidden behind the sign-in card: #lp-main is display:none then) and never restarts by
   itself. Under reduced motion, Save-Data, or with no IntersectionObserver it never starts on its own; the poster
   waits with the big play button (preload="none", so nothing downloads until a press).
   Since 2026-11-13 the card is the FIRST screen (plan ~/.claude/plans/landing-video-first.md), so "half on screen" is
   the moment the page loads; a stored session skips autoplay too, and the one primary button (#lp-first-cta)
   shimmers only while the video is not playing. With no element (the
   waitlist page, or a signed-in visit, where enterApp() has removed #lp-main) nothing runs.
   LYNXR'S OWN LIGHT CONTROLS (owner, 2026-11-13: "Yes, light controls"). The browser's bar painted a near-black
   fade over the bottom of this tinted-white card (~40% of it on a phone), and Chromium ignored a click on the
   poster under reduced motion. `controls` stays in the HTML so the video still works if this script never runs;
   it comes off here, and the replacement is built in the same breath, so there is never a moment with neither.
   THE VIDEO DRIVES EVERY PAINTED STATE, NOT THE CLICK (the creator app's wireRefControls rule): play/pause/ended/
   timeupdate/volumechange write the classes and labels, because autoplay below also plays and pauses it.
   A press on any of these controls is the visitor's: it reaches the element as a play/pause/seeking event that
   autoplay did not cause (ours is false), so `theirs` flips exactly as it does for a native control. */
(function introVideo() {
  const v = document.getElementById("lp-intro-video");
  const card = v && v.closest(".lp-intro-card");
  if (!v || !card || !document.body.classList.contains("home")) return;
  v.muted = false;                                  // sound by default; the property (not the HTML attribute) is what plays
  const cta = document.getElementById("lp-first-cta");          // the page's one primary button (index.html)
  let ours = false;     // the next play/pause event is one this code caused
  let theirs = false;   // the visitor has touched it: autoplay keeps its hands off from here on
  let autoMuted = false;    // muted only because the browser refused sound before any press (SOUND FIRST, MUTED IF REFUSED)
  v.addEventListener("play", () => { if (ours) ours = false; else theirs = true; });
  v.addEventListener("pause", () => { if (ours) ours = false; else if (!v.ended) theirs = true; });
  v.addEventListener("seeking", () => { if (!ours) theirs = true; });
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- the controls. Built with DOM calls; the only markup strings are SVG paths (no style attributes: CSP). ---- */
  const svg = (cls, body, filled) => `<svg class="lpv-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${filled
    ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
  const PLAY = svg("i-play", '<path d="M8 5.5v13l10.5-6.5z"/>', true);
  const PAUSE = svg("i-pause", '<path d="M7 5h3.4v14H7zm6.6 0H17v14h-3.4z"/>', true);
  const AGAIN = svg("i-again", '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>', false);
  const button = (cls, html) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `lpv-btn ${cls}`; b.innerHTML = html;
    return b;
  };
  const big = button("lpv-big", PLAY);                            // the poster's one obvious target (Fitts)
  big.setAttribute("aria-label", "Play the video");
  const bar = document.createElement("div");
  bar.className = "lpv-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Video controls");
  const toggle = button("lpv-toggle", PLAY + PAUSE + AGAIN);
  const time = document.createElement("span");
  time.className = "lpv-time";
  const scrub = document.createElement("div");
  scrub.className = "lpv-scrub";
  /* The fill and the thumb move by TRANSFORM, not width/left: a moving box is a layout shift in Chromium's CLS
     (it logged one per frame) and a layout per frame; a transform is neither. */
  scrub.innerHTML = '<div class="lpv-rail" aria-hidden="true"><i class="lpv-fill"></i></div><i class="lpv-knob" aria-hidden="true"></i>';
  const fill = scrub.querySelector(".lpv-fill"), knob = scrub.querySelector(".lpv-knob");
  const place = (p) => {                                          // CSSOM, never a style="" attribute (CSP)
    p = Math.max(0, Math.min(1, p || 0));
    fill.style.transform = `scaleX(${p})`;
    knob.style.transform = `translateX(${p * 100}%)`;
  };
  const seek = document.createElement("input");
  seek.className = "lpv-seek"; seek.type = "range"; seek.min = "0"; seek.max = "1"; seek.step = "0.01"; seek.value = "0";
  seek.setAttribute("aria-label", "Seek through the video");
  scrub.append(seek);
  const sound = button("lpv-sound", svg("i-quiet", '<path d="M4 9v6h4l5 4V5L8 9H4zM17 10l4 4m0-4l-4 4"/>', false)
    + svg("i-loud", '<path d="M4 9v6h4l5 4V5L8 9H4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10"/>', false));
  sound.hidden = true;                                            // until the file proves it has an audio track
  const full = button("lpv-full", svg("i-in", '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', false)
    + svg("i-out", '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', false));
  bar.append(toggle, time, scrub, sound, full);
  card.append(big, bar);
  v.controls = false;
  v.tabIndex = -1;            // focusable by click/script (so Space/K work after a click on the frame), not a tab stop
  card.classList.add("lpv", "is-fresh", "is-shown");

  const dur = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  /* THE READOUT NEVER CHANGES WIDTH. This font's digits are not all one width, so "0:01" and "0:00" differ by a
     few px, which resized the slider beside it (another layout shift). Once the duration and the web font are
     known, the readout gets a min-width for its widest possible text: every digit as the font's widest digit.
     Measured with a canvas, so no layout is forced. */
  let timeFit = false;
  const fitTime = () => {
    if (timeFit || !dur() || (document.fonts && document.fonts.status !== "loaded")) return;
    const cs = getComputedStyle(time), ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in ctx && cs.letterSpacing !== "normal") ctx.letterSpacing = cs.letterSpacing;
    const wide = Math.max(...[..."0123456789"].map((n) => ctx.measureText(n).width));
    const tpl = `${clock(dur())} / ${clock(dur())}`;
    let w = 0;
    for (const ch of tpl) w += /\d/.test(ch) ? wide : ctx.measureText(ch).width;
    time.style.minWidth = `${Math.ceil(w) + 1}px`;
    timeFit = true;
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sync());
  let dragging = false;
  const sync = () => {                                            // the one writer of position: fill, readout, slider
    const d = dur(), t = Math.min(v.currentTime || 0, d || Infinity);
    card.classList.toggle("is-idle", !d);
    seek.disabled = !d;
    if (d && Number(seek.max) !== d) seek.max = String(d);
    place(d ? t / d : 0);
    fitTime();
    const label = d ? `${clock(t)} / ${clock(d)}` : clock(t);     // no duration yet: say only what is known
    if (time.textContent !== label) time.textContent = label;
    if (dragging || document.activeElement === seek) return;      // a focused slider is not re-announced 4x a second
    if (d) seek.value = String(t);
    const vt = d ? `${clock(t)} of ${clock(d)}` : `${clock(t)}`;
    if (seek.getAttribute("aria-valuetext") !== vt) seek.setAttribute("aria-valuetext", vt);
  };
  const keyFocus = () => !!card.querySelector(":focus-visible");  // keyboard focus holds the bar; a mouse click does not
  const paint = () => {                                           // play/pause/ended state, from the element itself
    const playing = !v.paused && !v.ended;
    const wasFresh = card.classList.contains("is-fresh");
    if (playing || v.currentTime > 0) card.classList.remove("is-fresh");
    card.classList.toggle("is-playing", playing);
    card.classList.toggle("is-ended", v.ended);
    if (cta) cta.classList.toggle("onb-shim", !playing);          // it moves only while the video does not (one thing moves at a time)
    const [lab, tip] = playing ? ["Pause the video", "Pause"] : v.ended ? ["Play the video again", "Play again"] : ["Play the video", "Play"];
    toggle.setAttribute("aria-label", lab); toggle.title = tip;
    if (!playing) show(false);                                    // paused or ended: the bar stays up
    else if (wasFresh && !card.matches(":hover") && !keyFocus()) card.classList.remove("is-shown");   // autoplay: no flash
    else hideSoon();
    tick();
  };
  let raf = 0;                                                    // a smooth fill while it plays and the bar is up
  const tick = () => {
    cancelAnimationFrame(raf);
    if (!v.paused && !v.ended && card.classList.contains("is-shown")) raf = requestAnimationFrame(() => { sync(); tick(); });
  };

  /* SHOW / HIDE. Up while paused, ended, focused inside or dragged; during playback it goes ~2 s after the
     pointer last moved over the card (or at once when the pointer leaves). Autoplay starting does not raise it:
     nothing should appear on the page because of a scroll. The fade is CSS, and off under reduced motion. */
  let hideTimer = 0;
  const show = (thenHide) => {
    clearTimeout(hideTimer);
    card.classList.add("is-shown");
    tick();
    if (thenHide) hideSoon();
  };
  const hideSoon = (ms = 2000) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (v.paused || v.ended || dragging || keyFocus()) return;
      card.classList.remove("is-shown");
    }, ms);
  };
  const playing = () => !v.paused && !v.ended;
  card.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(playing()); });
  card.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && playing()) hideSoon(0); });
  card.addEventListener("focusin", () => show(false));
  card.addEventListener("focusout", () => { if (playing()) hideSoon(); });

  /* SOUND ON, FROM THE START: the one way out of the browser's muted autoplay (SOUND below). Unmuted, back to 0:00 so
     the visitor hears it from the beginning, playing. Must run inside the visitor's press (the browser allows sound
     only then). Setting currentTime is a seek the visitor caused, so `theirs` flips and autoplay keeps its hands off. */
  const soundFromStart = () => {
    setAuto(false);
    v.muted = false;
    v.currentTime = 0;
    if (v.paused || v.ended) v.play().catch(() => {});
    show(playing());
  };
  const flip = () => {                                            // the visitor's play / pause / replay
    if (v.paused || v.ended) {
      if (autoMuted) { soundFromStart(); return; }                // a press to play a muted-by-the-browser video means "with sound"
      v.play().catch(() => {});                                   // refused: the poster and the play button stay
    } else v.pause();
  };
  big.addEventListener("click", () => { flip(); v.focus({ preventScroll: true }); });
  toggle.addEventListener("click", flip);
  /* A CLICK OR TAP ANYWHERE ON THE FRAME TOGGLES PLAY / PAUSE, like YouTube, on a desktop AND a phone (owner,
     2026-11-14: "when i tap it pauses like youtube"). It also brings the bar up so the new state shows (paused: the
     big play button and the bar stay; playing: the bar fades ~2 s later). ONE EXCEPTION: while it plays muted only
     because the browser refused sound, the first tap turns the sound on and starts it again from 0:00 instead of
     pausing (owner, 2026-11-14: "the launch video doesnt start with the audio, fix that so it plays with audio as
     default"), as YouTube and Instagram do with a muted autoplay. Every tap after that pauses / plays. */
  v.addEventListener("click", () => {
    if (autoMuted && playing()) { soundFromStart(); return; }
    flip(); show(playing());
  });
  seek.addEventListener("pointerdown", () => { dragging = true; show(false); });
  const endDrag = () => { if (!dragging) return; dragging = false; sync(); if (playing()) hideSoon(); };
  seek.addEventListener("pointerup", endDrag);
  seek.addEventListener("pointercancel", endDrag);
  seek.addEventListener("input", () => {
    const d = dur(); if (!d) return;
    v.currentTime = Math.min(Number(seek.value), d);
    place(Number(seek.value) / d);
    time.textContent = `${clock(Number(seek.value))} / ${clock(d)}`;
    seek.setAttribute("aria-valuetext", `${clock(Number(seek.value))} of ${clock(d)}`);
  });
  seek.addEventListener("blur", sync);
  /* Arrows move by a step a person can use (step="0.01" is for dragging): a tenth of the video, 1 s to 5 s.
     Home/End stay native. */
  seek.addEventListener("keydown", (e) => {
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    const d = dur();
    if (!dir || !d || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const t = Math.max(0, Math.min(d, v.currentTime + dir * Math.max(1, Math.min(5, d / 10))));
    v.currentTime = t; seek.value = String(t);
    seek.setAttribute("aria-valuetext", `${clock(t)} of ${clock(d)}`);
    show(playing());
  });
  /* KEYBOARD: Space and K toggle anywhere in the card, except that Space on a button presses that button
     (on the play button that is the same toggle; on full screen it must stay full screen). The slider keeps
     its native arrows / Home / End. */
  card.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== "k" && !(k === " " && !(e.target instanceof HTMLButtonElement))) return;
    e.preventDefault();
    flip();
    show(playing());
  });

  /* SOUND. The owner's launch video has its music track (2026-11-14) and index.html says so with data-audio="on",
     so the sound button is there from the first play. Without data-audio a silent file gets no volume button: the
     button appears by itself once the FILE says it has an audio track; it starts with sound on where the
     browser allows it (SOUND FIRST, MUTED IF REFUSED, below). data-audio="on"/"off" on the <video> overrides the sniffing if a browser ever guesses
     wrong. The sniff: Firefox mozHasAudio, Safari audioTracks.length (both known at loadedmetadata), Chromium
     webkitAudioDecodedByteCount > 0 (only known once some audio has decoded, so it is re-asked while playing and
     settled "silent" after a second of playback with nothing decoded). */
  let audio = v.dataset.audio === "on" ? true : v.dataset.audio === "off" ? false : null;
  const sniff = () => {
    if (audio !== null || v.readyState < 1) return;
    if (typeof v.mozHasAudio === "boolean") audio = v.mozHasAudio;
    else if (v.audioTracks && typeof v.audioTracks.length === "number") audio = v.audioTracks.length > 0;
    else if (typeof v.webkitAudioDecodedByteCount === "number") {
      if (v.webkitAudioDecodedByteCount > 0) audio = true;
      else if (v.currentTime > 1) audio = false;
    } else audio = false;
    if (audio !== null) { sound.hidden = !audio; card.classList.toggle("has-audio", audio); }
  };
  if (audio !== null) { sound.hidden = !audio; card.classList.toggle("has-audio", audio); }
  /* SOUND FIRST, MUTED IF REFUSED (owner, 2026-11-14: "autoplay with the audio and everything"). Autoplay asks for
     sound first (v.muted = false at the top). Browsers refuse sound before the visitor has pressed something
     (Chromium allows it for a site the visitor already watches a lot; Safari never), so on a refusal it plays
     MUTED instead (autoplay, below): the video never sits stopped because sound was refused. Only then
     (.is-automuted) a labelled "Turn sound on" pill sits in the card's top-right corner: static, no pulse, 44px tall
     (app.css .lpv-snd). A press turns the sound on AND starts the video again from 0:00, so the visitor hears it
     from the beginning, and the pill goes. The bar's sound button works as normal throughout, and the visitor's
     choice sticks. A first tap on the frame does the same as the pill (above), and so does the visitor's FIRST PRESS
     ANYWHERE ELSE ON THE PAGE (wake, below): sound comes on at the earliest moment any browser allows it. */
  const pill = document.createElement("button");
  pill.type = "button"; pill.className = "lpv-snd";
  pill.innerHTML = svg("i-quiet", '<path d="M4 9v6h4l5 4V5L8 9H4zM17 10l4 4m0-4l-4 4"/>', false) + "<span>Turn sound on</span>";
  card.append(pill);
  const setAuto = (on) => { autoMuted = on; card.classList.toggle("is-automuted", on); };
  const paintSound = () => {
    card.classList.toggle("is-muted", v.muted);
    sound.setAttribute("aria-label", v.muted ? "Turn the sound on" : "Turn the sound off");
    sound.title = v.muted ? "Sound on" : "Sound off";
    if (!v.muted && autoMuted) setAuto(false);                    // sound is on, however it got there: the pill goes
  };
  sound.addEventListener("click", () => { setAuto(false); v.muted = !v.muted; });   // the visitor's choice sticks
  pill.addEventListener("click", () => {
    soundFromStart();                                             // hear it from the beginning
    if (!sound.hidden) sound.focus({ preventScroll: true });     // the pill is gone; focus lands on the bar's sound button
  });
  /* THE FIRST PRESS ANYWHERE TURNS THE SOUND ON (owner, 2026-11-14: "fix that so it plays with audio as default").
     No page can start sound before the visitor has pressed something on it; that is the browser's rule, not ours. So
     while it plays muted for that reason, the visitor's first click, tap or key ANYWHERE on the page turns the sound
     on and starts it again from 0:00. pointerup / touchend because a touch only counts once the finger lifts; a
     scroll swipe never counts, and navigator.userActivation.isActive (where it exists) confirms the browser agrees,
     so a press it would refuse never unmutes (Chromium PAUSES a video unmuted without one). Left alone: presses
     inside the video card (its own handlers, above), presses that do something else (a link or button such as "get
     started" and "sign in", a form field, the sign-up card: no sound arriving under it), and Tab / Escape /
     shortcuts. Paused or ended (it played out muted, or it is off screen): the sound is simply on for the next play. */
  const wake = (e) => {
    if (!autoMuted) return;
    if (navigator.userActivation ? !navigator.userActivation.isActive : e.type === "touchend") return;
    if (e.type === "keydown" && (e.key === "Tab" || e.key === "Escape" || e.ctrlKey || e.metaKey || e.altKey)) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && (card.contains(t) || t.closest("a, button, input, select, textarea, label, summary, [contenteditable], [role='button'], [data-gate], #gate"))) return;
    if (playing()) soundFromStart();
    else { setAuto(false); v.muted = false; }
  };
  for (const ev of ["pointerup", "touchend", "keydown"]) document.addEventListener(ev, wake, { capture: true, passive: true });

  /* FULL SCREEN: THE CARD, not the <video>, so these controls come along. iPhone Safari has no element
     full screen, only webkitEnterFullscreen() on the video, which hands over to the system player and its own
     controls; it needs metadata, which exists by the time the bar (hidden until the first play) is reachable. */
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const elFS = !!(card.requestFullscreen || card.webkitRequestFullscreen) && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const vidFS = typeof v.webkitEnterFullscreen === "function";
  full.hidden = !(elFS || vidFS);
  full.addEventListener("click", () => {
    if (fsEl() === card) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (elFS) {
      const r = (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
      if (r && r.catch) r.catch(() => {});
    } else if (v.readyState >= 1) v.webkitEnterFullscreen();
  });
  const paintFull = () => {
    const on = fsEl() === card;
    card.classList.toggle("is-full", on);
    full.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    full.title = on ? "Exit full screen" : "Full screen";
  };
  document.addEventListener("fullscreenchange", paintFull);
  document.addEventListener("webkitfullscreenchange", paintFull);

  /* SLOW: a stall longer than half a second shows a quiet ring where the big button sits. */
  let waitTimer = 0;
  v.addEventListener("waiting", () => { clearTimeout(waitTimer); waitTimer = setTimeout(() => card.classList.add("is-waiting"), 500); });
  const unwait = () => { clearTimeout(waitTimer); card.classList.remove("is-waiting"); };
  for (const ev of ["playing", "pause", "ended", "seeked", "canplay"]) v.addEventListener(ev, unwait);

  for (const ev of ["play", "pause", "ended", "playing"]) v.addEventListener(ev, paint);
  for (const ev of ["timeupdate", "durationchange", "loadedmetadata", "seeked", "emptied"]) v.addEventListener(ev, sync);
  for (const ev of ["loadedmetadata", "loadeddata", "timeupdate", "playing"]) v.addEventListener(ev, sniff);
  v.addEventListener("volumechange", paintSound);
  paintSound(); paintFull(); sync(); paint();

  /* ---- autoplay: unchanged from the first build ---- */
  const thrifty = !!(navigator.connection && navigator.connection.saveData);
  let signedIn = false;                                          // a stored session: creator.js is taking the page into the app
  try { signedIn = !!localStorage.getItem("lynxr_creator_session"); } catch { /* storage blocked: treat as signed out */ }
  if (calm.matches || thrifty || signedIn || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((list) => {
    const en = list[list.length - 1];
    if (en.isIntersecting && en.intersectionRatio >= 0.5) {
      if (!theirs && v.paused && !v.ended && !document.hidden) {
        ours = true;
        v.play().catch((err) => {
          ours = false;
          /* Sound refused (NotAllowedError, no press on the page yet): the same play, muted, with the sound waiting
             for the first press. Anything else (an AbortError from a pause, or a refusal that was already muted:
             iOS Low Power Mode, a strict browser) leaves the poster and the play button. */
          if (!err || err.name !== "NotAllowedError" || v.muted || theirs || !v.paused || document.hidden) return;
          v.muted = true;
          setAuto(true);
          ours = true;
          v.play().catch(() => { ours = false; });
        });
      }
    } else if (!v.paused && (!theirs || !en.isIntersecting)) {
      ours = true;
      v.pause();
    }
  }, { threshold: [0, 0.5, 1] });
  io.observe(v);
  calm.addEventListener("change", () => {
    if (!calm.matches) return;
    io.disconnect();
    if (!v.paused && !theirs) { ours = true; v.pause(); }
  });
})();

/* THE CARDS' PICTURES MOVE WITH THE SCROLL: the FALLBACK (owner, 2026-11-14: "slight animations ... that relates to the
   scroll ... all displays possible"; app.css "THE CARDS' PICTURES MOVE WITH THE SCROLL"). A browser with CSS
   scroll-driven animations scrubs them natively and this does nothing. Without them, #lp-how gets .lp-scrub-js, which
   makes every moving piece a PAUSED 1 s CSS animation, and this script sets each one's currentTime (Web Animations API,
   no style attribute: CSP-safe) from its card's progress through the screen (0 = the card's top at the bottom of the
   screen, 1 = its bottom at the top: CSS's `cover` range), mapped through the piece's own --lpm-a / --lpm-b window.
   Passive scroll / scrollend / resize listeners feeding at most one rAF per frame, and only the cards an IntersectionObserver says
   are on screen are measured; a card that leaves is pinned at 0 (below) or 1 (above). Nothing runs while the page is
   still. Under reduced motion it stops (the cards are the static design: app.css gives the pieces no animation then)
   and starts again if reduced motion is switched back off. Without IntersectionObserver or element.getAnimations it
   never starts. */
(function cardScrub() {
  const how = document.getElementById("lp-how");
  if (!how || !document.body.classList.contains("home")) return;
  if (window.CSS && CSS.supports && CSS.supports("animation-timeline: view()")) return;   // native: CSS does it all
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  if (!("IntersectionObserver" in window) || typeof how.getAnimations !== "function") return;
  const cards = [...how.querySelectorAll(".lp-how-card")];
  const span = new WeakMap();                                     // animation -> [a, b], read once from its piece's CSS
  const windowOf = (anim) => {
    let w = span.get(anim);
    if (!w) {
      const fx = anim.effect, cs = getComputedStyle(fx.target, fx.pseudoElement || null);
      w = [parseFloat(cs.getPropertyValue("--lpm-a")) || 0, parseFloat(cs.getPropertyValue("--lpm-b")) || 1];
      span.set(anim, w);
    }
    return w;
  };
  const setCard = (card, p) => {
    for (const anim of card.getAnimations({ subtree: true })) {
      const [a, b] = windowOf(anim);
      anim.currentTime = Math.min(1, Math.max(0, (p - a) / (b - a))) * 1000;
    }
  };
  const live = new Set();
  let raf = 0;
  const paint = () => {
    raf = 0;
    const vh = innerHeight;
    for (const c of live) {
      const r = c.getBoundingClientRect();
      setCard(c, Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height))));
    }
  };
  const ask = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const io = new IntersectionObserver((list) => {
    for (const en of list) {
      if (en.isIntersecting) live.add(en.target);
      else { live.delete(en.target); setCard(en.target, en.boundingClientRect.top < 0 ? 1 : 0); }
    }
    ask();
  });
  const start = () => {                                           // the class first: it creates the paused animations
    how.classList.add("lp-scrub-js");
    for (const c of cards) io.observe(c);                         // observing reports every card once, so each gets set
    addEventListener("scroll", ask, { passive: true });
    addEventListener("scrollend", ask, { passive: true });        // where supported: one last measure where a smooth scroll lands
    addEventListener("resize", ask, { passive: true });
  };
  const stop = () => {
    io.disconnect(); live.clear();
    removeEventListener("scroll", ask);
    removeEventListener("scrollend", ask);
    removeEventListener("resize", ask);
    how.classList.remove("lp-scrub-js");
  };
  calm.addEventListener("change", () => (calm.matches ? stop() : start()));
  if (!calm.matches) start();
})();

if ($("wait-form")) $("wait-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("wait-email");
  const email = input.value.trim().toLowerCase();
  const btn = $("wait-go");

  if (!looksLikeEmail(email)) {
    say("that doesn't look like an email address.", "bad");
    input.focus();
    return;
  }

  btn.disabled = true;
  say("adding you…");
  try {
    const send = (row) => fetch(`${SB_URL}/rest/v1/lynxr_waitlist`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        "Content-Type": "application/json",
        // return=minimal because the policy allows INSERT and not SELECT, so
        // asking for the row back would fail a write that actually succeeded.
        //
        // And deliberately NOT resolution=merge-duplicates: that turns the
        // insert into an UPSERT, which Postgres checks against the UPDATE
        // policy as well — and there isn't one, by design, so every submission
        // came back "new row violates row-level security policy" even though
        // the insert itself was allowed. A repeat email is handled by letting
        // it 409 below, which is what we want anyway.
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });

    let res = await send({ email, source: SOURCE, consent: CONSENT });
    // PGRST204 is "column not found" — waitlist_consent.sql has not been run in
    // this project yet. PostgREST rejects the WHOLE insert when a payload names
    // a column that does not exist, so shipping the consent tag first would
    // have turned every signup into a failure. A real signup is worth more than
    // its consent tag, so drop the tag and keep the address. Narrow on purpose:
    // any other error still surfaces to the visitor below.
    if (!res.ok && res.status !== 409) {
      const why = await res.clone().text();
      if (why.includes("PGRST204")) res = await send({ email, source: SOURCE });
    }

    // 409 means the email is already on the list. That is a success from the
    // visitor's side, and saying "already there" would confirm to a stranger
    // which addresses have signed up.
    if (res.ok || res.status === 409) {
      // Only mirror a genuinely new signup. A 409 means they are already on
      // the list, and copying that to the sheet would add a duplicate row for
      // someone who simply submitted twice.
      if (res.ok) mirrorToSheet(email);
      $("wait-form").hidden = true;
      // The promise line goes with the form. Leaving "leave your email for
      // launch news" sitting above "you're on the list" reads as a submit that
      // did not take — the card has to end in ONE state, not two.
      if ($("wait-sub")) $("wait-sub").hidden = true;
      // Restates the promise rather than widening it. The confirmation is the
      // last thing they read, so it must not quietly enlarge the consent —
      // anything vaguer ("we'll be in touch", "expect news") would claim more
      // than the form above asked for.
      say("you're on the list. we'll update you about the launch.", "good");
      return;
    }
    // The table not existing is the one failure worth naming precisely — it is
    // a deployment step, not the visitor's problem, and it looks identical to
    // a network error from out here.
    const body = await res.text();
    if (body.includes("PGRST205")) {
      say("the waitlist isn't set up yet. try again shortly.", "bad");
    } else {
      say("that didn't send. try again in a moment.", "bad");
    }
  } catch {
    say("that didn't send — check your connection.", "bad");
  } finally {
    btn.disabled = false;
  }
});
})();
