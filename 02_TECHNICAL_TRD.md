# Manufacturing Intelligence System (MIS)

## Technical Requirements Document (TRD)

Version: 1.0

Status: Active Development

Architecture Type: Cloud Native Modular Monolith (Phase 1–3)

Future Architecture: Service-Oriented / Event-Driven Platform

Deployment Target: Railway

---

# 1. Technical Vision

The Manufacturing Intelligence System is designed to become the central operational platform for factory planning, execution, monitoring, optimization, and decision support.

The architecture must support:

* Real-time operations
* Multiple user roles
* Concurrent users
* Historical analytics
* Future AI scheduling
* Machine integration
* ERP integration
* Mobile workforce applications

Primary goals:

* Reliability
* Scalability
* Security
* Maintainability
* Extensibility

---

# 2. System Architecture

## High-Level Architecture

```text
┌────────────────────┐
│      Frontend      │
│ Next.js + TS       │
└─────────┬──────────┘
          │ HTTPS
          ▼
┌────────────────────┐
│      FastAPI       │
│      Backend       │
└─────────┬──────────┘
          │
 ┌────────┼──────────┐
 ▼        ▼          ▼

Postgres Redis    R2 Storage

          │
          ▼

Background Workers

          │
          ▼

Notification Engine
```

---

# 3. Technology Stack

## Frontend

Framework:

Next.js

Language:

TypeScript

UI:

Tailwind CSS

Component Library:

ShadCN UI

Data Fetching:

TanStack Query

Forms:

React Hook Form

Validation:

Zod

Charts:

Recharts

State Management:

Zustand

---

## Backend

Framework:

FastAPI

Language:

Python

ORM:

SQLAlchemy

Validation:

Pydantic

Database Migration:

Alembic

Authentication:

JWT

Background Jobs:

APScheduler / Celery

Dependency Injection:

FastAPI Native

---

## Database

Production Database:

PostgreSQL

Hosted:

Railway PostgreSQL

Never use SQLite in production.

---

## Cache Layer

Redis

Purpose:

* Session caching
* Scheduling queues
* Notifications
* Performance optimization

---

## Storage

Preferred:

Cloudflare R2

Stores:

* Drawings
* Inspection Reports
* Purchase Orders
* Images
* Documents

Never store files inside PostgreSQL.

---

# 4. Deployment Architecture

Railway Project Structure

```text
MIS

├── frontend-service
├── backend-service
├── postgres-service
├── redis-service
├── scheduler-service
└── cloud-storage
```

---

# 5. Backend Architecture

Use Domain Driven Design.

Do NOT organize by page.

Organize by business domain.

```text
app/

├── auth
├── users
├── workers
├── attendance
├── projects
├── planning
├── scheduling
├── production
├── materials
├── inventory
├── machines
├── analytics
├── reports
├── notifications
├── audit
└── common
```

Each module:

```text
module

├── router.py
├── service.py
├── repository.py
├── schemas.py
├── models.py
└── permissions.py
```

---

# 6. Database Architecture

Core principle:

Single Source of Truth.

---

# 7. Core Entities

## Users

```sql
users
```

Fields:

* id
* email
* password_hash
* role_id
* status
* created_at

---

## Roles

```sql
roles
```

Fields:

* id
* role_name

---

## Permissions

```sql
permissions
```

Fields:

* id
* permission_code

---

## Workers

```sql
workers
```

Fields:

* id
* employee_code
* name
* department
* experience_years
* joining_date
* status

---

## Worker Skills

```sql
worker_skills
```

Fields:

* worker_id
* process_type
* speed
* quality_score

---

## Attendance

```sql
attendance
```

Fields:

* worker_id
* date
* present
* overtime_hours

---

## Projects

```sql
projects
```

Fields:

* project_code
* customer
* status
* priority
* target_date

---

## Project Milestones

```sql
project_milestones
```

Fields:

* milestone_name
* planned_date
* actual_date

---

## Daily Production

```sql
daily_production
```

Fields:

* worker_id
* project_id
* process
* feet_completed
* quantity_completed
* production_date

---

## Materials

```sql
materials
```

Fields:

* code
* description
* available_qty
* minimum_qty

---

## Inventory Transactions

```sql
inventory_transactions
```

Fields:

* material_id
* transaction_type
* quantity
* timestamp

---

## Machines

```sql
machines
```

Fields:

* machine_name
* capacity_per_day
* efficiency
* status

---

## Notifications

```sql
notifications
```

Fields:

* recipient
* title
* type
* status

