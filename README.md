<<<<<<< HEAD
# Orbit Operations

A responsive operations dashboard backed by a small Node.js HTTP API. The demo has working incident workflows, health checks, service-specific deployments, live metrics, and an activity log. Its infrastructure readings are simulated; it does not connect to a real cloud account.

## Run locally

Install Node.js 18 or newer, open this folder in a terminal, and run:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). The app and its API use the same server, so **VS Code Live Server is not the right way to run this version**. Use `npm start` instead. No packages need to be installed.

For automatic server restarts while editing, run `npm run dev`.

## Try the demo

- Create an incident and move it through **Investigating → Identified → Monitoring → Resolved**.
- Search and filter incidents.
- Use **Check now** to refresh simulated service response times.
- Use **Deploy** beside a service to update its version, deployment count, and activity.
- Expand the activity log and refresh the page; server data is saved in `data/dashboard.json`.

To reset the demo, stop the server and delete `data/dashboard.json`; the next start recreates the sample data.

## API

- `GET /api/health` — server readiness
- `GET /api/dashboard` — metrics, incidents, services, and activity
- `GET /api/services` — service status
- `POST /api/services/check` — run simulated health checks
- `POST /api/services/:id/deploy` — record a demo deployment
- `POST /api/incidents` — create an incident
- `PATCH /api/incidents/:id` — advance an incident to its next status

## Deployment

Deploy to a Node.js host, set its `PORT` environment variable if needed, and run `npm start`. The process binds to `0.0.0.0`. This is an interview/demo app, not a production-secured control plane: add authentication/authorization, managed storage, and real provider integrations before exposing it publicly or connecting it to infrastructure.
=======
# Operation_dashboard
>>>>>>> da96d9459a0fb045abc049e49358a4f89e21633d
