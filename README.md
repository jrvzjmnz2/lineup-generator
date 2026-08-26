# Marshal Lineup System

A web app for building weekly event marshal lineups: marshals log in and submit which events/roles they're willing to work, and an employee (admin) drags them into role slots on an event card, then generates a shareable announcement.

## Stack

- Node.js + Express (API server)
- MongoDB (Atlas) via Mongoose — database `lineup`, collections `login` and `marshal`
- Plain HTML/CSS/JavaScript frontend (no build step) served statically by Express

## Setup

```bash
npm install
```

Edit `.env` (already pre-filled with the Atlas connection string you provided):

```
MONGO_URI=mongodb+srv://Admin:ADMIN@inventorymanagement.v2epjq4.mongodb.net/?appName=inventorymanagement
MONGO_DB_NAME=lineup
JWT_SECRET=change_this_to_a_long_random_secret_before_production
GOOGLE_CLIENT_ID=your_google_oauth_client_id
PORT=3000
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_EMAIL=admin@itemhound.com
SEED_ADMIN_PASSWORD=ChangeMe123!
```

**Important:** change `JWT_SECRET` and `SEED_ADMIN_PASSWORD` before real use, and make sure your current network's IP is allowed in Atlas (Network Access → IP Access List). If you host this app somewhere else later, that host's IP needs to be whitelisted too. `GOOGLE_CLIENT_ID` is required for marshal sign-in to work — see `DEPLOYMENT.md` for how to create one; if it's left blank the app still runs, the Google button just shows as unavailable.

Create the first employee/admin account (marshals sign up with Google now, so this is the only way to get an admin account):

```bash
npm run seed:admin
```

Start the app:

```bash
npm start
```

Then open `http://localhost:3000`.

- Marshals: sign in with Google on the login page. The first time, you'll be asked for your name and contact number, then it's straight to the sign-up form from then on.
- Employee/admin: click "Employee Login" on the login page and sign in with the seeded admin account to reach Generate Event / Create List / All Events.

## How it works

- **Login** (`index.html`) — marshals click "Continue with Google" and authenticate with their Google account (verified server-side, no password ever touches this app for them). A collapsed "Employee Login" section holds the username/password form used only by admin accounts, which are provisioned with `npm run seed:admin`. All accounts (Google or local) are stored in `lineup.login`.
- **Complete your profile** (`complete-profile.html`) — shown once, right after a marshal's first Google sign-in: First Name and Last Name (prefilled from Google, editable) and Contact Number. Until this is filled in, the marshal is redirected here instead of the sign-up form; after that they go straight to the sign-up form on every future login.
- **Marshal form** (`marshal.html`) — multi-select events (each shown with its date and location) + multi-select roles (Operator, Spotter, SLR, Split, Head Marshal, Tech Support, Kit Claiming Staff, Registration Staff). A disclosure notes that selecting an event is a preference, not a guaranteed spot. Submitting again overwrites the previous submission (one document per marshal, upserted by user id) in `lineup.marshal`. Submitting with **no events checked** is allowed — it means "take me out of consideration for everything," and also automatically un-assigns that marshal from any role slot they were already placed in on an active event in Create List.
- **Generate Event** (admin) — Event Name, Date, Location, Team Leader, Offsite Support, Categories, Gun Start (optional), Call Time, Max Runners, Meals, and +/- slot counts for all 8 roles (Operator, Spotter, Split, SLR, Head Marshal, Tech Support, Kit Claiming Staff, Registration Staff). "Add Event" makes it live in Create List and selectable on the marshal form immediately.
- **Create List** (admin) — one card per active event. Drag a marshal chip from the "Signed-up Marshals" pool into a role's drop zone. A marshal already placed on any other event is greyed out and un-draggable everywhere else (server-enforced too — a marshal can only hold one role, on one event, at a time). Once a completed event is marked complete (or deleted), any marshal placed on it becomes available everywhere else again automatically. Team Lead, Offsite Support, Categories, Call Time, Max Runners, Meals, and Gun Start stay editable at any time; each role's slot count also has its own +/- once the card exists. Once you start filling roles you can fill in Transportation, Driver, Contact Number, and Rate at the bottom. A marshal's name (in the pool and once assigned) is tinted from red to green based on their rating (see Marshal List below). "Generate Announcement" copies a plain-text version of the whole card (same layout as your sample) to the clipboard. "Complete Event" moves the card to All Events; "Delete Event" removes it permanently (with a confirmation first).
- **All Events** (admin) — read-only completed cards, with Generate Announcement still available, a Reopen button if you need to send one back to Create List, and Delete Event to permanently remove it.
- **Marshal List** (admin) — every marshal who has ever submitted the sign-up form, sorted alphabetically by name: contact info, the roles they said they're willing to fill, every event they've been assigned to (with role, date, and whether that event is still active or completed), and a 1–10 rating you set per marshal. The rating is what colors their name in Create List (green = high, red = low, unrated = no color) and persists across their own form resubmissions.

## Notes on a couple of judgment calls

Since this was built without back-and-forth on every detail, a few things I decided from context — flag if you want them changed:

- Added a small optional "note" field next to each assigned name (e.g. "5KM") purely so Generate Announcement can reproduce lines like your sample's "LEVINA MARIE LAPURA - 5KM" — leave it blank if you don't need it.
- "Complete Event"/"Reopen" only change where the card lives (Create List vs. All Events) and don't delete anything; "Delete Event" is the one destructive action and is permanent (with a browser confirm prompt) — it also removes that event's assignment history from Marshal List.
- The rating is one number per marshal (not per event) — it's meant as an overall read on that person, not a per-event score.
- If a marshal had an old password-based account from before this change and signs in with Google using the **same email address**, it links to that same account automatically (keeping their submission/attendance history) instead of creating a duplicate. If the emails don't match, they'll end up with a fresh account and lose their old history — worth a heads-up to your team if anyone's Google email differs from what they originally registered with.
- Employee/admin accounts are untouched by this change — they still log in with username + password via "Employee Login"; only marshal accounts moved to Google sign-in.

## A note on testing

This project was built in a cloud sandbox that could not reach your MongoDB Atlas cluster directly (its IP isn't in your Atlas allow-list, and it also has no route to download a local MongoDB binary for a sandboxed test run). Every file was syntax-checked, the server was verified to boot and wire up all routes correctly, and the logic was traced by hand end-to-end. Please run through `npm run seed:admin` → `npm start` → a real login/registration/event/assignment pass on your machine as the first real test, and let me know if anything misbehaves — happy to fix it fast.
