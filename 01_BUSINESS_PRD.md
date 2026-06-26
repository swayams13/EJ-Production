# Manufacturing Intelligence System (MIS)

## Product Requirements Document (PRD)

Version: 1.0

Status: Active Development

Document Owner: Product & Engineering Team

Target Industry: Expansion Joint Manufacturing

Platform Type: Manufacturing Intelligence Platform (MES + APS + Production Planning)

---

# 1. Executive Summary

The Manufacturing Intelligence System (MIS) is a cloud-based production planning, scheduling, workforce optimization, execution tracking, and manufacturing intelligence platform designed specifically for expansion joint manufacturing operations.

The primary objective is to transform production management from a manual, experience-driven process into a data-driven, predictive, and automated system.

The system will act as a digital production manager capable of:

* Planning production workloads
* Allocating resources automatically
* Prioritizing critical projects
* Monitoring workforce performance
* Tracking production progress
* Managing material dependencies
* Predicting delays before they occur
* Recommending corrective actions

The platform is intended to reduce planning mistakes, improve workforce utilization, increase throughput, and improve on-time delivery performance.

---

# 2. Business Problem Statement

Current manufacturing operations suffer from several challenges:

## Planning Challenges

* Production planning relies heavily on manual calculations.
* Supervisors manually assign workers.
* Human errors lead to incorrect workload distribution.
* Daily priorities frequently change.

## Workforce Challenges

* High-performing workers are not always assigned to critical projects.
* Worker productivity is difficult to measure objectively.
* Attendance fluctuations impact production plans.

## Material Challenges

* Production is delayed due to missing materials.
* Material shortages are often discovered too late.
* Projects remain idle because dependencies are not visible.

## Delivery Challenges

* Customer delivery commitments are difficult to predict accurately.
* Large orders require phased deliveries.
* Delays are detected only after deadlines are threatened.

## Management Challenges

* No single source of truth.
* Excessive dependence on Excel.
* Lack of real-time visibility.
* Delayed reporting.

---

# 3. Product Vision

The MIS platform should become the operational brain of the factory.

Every day the system should answer:

* What work must be completed today?
* Which projects are most critical?
* Which workers should be assigned?
* Which projects are at risk?
* What materials are missing?
* How many workers are required?
* Can committed deliveries be achieved?
* What corrective actions should management take?

The long-term vision is to create a fully integrated Manufacturing Operating System.

---

# 4. Product Goals

## Goal 1

Improve on-time delivery performance.

Target:
95%+ on-time delivery.

---

## Goal 2

Reduce manual planning effort.

Target:
80% reduction in manual scheduling effort.

---

## Goal 3

Increase workforce utilization.

Target:
85%+ productive utilization.

---

## Goal 4

Improve management visibility.

Target:
Real-time visibility across all active projects.

---

## Goal 5

Reduce project delays.

Target:
Predict and prevent delays before they occur.

---

# 5. User Personas

## CEO

Responsibilities:

* Strategic decisions
* Delivery commitments
* Resource planning
* Business performance

Needs:

* Executive dashboard
* Risk alerts
* Delivery forecasts
* Workforce insights

---

## Production Head

Responsibilities:

* Production planning
* Resource allocation
* Deadline management

Needs:

* Capacity planning
* Project prioritization
* Workforce planning

---

## Supervisor

Responsibilities:

* Daily execution
* Attendance tracking
* Progress updates

Needs:

* Daily task sheets
* Worker assignments
* Production entry

---

## Store Manager

Responsibilities:

* Inventory tracking
* Material availability

Needs:

* Stock visibility
* Material alerts

---

## Worker

Responsibilities:

* Execute assigned work

Needs:

* Assigned tasks
* Daily targets
* Progress submission

---

## HR

Responsibilities:

* Workforce management
* Attendance monitoring

Needs:

* Attendance reports
* Utilization reports

---

# 6. Current System Scope

The current platform already supports:

## Project Entry

Users can create projects.

Inputs:

* Project name
* Project code
* Customer
* Bellows quantity
* Bellows size
* Target completion date

---

## Workload Calculation

System calculates:

