# Security Policy

Security matters for Cahootz because the project touches membership, payments, wallets, governance, and treasury workflows.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Email `team@cahootz.coop` with:

- A clear description of the issue.
- Steps to reproduce, proof of concept, or affected files when available.
- The potential impact.
- Any suggested mitigation.

We will acknowledge reports as soon as practical and coordinate fixes before public disclosure.

## Sensitive Data

Do not commit:

- Private keys, seed phrases, mnemonics, or test wallet files.
- Production API keys, database URLs, webhook secrets, session secrets, or access tokens.
- Customer, member, applicant, payment, or wallet data from production systems.

Use `.env.example` files for placeholders and keep real values in local or hosted secret stores.

## High-Risk Areas

Extra review is expected for changes involving:

- Smart contracts, deployment scripts, and contract artifacts.
- Wallet signing, wallet storage, or admin authentication.
- Payments, webhooks, refunds, and order fulfillment.
- Proposal voting, role checks, treasury logic, and member verification.
- Database migrations that affect membership, balances, roles, or permissions.

## Supported Versions

This project is pre-1.0. Security fixes are made on the main development branch unless a maintained release branch is announced.

