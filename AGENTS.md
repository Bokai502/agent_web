# Repository Guidelines

## Project Structure & Module Organization

This repository is a Codex engineering workspace with a React/Vite frontend and a Fastify TypeScript backend. Backend source lives in `backend/src`, grouped by feature areas such as `codex-run`, `workspaces`, `manifests`, `system`, and `server`. Frontend source lives in `frontend/src`, with pages in `frontend/src/pages`, reusable components in `frontend/src/components`, hooks in `frontend/src/hooks`, and app utilities in `frontend/src/app`. Tests are colocated with source as `*.test.ts` or `*.test.tsx`. Workflow skills, agent assets, and domain scripts live under `backend/workflow_agents`; sample data and media live in `docs`.

## Build, Test, and Development Commands

Install dependencies separately:

```bash
cd backend && npm install
cd ../frontend && npm install
```

Run the full local stack with `./start_open_codex_web.sh`; it reads `config.json`, starts backend and frontend tmux sessions, and uses ports from configuration. For manual development, use `cd backend && npm run dev` for the Fastify server and `cd frontend && npm run dev:https` for the Vite app. Build checks are `npm run build` in both `backend` and `frontend`. Frontend quality checks are `cd frontend && npm run lint` and `npm test`.

## Coding Style & Naming Conventions

Use TypeScript ES modules throughout. Follow the existing style: two-space indentation, semicolons, descriptive camelCase identifiers, PascalCase React components, and feature-oriented filenames such as `workspace.routes.ts` or `RunLogPanel.tsx`. Keep route registration, storage, and UI concerns in their existing feature folders. Frontend linting is configured with ESLint 9, TypeScript ESLint, React Hooks, and React Refresh.

## Testing Guidelines

Frontend tests use Vitest with Testing Library and jsdom. Name tests `*.test.ts` or `*.test.tsx` beside the code they cover, as in `frontend/src/components/bomData.test.ts`. Run `cd frontend && npm test` before submitting UI or shared utility changes. Backend currently has build validation but no dedicated test script, so run `cd backend && npm run build` after backend changes.

## Commit & Pull Request Guidelines

Recent history uses concise Chinese summaries and occasional bracketed scopes, for example `[update]更新配置文件`, `[debug]优化skill`, and `更新页面的前端设计`. Keep commits short, imperative, and focused on one change. Pull requests should include a clear description, affected frontend/backend areas, configuration changes, linked issues when available, and screenshots or recordings for visible UI changes.

## Security & Configuration Tips

Copy `config.example.json` to `config.json` for local setup. Never commit real API keys, internal hosts, private model paths, or personal workspace directories. Port values, workspace roots, OpenAI settings, remote GUI launchers, and speech services should be changed through `config.json` or documented environment overrides.
