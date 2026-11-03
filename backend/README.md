# Balaghi API

Express API for Balaghi. Citizens sign in with phone OTP. Municipality staff and field workers sign in to the dashboard with username and password; `public.profiles.role` controls access to each route. Supabase Auth checks their passwords through an internal email identity that is never requested in the dashboard or returned as a `user` field. The email may still be visible inside the Supabase access token, so it must not be treated as a secret. The backend holds the database and Storage credentials, while clients receive only their own Supabase session tokens.

## Set up hosted Supabase

1. Create a Supabase project and enable Phone authentication for citizens and Email authentication for staff. Real SMS delivery needs a configured provider. For free local development, use the separate setup below instead; it uses the [official `auth.sms.test_otp` setting](https://supabase.com/docs/guides/local-development/cli/config) and the [native runtime](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes) in Ubuntu WSL without Docker.
2. Run [`docs/ERD.sql`](../docs/ERD.sql) in the Supabase SQL editor. It creates the current application tables, including organization assignments, field reviews, and work completion reviews, and blocks direct client access to them. Use a fresh project for this schema; the old `users` table is not migrated automatically. The upgrade migrations below are for existing databases and are not needed after this full schema.
   If an existing project already has the previous schema, run [`migrations/20261014_report_approval.sql`](migrations/20261014_report_approval.sql) instead to add the approval fields. Existing public reports stay visible; new reports wait for review.
3. Create a **private** Storage bucket named `report-images`. Limit uploads to JPG/PNG and 5 MB. The API also validates and re-encodes each image before upload.
4. Copy `.env.example` to `.env`, then set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` from your Supabase project. The database connection string and secret key must stay on the server. Use the connection string offered by Supabase for your deployment network.

## Free local Supabase on this computer

The local stack is already configured in `supabase/config.toml`. It creates the application tables from `supabase/migrations/20261014000000_initial_schema.sql` and a private `report-images` bucket. The native runtime and Supabase CLI have been installed in Ubuntu WSL on this computer. The first start on another computer needs the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed in Ubuntu and internet access for service downloads. The native runtime is currently experimental. Keep the local `config.toml` test provider settings out of hosted configuration pushes.

In the VS Code terminal, start the local services and backend in this order:

```powershell
cd backend
npm ci
npm run supabase:start:local
npm run configure:local
npm run dev:local
```

`configure:local` writes ignored `backend/.env.local` using only the local stack's keys. It never changes the cloud `backend/.env`. The local Studio is at `http://127.0.0.1:54323`. Use phone **`0912345678`** and OTP **`123456`** in the Flutter app. This maps to the test number `+218912345678`; no SMS is sent and other numbers are not configured for local testing. These fixed credentials are for local development only and do not verify ownership of a real phone. To stop the local stack later, run `npm run supabase:stop:local` from `backend` after stopping the API.

The local API is at `http://127.0.0.1:5000`. Launch Flutter with `BALAGHI_AUTH_PREVIEW=false` and `BALAGHI_DEMO_MAP=false` as described in [`mobile/README.md`](../mobile/README.md). A newly submitted report appears in My Reports but is hidden from the public map until staff approval. The existing cloud setup below remains available through `npm run dev`.

To see local counts and sizes without opening Studio, run `npm run usage:local` from `backend` while Supabase is running. This reports profile and report counts, image file size, and PostgreSQL database size; it is separate from hosted Supabase quota usage.

## Run

```powershell
cd backend
npm ci
npm run dev
```

The health route is `GET /`. API routes are described in [`docs/API.md`](../docs/API.md). After OTP verification, call `PATCH /api/auth/me` with `full_name` for a new citizen. Use the returned access token in `Authorization: Bearer <token>`. Clients can call `POST /api/auth/refresh` with their refresh token when the access token expires; replace the stored refresh token with the new one in its response.

New citizen reports stay private until staff review them. Staff can list pending reports with `GET /api/reports/staff?review=pending`, approve one with `PATCH /api/reports/:id/approve`, or reject it via `PATCH /api/reports/:id/status` with `{"status":"rejected","reason":"..."}`. Only approved, non-rejected reports appear on the public map. The citizen can still see a pending report in My Reports.

Before approval, staff may optionally request an on-site verification from the organization responsible for the report category. The report remains private. A worker in that organization claims the verification task and returns a result and note; staff alone decides whether to approve or reject. An open verification blocks either decision until the worker responds or staff cancels it. Citizen-facing status remains "awaiting review". No extra worker photo is required. Staff may correct the category before approval. Approval automatically assigns the report to its category's organization: `public_services` for garbage, `water_sewer` for leaks, and `roads_maintenance` for potholes. A worker whose profile belongs to that organization sees its unclaimed reports, claims one with their own account, then confirms actual work start. The first claim wins; another worker cannot claim the same report. Claiming does not change the citizen-facing status. Start changes it to `in_progress` and records the worker and time. Apply [`migrations/20261016_field_assignments.sql`](migrations/20261016_field_assignments.sql), [`migrations/20261017_field_issue_reviews.sql`](migrations/20261017_field_issue_reviews.sql), [`migrations/20261018_work_agencies.sql`](migrations/20261018_work_agencies.sql), [`migrations/20261019_preapproval_verifications.sql`](migrations/20261019_preapproval_verifications.sql), [`migrations/20261020_auto_agency_assignment.sql`](migrations/20261020_auto_agency_assignment.sql), [`migrations/20261021_work_completion_reviews.sql`](migrations/20261021_work_completion_reviews.sql), then [`migrations/20261022_completion_evidence.sql`](migrations/20261022_completion_evidence.sql) to an existing hosted database. Local Supabase uses matching migrations in `supabase/migrations`.

An assigned worker can raise a field concern with a reason and written note; no extra photo is required for that concern. The report pauses and is temporarily hidden from the public map until staff decides to continue it, correct its map location, or reject it with a citizen-facing reason. The concern and decision remain in an internal audit record. Once work has started, the assigned worker submits a completion request with a required after-repair photo and an optional note. The browser also attempts to capture its location and accuracy; these coordinates are optional because permission or secure-context restrictions may prevent access. The server re-encodes the photo without metadata and saves it in private Storage. Staff compare it with the original report image, then confirm the solution or return the report to work with a required reason. The public report stays `in_progress` until confirmation; only then does it become `resolved`. For an existing local database, run `npm run migrate:field:local`, `npm run migrate:field-review:local`, `npm run migrate:agency:local`, `npm run migrate:verification:local`, `npm run migrate:auto-assignment:local`, `npm run migrate:completion:local`, and `npm run migrate:completion-photo:local` in that order; these have already been applied on the development computer.

For a **local-only demo** worker account, run `npm run worker:create:local` after the migrations. It creates username `field1` in `roads_maintenance`, generates a one-time password printed in the terminal, and stores its internal Auth email only on the server. To create workers for the other organizations, run `npm run worker:create:local -- fieldwater "عامل المياه" water_sewer` or `npm run worker:create:local -- fieldwaste "عامل الخدمات" public_services`. The scripts refuse non-local Supabase URLs. Keep each real worker's account individual; do not share the demo password in production.

## Administrator and dashboard accounts

Dashboard accounts have three roles: `staff`, `field_worker`, and `admin`. Every administrator has all staff permissions. It cannot use field-worker routes, so one person cannot both submit finished work and confirm it.

Administrators come in two kinds:

- **Owners** (`profiles.is_owner = true`) hold every administrative permission and are the only accounts that manage other administrators: create them, deactivate them, choose their permissions, and reset their passwords. Owners are created only by the server script. The dashboard and API can neither grant nor remove owner status, and no one can edit or deactivate an owner from the dashboard. Another owner can still reset an owner's forgotten password.
- **Regular administrators** hold only the permissions an owner grants in `profiles.admin_permissions`: `manage_staff`, `manage_workers`, `manage_citizens`, `view_audit`. Each `manage_*` permission covers creating, editing, deactivating, and resetting passwords for that kind of account. A regular administrator cannot grant permissions, raise their own, or touch administrator accounts.

The API checks the permission on every `/api/admin` request. Permission changes take effect on the next request and are recorded in the audit log.

**Schema.** A new hosted database already gets everything from [`docs/ERD.sql`](../docs/ERD.sql). For an existing hosted database, run [`migrations/20261023_admin_role.sql`](migrations/20261023_admin_role.sql) and then [`migrations/20261023_admin_accounts.sql`](migrations/20261023_admin_accounts.sql) as two separate runs: PostgreSQL cannot use a new enum value in the transaction that adds it. For an existing local database, run `npm run migrate:admin:local` once. Then run `npm run migrate:field-decisions:local` (hosted: `migrations/20261102_field_review_decisions.sql`), which drops the unused `reassign` field-review decision unless old rows use it.

**Owners.** No API grants a role, so create owners from the server. Create two, so one can reset the other's password:

```powershell
npm run admin:create:local -- admin1 "اسم المسؤول"   # local Supabase (.env.local)
npm run admin:create -- admin1 "اسم المسؤول"         # hosted Supabase (.env)
```

The script prints a temporary password once. At first sign-in, the dashboard requires a new password before anything else. Running the admin migration also turns administrators created earlier by this script into owners.

**Everyone else** is created in the dashboard under «الموظفون والعمال», by an administrator with the matching permission (owners for administrators). The server creates the Supabase Auth user with the internal email `username@STAFF_EMAIL_DOMAIN` (default `balaghi.local`, set in `.env`) and a random temporary password, shown once to the administrator. The owner must replace it at first sign-in and after every reset. The server refuses all other routes until then. Passwords live only in Supabase Auth; administrators never learn the final password but see when it last changed. Staff who forget their password ask an administrator to reset it; there is no self-service recovery because the internal email does not receive mail.

**Deactivation instead of deletion.** Deactivating a staff, worker, or citizen account sets `profiles.is_active = false`, which the API checks on every request, and bans the user in Supabase Auth. Reports and history stay intact. Deactivating a field worker, or changing a worker's role or agency, returns claimed but unstarted reports and claimed pre-approval checks to the agency queue. A role or agency change is refused while the worker has reports in progress. Deactivation is allowed, and the response reports how many in-progress reports remain assigned to that worker. Staff move such a report back to its agency's queue from the report's details («إعادة إلى قائمة الجهة», `PATCH /api/reports/:id/release` with a reason); its public status returns from in progress to new until another worker starts. No one can change their own role or deactivate themselves, and owners cannot be deactivated from the dashboard, so an active owner always remains. Suspending a citizen requires a reason; the app then shows that the account is suspended.

Every administrative action and password change is recorded in `public.admin_audit_log` and shown under «سجل الإجراءات».

The older local-only `npm run worker:create:local` still works for quick demo workers. Accounts created by SQL as described in earlier versions keep working; new accounts should come from the dashboard.

## Deploy

The local setup uses HTTP, a fixed test OTP and an in-memory rate limiter. Before real users:

1. **HTTPS.** Serve the API and the dashboard over HTTPS only, for example behind nginx, Caddy or a hosting platform. The API sends HSTS when it sees an HTTPS request. Behind a proxy, set `TRUST_PROXY=1` so the rate limits count each visitor's address instead of the proxy's.
2. **CORS.** Set `CORS_ORIGINS` to the dashboard's exact origin (for example `https://dashboard.example.ly`). With `NODE_ENV=production` and no origins, the API warns at start. The Flutter app does not need CORS.
3. **Supabase.** Use a hosted project with the full schema from `docs/ERD.sql`, a private `report-images` bucket, phone sign-in through a real SMS provider, and no `test_otp` numbers. Keep `SUPABASE_SECRET_KEY` and `DATABASE_URL` only in the server's environment.
4. **Dashboard.** Build with `VITE_API_BASE_URL=https://api.example.ly/api npm run build` and serve `dashboard/dist` as static files. Every unknown path must return `index.html`.
5. **Citizen app.** Build a release APK with `--dart-define=BALAGHI_API_BASE_URL=https://api.example.ly/api`. Release builds refuse plain HTTP, which is intended.
6. **Accounts.** Create owners with `npm run admin:create`, and give each employee their own account.
7. **Rate limits.** They are kept in the memory of one API process. If you run several instances, add a limit at the proxy as well.

Every response carries `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a restrictive `Content-Security-Policy`. The API only answers JSON and images.

## Sign-in codes by SMS (Resala)

Supabase makes and checks every citizen sign-in code. With its **Send SMS hook** it posts the code to `POST /api/auth/sms-hook` instead of texting it, and the API sends it through [Resala](https://resala.ly). The app and the sign-in flow do not change. Supabase test numbers keep working without any SMS.

1. **Resala template.** In Resala > Message templates, create one such as `رمز الدخول إلى بلاغي: $1` and wait until it is APPROVED. Copy its id. Resala sends free text only through approved templates.
2. **Supabase hook.** In Supabase > Authentication > Hooks, add a *Send SMS* hook of type HTTPS with the URL `https://<your-api>/api/auth/sms-hook`, generate its secret, and save.
3. **API settings** (on Render: Environment): `RESALA_API_KEY` (starts with `rsl_`), `RESALA_TEMPLATE_ID`, `SMS_HOOK_SECRET` (the `v1,whsec_...` value), and optionally `RESALA_SENDER`. Start with `RESALA_TEST=true` (Resala's sandbox: nothing is sent or charged), then remove it.

The hook checks Supabase's signature and refuses requests older than five minutes. It accepts Libyan mobiles only (091 to 094), never retries a failed send, and never logs the code; the log shows `Sign-in code sent to 2189****5678` or why it was not sent. If the Resala balance runs out the log says so, and the citizen sees that the code could not be sent.

## Street names

After a report is saved, and after a staff member corrects its location, the API looks up the street and area in Arabic from OpenStreetMap's Nominatim service and stores it in `address_text` (for example «شارع السيدي، محلة الظهرة»). The citizen gets the response first; a failed or empty lookup leaves the coordinates on screen. Lookups are one per second, as the service asks, and send only the coordinates.

- `GEOCODER=off` turns lookups off, for example offline.
- `GEOCODER_URL` points at another Nominatim server; `GEOCODER_USER_AGENT` names the app in each request.
- `npm run addresses:backfill:local` (or `addresses:backfill` with `.env`) fills reports saved without a street name; it is safe to run again.

The server needs internet access for this. Without it, every screen shows the coordinates as before.

## Check

```powershell
npm test
```

The automated tests use local fakes for Supabase and PostgreSQL.

`npm run test:integration` runs the real routes against the real local schema while local Supabase is running: a report from submission to resolution, returning a held report to its agency, field concerns, owners and permissions, and the constraints that must refuse bad writes. Each test runs inside one transaction that is rolled back, so local data stays as it was; report numbers may skip ahead because identity sequences never roll back. The script refuses any database that is not on `localhost`. The free local stack also supports end-to-end checks of citizen OTP, Storage, and SQL. The Flutter app is in [`mobile`](../mobile), and the staff dashboard is in [`dashboard`](../dashboard/README.md).
