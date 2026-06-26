# Cahootz Monorepo

Cahootz is a platform for launching and operating community-owned economies. It brings together member onboarding, cooperative storefronts, payments, governance, proposal workflows, and treasury tooling in one monorepo.

The codebase currently includes web, mobile, API, database, smart contract, and shared service packages.

## Documentation

- [Getting Started](GETTING_STARTED.md) - Set up the project locally.
- [Cahootz Charter](documents/cahootz-charter.md) - Placeholder charter for the Cahootz era.
- [Proposal Engine](documents/cahootz-proposal-engine.md) - How proposal submission, review, scoring, and voting are intended to work.
- [Technical Roadmap](documents/tech_roadmap.md) - Product and engineering milestones.
- [Organizational Roadmap](documents/org_roadmap.md) - Operating model and rollout stages.
- [Development Guide](DEV_GUIDE.md) - Local workflows, debugging, and troubleshooting.
- [Environment Files Guide](ENV_FILES_GUIDE.md) - Environment variable layout.
- [Testing Guide](TESTING.md) - Test commands and expectations.

## What Cahootz Includes

- Member onboarding and co-op selection
- Public co-op pages and storefronts
- Product, cart, checkout, and payment flows
- Admin portals for members, stores, proposals, treasury, rewards, and settings
- Proposal submission, review, discussion, and voting workflows
- Smart contract deployment and configuration tools
- Mobile app flows for wallets, payments, stores, and member activity

## Project Structure

```text
cahootz/
├── apps/
│   ├── api/        # Express API service
│   ├── mobile/     # Expo mobile application
│   └── web/        # Next.js web application
├── documents/      # Product and operating documentation
├── packages/
│   ├── contracts/  # Smart contracts and deployment scripts
│   ├── db/         # Prisma schema, migrations, and seed scripts
│   ├── trpc/       # tRPC routers and backend services
│   ├── ui/         # Shared UI primitives
│   └── validators/ # Proposal and validation logic
├── scripts/        # Repo-level utilities
├── tooling/        # Shared lint, TypeScript, Tailwind, and Prettier config
└── turbo/          # Turborepo generators/configuration
```

## Tech Stack

- Next.js 15, React 19, TypeScript, Tailwind CSS
- Expo and React Native
- Express, tRPC, Prisma, PostgreSQL, Zod
- Solidity, Hardhat, Base-compatible deployment scripts
- Turborepo and pnpm workspaces

## Prerequisites

- Node.js >= 22.14.0
- pnpm >= 10.11.1
- PostgreSQL
- Git

## Quick Start

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

The default local services are:

- Web: http://localhost:3000
- API: http://localhost:3001

See [Getting Started](GETTING_STARTED.md) for the fuller setup path.

## Common Commands

```bash
pnpm dev              # Start development services
pnpm build            # Build packages and apps
pnpm lint             # Run linting
pnpm typecheck        # Run TypeScript checks
pnpm test             # Run tests
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema to the local database
pnpm db:migrate       # Run database migrations
pnpm db:studio        # Open Prisma Studio
```

## Charter Compliance Check

The automated Charter Compliance Check is disabled for now while Cahootz documentation and governance language are being reset. The placeholder Cahootz charter lives at [documents/cahootz-charter.md](documents/cahootz-charter.md).

## Contributing

1. Create a feature branch.
2. Make scoped changes in the relevant app or package.
3. Run the checks that match the risk of the change.
4. Update docs when behavior, setup, or operations change.
5. Open a pull request with clear testing notes.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
