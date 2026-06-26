# Contributing to Cahootz

Thanks for helping build Cahootz. This project is early, so clear intent and small changes matter more than perfect process.

## Before You Start

- Check existing issues and pull requests to avoid duplicating work.
- Open an issue first for large features, architectural changes, contract changes, or data model changes.
- Keep pull requests focused on one problem or improvement.
- Do not commit secrets, private keys, wallet seed phrases, production database URLs, or customer data.

## Local Setup

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

See `README.md` and the setup docs linked there for more detail.

## Development Guidelines

- Follow the existing TypeScript, React, Tailwind, Prisma, and tRPC patterns.
- Prefer small, readable changes over broad refactors.
- Add or update tests when changing validation, payments, wallets, governance, contracts, or database behavior.
- Update docs when setup, public behavior, environment variables, or operational steps change.
- Treat smart contract changes as high risk. Include test output and deployment notes in the pull request.

## Checks

Run the checks that match your change:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
```

If a check is not relevant or cannot run locally, explain why in the pull request.

## Pull Requests

Please include:

- What changed and why.
- Screenshots or recordings for UI changes.
- Test commands run and their results.
- Any migrations, environment variables, contract deployment steps, or rollout notes.

