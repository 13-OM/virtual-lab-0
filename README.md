# Virtual Laboratory — MongoDB Atlas Edition

This version is designed for a hosted deployment such as Render.

## Architecture

```text
Student Browser ─┐
                  ├──► Render / Express API ───► MongoDB Atlas
Admin Browser ────┘
```

All browsers use the same server and the same MongoDB Atlas database. Student registrations, logins, practical progress and activity logs are therefore shared centrally instead of being stored in browser storage or Render's local filesystem.

## What is stored in MongoDB

The application uses four collections:

- `users` — admin and student accounts
- `practicals` — practical/lab content
- `progress` — each student's per-practical progress
- `activities` — registration, login, logout, completion and admin actions

MongoDB indexes enforce unique usernames, unique emails, unique practical numbers and one progress document per student/practical pair.

## Important deployment rule

Do **not** put the MongoDB connection string, database password or session secret in JavaScript, HTML, GitHub, or the frontend.

Use Render Environment Variables:

```text
NODE_ENV=production
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/virtual_laboratory?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DB=virtual_laboratory
SESSION_SECRET=<Render generated value>
```

`SESSION_SECRET` must be at least 32 characters in production. The included `render.yaml` asks Render to generate it automatically.

## MongoDB Atlas setup

1. Create/use the Atlas cluster.
2. Create a Database User with a strong password.
3. In Atlas **Network Access**, allow the Render application to connect. For initial development/testing, the Atlas IP access configuration may be broad; tighten it when your hosting/network setup supports a fixed allowlist.
4. Open **Database → Clusters → Connect → Drivers → Node.js**.
5. Copy the `mongodb+srv://...` connection string.
6. Replace the username/password placeholders and include the database name:

```text
mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster0.fntm9ob.mongodb.net/virtual_laboratory?retryWrites=true&w=majority&appName=Cluster0
```

7. Put that value in Render as `MONGODB_URI`.
8. Put `virtual_laboratory` in Render as `MONGODB_DB`.

If the MongoDB password contains characters such as `@`, `:`, `/`, `?`, `#`, `[`, `]`, or `%`, URL-encode the password before placing it in the URI.

## Render deployment

The repository contains `render.yaml` with:

```yaml
rootDir: virtual-lab
buildCommand: npm ci
startCommand: node server/seed.js && node server/server.js
```

The seeder runs once at startup and closes its MongoDB connection before the web server starts. It creates the default admin if needed and loads practical seed content without overwriting existing records unless `--force` is explicitly used.

### Environment variables in Render

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Your Atlas `mongodb+srv://...` URI |
| `MONGODB_DB` | `virtual_laboratory` |
| `SESSION_SECRET` | Let Render generate it |

After saving environment variables, deploy/redeploy the service.

## Existing JSON data migration

`data/vlab.json` is retained as a migration source for the existing project. On startup, if a MongoDB collection is empty, the server imports that collection's old JSON records into Atlas.

After confirming that the migration is complete and the Atlas collections contain the required data, the JSON runtime database should no longer be treated as the source of truth. MongoDB Atlas is the production database.

## Browser-to-browser test

1. Open the deployed Render URL in Chrome.
2. Register a new student.
3. Log in as that student and complete/save a practical.
4. Log out.
5. Open the same Render URL in Edge or an Incognito window.
6. Log in with the same student account.
7. Confirm that the account and progress are still present.
8. Log in as admin and open **Students** and **Activities**.
9. The same student registration/login/activity should appear there.

Changing browsers does not create another database. Both browsers write to the same MongoDB Atlas collections.

## Local development

```bash
npm install
```

Set environment variables before starting:

```bash
MONGODB_URI="mongodb+srv://USERNAME:PASSWORD@cluster0.example.mongodb.net/virtual_laboratory?retryWrites=true&w=majority&appName=Cluster0"
MONGODB_DB="virtual_laboratory"
SESSION_SECRET="a-local-secret-at-least-32-characters-long"
```

Then:

```bash
npm start
```

Open `http://localhost:8080`.

## Default seeded accounts

The seeder creates these only if they do not already exist:

- Admin: `admin` / `Admin@123`
- Demo student: `student` / `Student@123`

The default admin is marked to require a password change. Change the password before using the admin account normally.

## Security notes

- Passwords are stored as bcrypt hashes.
- Session cookies are HttpOnly and SameSite=Lax; production cookies also use Secure.
- CSRF tokens are required for authenticated state-changing requests.
- Server-side admin authorization is enforced on every admin endpoint.
- MongoDB credentials exist only in server environment variables.
- The frontend uses same-origin `/api/...` requests; do not deploy the frontend separately unless you intentionally add a different API base URL and cross-origin authentication configuration.
