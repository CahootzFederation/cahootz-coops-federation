# Cahootz Technical Roadmap

---

## Phase 1: Foundation

- Keep the web, API, mobile, database, and contract workspaces running from the monorepo.
- Standardize environment setup and local development docs.
- Replace legacy product language in public documentation.
- Keep the Cahootz charter as an empty placeholder until governance language is ready.

---

## Phase 2: Member and Co-op Basics

- Support co-op discovery, application, approval, and member profiles.
- Improve authentication and session flows across web and mobile.
- Keep co-op-specific settings configurable from admin screens.
- Expand public co-op pages with accurate business and product data.

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Add error handling for authentication failures during proposal submissions. � �
  - [ ] Create integration tests to validate the authentication flow with the new proposal features. � �
  - [ ] Update user documentation to reflect changes in authentication processes. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement backend logic to enforce thresholds and review windows for proposals. � �
  - [ ] Create tests to validate the functionality of admin controls and their integration with existing proposal workflows. � �

---

## Phase 3: Commerce

- Stabilize storefront, product, cart, checkout, and order flows.
- Improve merchant onboarding and payout setup.
- Add better payment status visibility and failure recovery.
- Strengthen transaction reconciliation and audit trails.

---

## Phase 4: Governance

- Keep proposal submission, comments, review, and voting usable without the disabled charter compliance gate.
- Make proposal scoring configurable by co-op.
- Add clearer admin controls for proposal categories, thresholds, and review windows.
- Track proposal decisions and funded milestones.

---

## Keep co-op-specific settings configurable from admin screens. 🔴
*AI-suggested based on recent work: With the completion of proposal submission and tracking, there is a need to ensure that co-op settings can be managed effectively to support governance functionalities.*

  - [ ] Implement API endpoints for retrieving and updating co-op settings.
  - [ ] Add validation for co-op settings input to ensure data integrity.
  - [ ] Create unit tests for the new API endpoints to validate functionality.
  - [ ] Document the API endpoints and their usage in the API documentation.

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Identify and create test cases for financial transactions related to proposals. � �
  - [ ] Implement monitoring and logging for proposal-related financial transactions to detect anomalies. � �
  - [ ] Document testing strategies and coverage for financial and governance flows. � �

---

## Phase 5: Operations

- Improve treasury, rewards, member management, and store admin workflows.
- Add operational dashboards for health, payments, applications, proposals, and reconciliation.
- Document production deployment and incident response.
- Expand tests around high-risk financial and governance flows.

---

## Phase 6: Scale

- Prepare multi-co-op configuration, theming, and operational isolation.
- Harden event indexing and background jobs.
- Improve analytics, reporting, and export tools.
- Continue reducing legacy names in code after documentation migration is complete.

---
*🤖 Roadmap updated 2026-10-14 - AI-generated sub-items added based on completed work analysis*