* TIG welding feet
* MIG welding feet
* Grinding feet

Based on historical manufacturing data.

---

## Capacity Planning

System estimates:

* Required welders
* Required grinders
* Required manpower

To meet deadlines.

---

## Dashboard

Displays:

* Active projects
* Workforce requirement
* Workforce surplus
* Workforce deficit

---

# 7. Future Business Scope

The system will evolve into a complete manufacturing intelligence platform.

Major additions include:

* Workforce Intelligence
* Automated Scheduling
* Attendance Impact Planning
* Material Planning
* Delivery Planning
* Machine Planning
* Executive Intelligence

---

# 8. Project Lifecycle

Every project follows a standard lifecycle.

## Stage 1

Project Creation

---

## Stage 2

Engineering Approval

---

## Stage 3

Material Availability

---

## Stage 4

Bellows Manufacturing

---

## Stage 5

Collar Manufacturing

---

## Stage 6

Fit-Up

---

## Stage 7

TIG Welding

---

## Stage 8

MIG Welding

---

## Stage 9

Grinding

---

## Stage 10

Inspection

---

## Stage 11

Painting

---

## Stage 12

Dispatch

---

## Stage 13

Completed

---

# 9. Priority Classification System

Projects are categorized automatically.

## P1

Deadline less than 21 days.

Color:
Red

Highest priority.

---

## P2

Deadline between 21 and 60 days.

Color:
Orange

Medium priority.

---

## P3

Deadline greater than 60 days.

Color:
Green

Standard priority.

---

# 10. Criticality Scoring System

Priority alone is insufficient.

The system should calculate a Criticality Score.

Inputs:

* Deadline proximity
* Remaining workload
* Available workforce
* Material availability
* Machine availability

Output:

Criticality Rank

Projects with the highest criticality score receive priority scheduling.

---

# 11. Hold Management

Projects may be temporarily paused.

Supported Hold Types:

* Client Hold
* Material Hold
* Engineering Hold
* Inspection Hold
* Financial Hold
* Vendor Hold

Required Fields:

* Hold Date
* Resume Date
* Hold Reason
* Comments

Business Rules:

Held projects must not consume workforce allocation.

Held projects must not influence daily scheduling.

Held projects remain visible to management.

---

# 12. Daily Production Planning

Every morning the system automatically generates a Daily Production Plan.

The system should consider:

* Pending workload
* Workforce availability
* Attendance
* Material availability
* Machine availability
* Project priority

Output:

Worker-wise assignments.

Supervisor approval required before execution.

---

# 13. Daily Task Allocation

Objective:

Automatically assign work.

Inputs:

* Project priority
* Project deadline
* Worker skill
* Worker efficiency
* Worker attendance
* Workforce availability

Output:

Daily Task Sheet

Example:

Worker:
Rajesh

Project:
EJ-014

Task:
TIG Welding

Target:
50 ft

Priority:
P1

---

# 14. End-of-Day Production Reporting

Every worker must submit production data.

Inputs:

* Project
* Process
* Quantity completed
* Feet completed

Outputs:

Updated project progress.

Updated worker efficiency.

Updated production statistics.

---

# 15. Worker Performance Intelligence

Each worker must maintain a continuously updated profile.

Metrics include:

* Experience
* Attendance score
* Efficiency score
* Quality score
* Average output

Examples:

TIG ft/day

MIG ft/day

Grinding ft/day

Painting output/day

The system uses these metrics during scheduling.

---

# 16. Workforce Optimization Rules

Critical projects receive top-performing workers.

P1 Projects:

Highest performers.

P2 Projects:

Medium performers.

P3 Projects:

Remaining workforce.

The goal is to maximize delivery reliability.

---

# 17. Attendance Impact Planning

Attendance directly affects production planning.

If workforce availability changes:

The system recalculates:

* Daily targets
* Weekly targets
* Delivery forecasts

The system must recommend:

* Additional workers
* Overtime requirements
* Workload redistribution

---

# 18. Weekly Planning

Every week the system generates:

Required Capacity

Available Capacity

Workload Gap

Weekly Production Targets

The system continuously compares actual production against weekly targets.