---

## Audit Logs

```sql
audit_logs
```

Fields:

* user
* action
* entity
* old_value
* new_value
* timestamp

---

# 8. Authentication Design

Authentication Method:

JWT

---

Access Token

Lifetime:

15 minutes

---

Refresh Token

Lifetime:

7 days

Stored:

HttpOnly Cookie

---

Flow

```text
Login

↓

Access Token

↓

Refresh Token

↓

Auto Refresh

↓

Logout
```

---

# 9. Authorization Design

Role Based Access Control (RBAC)

Never hardcode permissions.

---

Permission Examples

```text
project.create

project.update

project.delete

production.create

attendance.create

inventory.update

user.manage
```

---

# 10. Role Definitions

CEO

Full access

---

Production Head

Planning access

Analytics access

---

Supervisor

Production entry

Attendance

Project updates

---

Worker

Assigned task visibility

Production submission

---

Store Manager

Inventory

Material updates

---

Admin

System administration

---

# 11. Security Standards

Password Hashing

Argon2

---

HTTPS

Mandatory

---

Rate Limiting

Login attempts:

5 per minute

---

CORS

Allow frontend domains only

---

Secret Management

Store only in Railway Variables

Never commit secrets

---

Audit Logging

Mandatory

No delete operations without audit trail

---

# 12. Scheduling Engine Architecture

Purpose:

Automatic workforce assignment.

Inputs:

* Attendance
* Worker skill
* Worker efficiency
* Project priority
* Material availability
* Machine availability

Output:

Daily task allocations.

---

# 13. Workforce Intelligence Engine

Calculates:

Efficiency Score

Attendance Score

Reliability Score

Quality Score

Experience Score

Composite Performance Index

Used by scheduler.

---

# 14. Material Dependency Engine

Checks:

Material availability

Before assigning production.

If dependency missing:

Project enters blocked state.

No scheduling allowed.

---

# 15. Notification Engine

Runs continuously.

Generates:

* Deadline alerts
* Material alerts
* Workforce alerts
* Quality alerts

Delivery:

* In-app
* Email (future)
* WhatsApp (future)

---

# 16. Background Workers

Separate Railway service.

Responsibilities:

* Weekly planning
* Daily scheduling
* Notification generation
* KPI calculations
* Forecast generation

Never run heavy jobs inside API server.

---

# 17. Reporting Engine

Reports:

Daily Production

Weekly Production

Monthly Production

Worker Utilization

Project Status

Material Consumption

Delivery Forecast

Export:

Excel

PDF

CSV

---

# 18. Monitoring Stack

Error Monitoring

Sentry

---

Logs

Better Stack

---

Analytics

PostHog

---

Database Monitoring

Railway Metrics

---

# 19. CI/CD Pipeline

Git Strategy

```text
main

develop

feature/*
```

---

Flow

```text
Developer

↓

Feature Branch

↓

Develop

↓

Staging

↓

Production
```

---

Deployment

Automatic via GitHub.

---

# 20. Railway Deployment

Frontend Service

Next.js

---

Backend Service

FastAPI

---

PostgreSQL Service

Managed PostgreSQL

---

Redis Service

Managed Redis

---

Scheduler Service

Background Worker

---

# 21. API Design Standards

Versioning

```text
/api/v1/
```

---

Examples

```text
/api/v1/projects

/api/v1/workers

/api/v1/production

/api/v1/materials
```

---

Response Standard

```json
{
  "success": true,
  "message": "Operation completed",
  "data": {}
}
```

---

# 22. Scalability Requirements

Phase 1

50 users

---

Phase 2

250 users

---

Phase 3

500+ users

---

Architecture must support:

* Horizontal API scaling
* Database indexing
* Query optimization
* Redis caching

---

# 23. Future Integrations

ERP

SAP

Tally

Power BI

MES Devices

Barcode Scanners

QR Systems

Biometric Attendance

IoT Sensors

Robotic Welding Machines

---

# 24. Non-Functional Requirements

Availability

99.5%+

---

API Response

< 300ms

---

Dashboard Load

< 2 seconds

---

Authentication

< 500ms

---

Database Backup

Daily

---

Recovery Objective

< 1 hour

---

# 25. Engineering Principles

Single Source of Truth

Domain Driven Design

Audit Everything

Security By Default

No Business Logic In Frontend

No Direct Database Access

Automate Repetitive Decisions

Design For Future AI Optimization

Build For Manufacturing Reality

Prioritize Operational Simplicity Over Technical Complexity
