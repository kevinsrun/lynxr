# Lynxr mobile · Make and Post

An iOS and Android Expo app for existing Lynxr creators. Sign in with email and password, paste a public TikTok video or Instagram reel, and open the original script and shots from the library. The library also reads existing brand scripts. This slice does not create rewrites, edit scripts, or publish videos.

## Run locally

Use Node 22.13+ and npm. From `mobile/`:

```sh
npm ci
npm test
npm run typecheck
cp .env.example .env.local
npm start
```

For a connected build, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to an **isolated development** Supabase project with synthetic accounts and the Lynxr schema. Without configuration, the app shows a setup message. The app only accepts an HTTPS origin and a Supabase publishable key. Expo exposes these values in the bundle; never supply an admin, service role, or secret key. To test the UI against a development project without incurring charges, have no worker connected and seed fixture rows for each status. No test command requires configuration.

## Existing contracts reused

| Concern | Verified in the repository | Mobile behavior |
| --- | --- | --- |
| Authentication | `creator.js` uses Supabase email/password and refresh tokens, with browser storage and separate web confirmation, recovery, and Google redirects. | Supabase JS maintains the same email/password account. The app stores the session as AES-GCM ciphertext in AsyncStorage, with its key in SecureStore (device only on iOS). Sign-out revokes this session and removes its local key and ciphertext. Foregrounding resumes token refresh. |
| Onboarding | `creator.js` writes profile and onboarding fields such as `name`, `priority`, `goal`, `setup` and `firstWin` in `lynxr_creators.data`. Social profile links and verification state are separate in `lynxr_profiles` (`supabase/profiles.sql`). The auth signup gate is separate. | Returning users skip onboarding. Queue writes preserve existing fields; no profile, signup or onboarding flags are written. |
| Queue | `ensureLibraryItem`, `queueAdaptation` and `save` in `creator.js` put a library item and a flat adaptation with `status: queued` in the creator row. There is no separate enqueue endpoint. A null `brandId` requests the original script. | Validate link shape, reuse the web canonical key and library ID, and submit one original script. Repeated pastes of the same canonical link reopen the existing job, including after a lost response or a failed job. |
| Worker and library | `worker.py` probes for queued entries and invokes `process_adaptations.py`. That process validates links, checks spend and allowance, stamps a running claim, reads/transcribes the source, and grafts results back by ID. Originals use `source.script.segments` and `source.shots`; rewrites use `adaptation.hook/beats/cta/caption`. | Map server `queued/running/done/error` to Queued, Processing, Completed, and Failed, with a separate indication for worker-scheduled retries. Read active adaptations from the signed-in creator’s row; trash and agency deliveries are outside this view. |
| Allowance | `allowance_ledger.sql` introduced the ledger; `billing.sql` resolves rolling and optional daily room through `my_allowance()`. The worker alone uses `charge_scripts` and `refund_script`. A prior charge is keyed by adaptation ID. | Read the authenticated RPC to display room and preflight new jobs. Missing RPC data blocks new submits. Retry eligible failures using their existing ID, leaving the ledger decision to the worker even at zero room. |
| Authorization | Creators and staff share Supabase Auth. `schema.sql` and `creator_tables.sql` restrict creator rows to `auth.uid() = id`. `staff_gate.sql` restricts agency data using `is_staff()`; CM access is narrower and separate. | Bind reads and writes to the signed-in user’s row. Protected routes and clearing UI on sign-out keep navigation scoped, while Supabase RLS is the authorization boundary. No agency or CM endpoints are called. |
| Edge Functions | `billing-checkout` and `billing-webhook` handle Stripe; `ig-thumb` handles covers; `insights-connect` handles social insights OAuth and worker token access. | None is on the script path. Mobile calls the existing Auth and Data APIs; it adds no DB, RPC, Edge Function or worker. |

The SQL changes in this repo live in standalone `supabase/*.sql` files; there is no `supabase/migrations/` directory. Confirm deployment parity in a disposable environment before rollout. Files in the repository cannot establish which SQL is applied in a hosted project.

## Tradeoffs and rollout gates

- **Shared row writes.** The app uses an owner- and `updated_at`-filtered update, rebuilding from a fresh row up to three times on conflicts. First save uses insert and retries on a duplicate key. This keeps mobile from overwriting a change it can detect. The existing web upsert and worker graft still replace the JSON document; a later write from a stale web or worker snapshot can clobber a mobile job or edit. Exercise mixed-client concurrency in an isolated project before rollout. If loss is reproducible, agree on an atomic append/update contract or a separate queue schema with the CTO before production use.
- **Foreground updates.** While work is active, the app polls the creator row about every eight seconds (30 seconds for scheduled retries), pauses when backgrounded, and refreshes on resume. The server continues processing if the app closes. There are no background tasks, push notifications, or automatic write retries after a network failure. After a lost response, submit the same link again to reconcile. The client does not follow short links to resolve cross-form duplicates or prove that a video is readable. Private/deleted media, platform fetch failures, long-video refusals, worker capacity and spend limits still apply.
- **Auth redirects.** Direct password sign-in needs no redirects. Signup, confirmation, recovery, and Google sign-in remain on the web; a Google-only account without a password cannot sign in here. Future native redirect work needs approved app links, a Supabase redirect allowlist, and physical-device verification of existing web links. Session revocation may require connectivity; sign-out reports a failure instead of assuming it completed.
- **Native verification.** On both platforms, use synthetic accounts to check first launch, invalid credentials, cold restart and token refresh after backgrounding, sign-out and back/deep-link navigation, paste/autofill and keyboard behavior, small displays and large text, VoiceOver/TalkBack, and session behavior after reinstall or device restore. Simulate network loss before and after submit and verify the same job reopens. Check concurrent web/worker saves and actual RLS in an isolated project before enabling real accounts. Bundle IDs are provisional until confirmed by the mobile owner.

See [Expo protected routes](https://docs.expo.dev/router/advanced/protected/), [Expo SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/), [Expo Crypto](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/) and [Supabase React Native auth](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native).

## Verification

`npm test` runs the real Supabase JS client against a fail-closed in-memory HTTP fixture. It covers password sign-in and rejection, restoring encrypted sessions and local sign-out, simulated row ownership, allowance gates, shared URL fixtures, queue creation and deduplication, conflict and save failure handling, worker state mapping, in-place retry, and both original and brand script display models. The fixture accepts only its reserved `.invalid` host and only the intended Auth, creator row, and allowance requests. No production API, paid APIs, or real script charges are involved. The ownership fixture tests client behavior; it does not execute the deployed RLS policies.

TypeScript and Metro exports verify that the project builds into JavaScript bundles for iOS and Android. Native session storage behavior and rendered screens have not been verified on a device.
