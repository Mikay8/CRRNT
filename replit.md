# CRRNT

See [README.md](./README.md) for the full stack, architecture, environment variables, and API reference — kept there as the single source of truth to avoid this file drifting out of sync again.

## Replit-specific notes

- `.replit` runs the API server via `uvicorn main:app --app-dir artifacts/api-server`.
- Production deployment is on Railway, not Replit — see `artifacts/api-server/schema.sql` for the database schema and the Railway project for live environment variables. Replit is used for local dev/preview only.

## Notes for contributors (human or agent)

- Never use `console.log`/`print` in backend code — use the `logging` module.
- Keep story ranking/scoring logic in `services/personalization.py`, not in routes.
- The app has no paid tier — don't reintroduce tier-gating without an explicit product decision.
