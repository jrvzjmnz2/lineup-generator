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
PORT=3000
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_EMAIL=admin@itemhound.com
SEED_ADMIN_PASSWORD=ChangeMe123!
```

**Important:** change `JWT_SECRET` and `SEED_ADMIN_PASSWORD` before real use, and make sure your current network's IP is allowed in Atlas (Network Access → IP Access List). If you host this app somewhere else later, that host's IP needs to be whitelisted too.

Create the first employee/admin account (the public registration form only ever creates marshal accounts):

```bash
npm run seed:admin
```

Start the app:

```bash
npm start
```

Then open `http://localhost:3000`.

- Marshals: register on the login page, then sign in and go to the sign-up form.
- Employee/admin: log in with the seeded admin account to reach Generate Event / Create List / All Events.

## How it works

- **Register / Login** (`index.html`) — Username, Email, Gender, Contact Number, First Name, Last Name, Password, Confirm Password. Stored in `lineup.login`. New sign-ups are always `marshal` accounts; admin accounts are provisioned with `npm run seed:admin`.
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

## A note on testing

This project was built in a cloud sandbox that could not reach your MongoDB Atlas cluster directly (its IP isn't in your Atlas allow-list, and it also has no route to download a local MongoDB binary for a sandboxed test run). Every file was syntax-checked, the server was verified to boot and wire up all routes correctly, and the logic was traced by hand end-to-end. Please run through `npm run seed:admin` → `npm start` → a real login/registration/event/assignment pass on your machine as the first real test, and let me know if anything misbehaves — happy to fix it fast.
