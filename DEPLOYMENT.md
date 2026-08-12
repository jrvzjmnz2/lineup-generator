# Deploying to Render

This app is a single Node/Express service (it serves the frontend statically too), so it deploys as one Render **Web Service** — no separate static site or build step needed.

## 1. Get the code into a Git repo

Render deploys from a Git repository (GitHub, GitLab, or Bitbucket) — it doesn't accept a direct file/zip upload for web services. From your `lineup-generator` folder, in your own terminal:

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create an empty repo on GitHub (or GitLab) and push:

```bash
git remote add origin https://github.com/<your-username>/lineup-generator.git
git branch -M main
git push -u origin main
```

`.env` is already in `.gitignore`, so your real Atlas credentials and JWT secret never get committed — only `.env.example` (a safe template) does.

## 2. Whitelist Render's traffic in MongoDB Atlas

Render's free/starter web services don't have a fixed outbound IP, so the simplest option is: in Atlas → your project → **Network Access** → **Add IP Address** → allow `0.0.0.0/0` (access from anywhere). That's the standard approach for apps hosted on platforms without a static egress IP — your data is still protected by the database username/password, so keep those strong.

If you'd rather not open it to all IPs, Render does offer a paid **Static Outbound IP** add-on; if you enable that, whitelist those specific IPs in Atlas instead.

## 3. Create the Render service

**Option A — one-click Blueprint (recommended):** this repo includes `render.yaml`. In the Render dashboard: **New +** → **Blueprint** → connect your repo → Render reads `render.yaml` and proposes the service → **Apply**.

**Option B — manual:** **New +** → **Web Service** → connect your repo → set:
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

## 4. Set environment variables

Whichever option you used, go to the service's **Environment** tab and set these (values from your own `.env` / Atlas — never commit them):

| Key | Value |
|---|---|
| `MONGO_URI` | your Atlas connection string |
| `MONGO_DB_NAME` | `lineup` |
| `JWT_SECRET` | a long random string — generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SEED_ADMIN_USERNAME` | e.g. `admin` |
| `SEED_ADMIN_EMAIL` | e.g. `admin@itemhound.com` |
| `SEED_ADMIN_PASSWORD` | a real password you'll actually use to log in |

(If you used the Blueprint, most of these are already listed as placeholders for you to fill in — `MONGO_DB_NAME` and `DNS_SERVERS` are pre-filled.)

Do **not** set `PORT` — Render assigns it automatically and the app already reads `process.env.PORT`.

## 5. Deploy, then create the first admin account

Click **Deploy** (or it deploys automatically after the Blueprint is applied). Once the deploy is live:

1. Open the service → **Shell** tab (Render's built-in one-off command runner).
2. Run: `npm run seed:admin`
3. Log in at your Render URL with the admin username/password you set in step 4.

You only need to run `seed:admin` once — re-running it just updates that same admin account (it upserts by username).

## 6. Redeploys

Render auto-deploys on every push to the branch you connected (`main` by default). Just `git push` your changes and it rebuilds automatically — no server access needed for routine updates.

## A note on the free plan

Render's free web services spin down after periods of inactivity and take a few seconds to wake up on the next request — fine for an internal tool used a few times a week, just don't expect an always-instant first load. Upgrade to a paid plan if you want it always-on.
