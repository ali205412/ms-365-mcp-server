# Microsoft Graph Coverage Report

_Generated 2026-04-21T11:11:41.554Z by bin/modules/coverage-check.mjs_

## Summary

| Metric | Value |
|---|---:|
| Current total ops | **42684** |
| Baseline total ops | 42335 |
| Delta | +349 |

## Per-Workload Coverage

| Workload | Current | Baseline | Delta | Status |
|---|---:|---:|---:|---|
| Other | 9106 | 9106 | +0 | OK |
| Intune | 5157 | 5157 | +0 | OK |
| Identity | 4662 | 4662 | +0 | OK |
| Files | 4591 | 4591 | +0 | OK |
| Users | 4120 | 4120 | +0 | OK |
| Groups | 3533 | 3533 | +0 | OK |
| Teams | 2782 | 2782 | +0 | OK |
| SharePoint | 1626 | 1626 | +0 | OK |
| Security | 1441 | 1441 | +0 | OK |
| OneNote | 1260 | 1260 | +0 | OK |
| Applications | 727 | 727 | +0 | OK |
| Calendars | 704 | 704 | +0 | OK |
| Planner | 577 | 577 | +0 | OK |
| Reports | 570 | 570 | +0 | OK |
| Mail | 566 | 566 | +0 | OK |
| Contacts | 292 | 292 | +0 | OK |
| powerbi | 285 | 0 | +285 | OK |
| ToDo | 232 | 232 | +0 | OK |
| People | 174 | 174 | +0 | OK |
| Copilot | 156 | 156 | +0 | OK |
| Search | 42 | 42 | +0 | OK |
| pwrauto | 20 | 0 | +20 | OK |
| pwrapps | 19 | 0 | +19 | OK |
| sp-admin | 15 | 0 | +15 | OK |
| Subscriptions | 13 | 13 | +0 | OK |
| exo | 10 | 0 | +10 | OK |
| Compliance | 4 | 4 | +0 | OK |

## Thresholds

- Default (Graph + Power BI / Power Apps / Power Automate): drops within **-5%** of baseline tolerated; between **-5%** and **-10%** emit a warning; at or below **-10%** fail the build.
- Strict (Exchange Admin, SharePoint Admin): **ANY drop** fails the build — mirrors the hand-authored-spec churn policy from plans 5.1-05 / 5.1-06.
