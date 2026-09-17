# Plan: reducing/eliminating repeated Google sign-in

Status: **research complete, planning only — no code written.** Written in response to
the user asking whether the app can avoid requiring a Google sign-in every time it's
opened.

## Where things stand today

`src/sync/googleDriveClient.js` holds the OAuth access token in memory only — never
IndexedDB, never localStorage. This was a deliberate choice (see that file's own
header comment and `.work/feature-cloud-sync-plan.md`'s "why no backend" reasoning):
there's no server to hold a real refresh token, and a long-lived Drive-write credential
sitting in browser storage on a shared/lost device is a real risk this app chose not
to take on.

A prior session tried adding a *silent* reconnect (`prompt: ''`, no visible popup) on
boot, to at least avoid a click every session. It was reverted the same session:
confirmed directly (in headless Chromium) that a silent request which doesn't cleanly
resolve can leave Google's own client-library instance unable to open the
*interactive* popup afterward for the rest of that page's life — worse than the
problem it was solving. **That investigation was Chromium-only and never tested
against real Safari/iPad**, which turns out to matter a lot (see below).

## What the research found

### 1. `drive.file` doesn't require Google's app-verification process — do this regardless

Google classifies OAuth scopes into non-sensitive/"Recommended", "Sensitive", and
"Restricted" tiers. `https://www.googleapis.com/auth/drive.file` (the only scope this
app requests) is explicitly in the **non-sensitive/Recommended** tier — Google's own
migration guidance recommends *other* apps move off broader Drive scopes onto exactly
this one specifically because it skips the "restricted scope verification and
third-party security assessment" process.

Right now the OAuth consent screen is presumably still in **Testing** publishing
status (the default when a Client ID is first created). Testing status caps the app
at 100 named test users and — more relevant here — Google documents that *any*
Testing-mode authorization requesting a scope beyond basic profile/email is capped to
a 7-day authorization lifetime, and shows an "unverified app" interstitial ("Google
hasn't verified this app → Advanced → Go to [app] (unsafe)") on every consent screen.

Moving the consent screen to **In production** removes both, and — because
`drive.file` is non-sensitive — this is just a settings change in Google Cloud
Console (Publish App), not a submission-and-wait review process. This is a real,
no-downside improvement independent of the sign-in-frequency question: it removes an
extra tap from every reconnect and removes the 7-day/100-user Testing constraints.

**Recommendation: do this regardless of which path below is chosen.**

### 2. A real persistent refresh token needs a client secret somewhere — which needs either public JS (bad) or a backend

The only way to get a Google access token that renews itself indefinitely without any
user interaction is the standard OAuth **refresh token** — requested via the
Authorization Code flow with `access_type=offline&prompt=consent`, then exchanged at
Google's token endpoint.

The problem is *where that exchange can safely happen*. Google's token endpoint,
for a "Web application"-type OAuth client (what this app registered — see
`googleAuthConfig.js`), expects a `client_secret` on that exchange call. Google's own
docs frame this flow as being for "applications that can store confidential
information" — i.e., a server. The genuinely secretless (PKCE-only, public-client)
registration types Google supports are the native-app categories — Desktop, iOS,
Android, TV/limited-input — and every one of them depends on a redirect mechanism
(a localhost listener, a custom URI scheme, or device-code polling) that doesn't
exist for a plain web page opened in iPad Safari.

So concretely, the only two ways to get a real refresh token here are:

- **Embed the client secret in the shipped JS anyway.** Technically possible (people
  do this), but it defeats the point of a secret — anyone who opens dev tools or
  inspects the bundle gets a credential that mints Drive-write tokens for this app's
  identity indefinitely. Not recommended.
- **Stand up a minimal token-exchange endpoint** — a single stateless serverless
  function (e.g. one Cloudflare Worker / Vercel or Netlify function route), whose only
  job is: accept `{code, code_verifier}` from the browser, hold the one client secret
  server-side, call Google's token endpoint, hand `{access_token, refresh_token}`
  back to the browser. No database, no session state, nothing else — genuinely the
  smallest possible "backend," but it is a backend, which crosses the line Decision #5
  drew deliberately.

If a refresh token is obtained this way, it would then need to live *somewhere*
client-side to be useful across reloads — IndexedDB is the natural choice (same store
as everything else), but this is a real architectural upgrade from today's
memory-only token: it means a long-lived Drive-write credential now persists on
whatever device it's used on, which is exactly the risk profile this app has avoided
so far. Worth deciding deliberately, not by accident.

### 3. Silent (cookie-based) reconnect is documented to be broken on Safari specifically — the one browser that matters here

The `prompt: ''` silent-token trick (what was tried and reverted) works by having
Google's library check, via an invisible mechanism reading Google's own session
cookie **across origins** (from this app's origin to `accounts.google.com`), whether
the user is already signed into Google in that browser. This is architecturally the
same technique as legacy Google Sign-In's silent/One Tap auto-flow.

Multiple independent sources confirm this general technique is broken under Safari's
Intelligent Tracking Prevention (ITP), which has blocked **all** third-party cookies
by default since Safari 13.1 (~2020), with no exceptions and no user setting to
disable it per-site the way Chrome's cookie controls allow. Some documented ITP
behavior also expires any partial cross-site state on a rolling ~24-hour basis even
where a workaround exists. Google's own FedCM migration (fully mandatory since August
2025) exists specifically because this cookie-dependent pattern no longer works
across the industry — but FedCM's mandate is documented as applying to the Sign-In
library / One Tap (`google.accounts.id`), not confirmed to extend to the separate
OAuth2 **token client** (`google.accounts.oauth2.initTokenClient`) this app actually
uses for Drive API scopes — the two are different APIs under the same GIS umbrella,
and the token-client docs don't mention FedCM at all.

**What this means concretely**: the previous silent-reconnect attempt was tested and
broke only in headless Chromium — a browser where third-party cookies mostly still
work by default. It was never tried on real Safari/iPad, which is the one browser
that actually matters per this project's own User Context (iPad is the primary
device). There's a real, and on current evidence *likely*, chance that even a
carefully-rebuilt silent reconnect (fresh token-client instance per attempt, hard
timeout, etc. — fixing the specific bug found last time) would simply never succeed
on Safari, for reasons unrelated to that bug: ITP already blocks the cross-site cookie
read the whole technique depends on. If so, rebuilding it would cost real engineering
time for a feature that provides zero benefit on the one device it needs to help.

## Recommended plan

**Step 1 (do now, no research needed): flip the OAuth consent screen to "In
production" in Google Cloud Console.** Zero downside, no verification wait (per
finding #1), removes the unverified-app interstitial from every reconnect click.
This alone doesn't reduce *how often* you have to click Connect, but it makes each
click one step shorter.

**Step 2 (a short spike, before committing to any implementation): test whether GIS's
`prompt: ''` token request can succeed at all on real Safari/iPad**, given ITP. This
needs an actual device test, not more desk research — write a small standalone test
page (not part of the real app), connect once interactively, then attempt a bare
`requestAccessToken({prompt: ''})` call on a fresh page load on the real iPad, and
observe whether it silently succeeds, silently fails, or hangs. This answers the
load-bearing question before any real code changes are made to `googleDriveClient.js`.

- **If it can succeed on Safari**: proceed with rebuilding `trySilentConnect()`,
  scoped exactly as discussed before — fresh token-client instance per attempt (not
  the shared one that got stuck last time), a hard ~5s timeout, called once at boot,
  falling back to today's visible reconnect banner only on genuine failure. This
  gets "usually already connected when you open the app, occasional real login when
  the underlying Google session actually lapses" — the realistic ceiling for a
  no-backend design, not "never log in again."
- **If it can't succeed on Safari** (the likely outcome per the research above): stop
  there. Rebuilding silent reconnect would be effort spent on a feature that can't
  help the primary device. The honest answer at that point is that "don't log in
  every time" requires crossing into Step 3 below, or accepting today's one-click-per-
  session behavior (now shorter, per Step 1) as the final state.

**Step 3 (only if Step 2 rules out silent reconnect, and only if you decide it's worth
it): the minimal serverless token-exchange proxy**, to get a real, durable refresh
token. This is the only path that would actually deliver "open the app after being
away for weeks and it's still connected" — because refresh-token exchange is a direct
POST, not dependent on any browser cookie policy, so it works identically on Safari
and everywhere else. The real cost isn't hosting (a single free-tier serverless
function) — it's:
  - crossing Decision #5's "no backend" line, even though the function itself is
    tiny and stateless;
  - deciding where the resulting refresh token lives client-side (IndexedDB is the
    natural choice, but this is a genuine increase in the app's risk profile — a
    long-lived Drive-write credential now persists on-device rather than dying every
    reload);
  - a small one-time build: a `/token` (or similar) function, switching
    `googleDriveClient.js` from the token-client model to the Authorization Code +
    PKCE flow, handling refresh-on-401 client-side, and deciding what "disconnect"
    means now (revoke + delete the stored refresh token, not just clear memory).

This step was **not** scoped in detail (no file-by-file plan) since it's contingent
on Step 2's result and on you deciding the backend tradeoff is worth it — worth a
real design pass of its own if you get there.

## Open items for whoever picks this up

- Step 2's spike needs a real device test — can't be verified from this dev machine
  alone.
- If Step 3 is ever pursued, revisit whether `drive.file`'s scope non-sensitivity
  (finding #1) still holds for the Authorization Code flow the same way it does for
  the token-client flow used today — expected to be scope-based, not flow-based, but
  worth a final confirmation before building.
