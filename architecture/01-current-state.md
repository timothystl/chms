# Current State

## Application and infrastructure catalog

| Capability | Repository | Deployment | Hostname/surface | Data/resources |
|---|---|---|---|---|
| Public church website | `timothystl/website` | Worker `timothystl-site` | `timothystl.org` | Static assets plus published data from Website Admin APIs |
| Website administration | `timothystl/website` | Worker `tlc-newsletter-admin` | `admin.timothystl.org` | D1 `tlc-newsletter-db`; R2 `tlc-news-images` |
| Public giving presentation | `timothystl/website` | `timothystl-site` | `give.timothystl.org` | Website settings and external giving links |
| Utility links | `timothystl/website` | Worker `tlc-links` | `links.timothystl.org` | Worker/site configuration |
| Connect/CHMS | `timothystl/chms` | Worker `tlc-chms` | `connect.timothystl.org` | D1 `tlc-volunteer-db`; KV `RSVP_STORE`; R2 photos |
| Giving | `timothystl/chms` | Same `tlc-chms` Worker | Connect Giving screens | Same `tlc-volunteer-db` |
| Finance | `timothystl/chms` | Same `tlc-chms` Worker | Connect Finance screens | Same `tlc-volunteer-db` |
| Serve | `timothystl/chms` | Same `tlc-chms` Worker | `serve.timothystl.org` | Same `tlc-volunteer-db` |
| Scheduler | `timothystl/chms` | Same `tlc-chms` Worker | Embedded in Connect | Same `tlc-volunteer-db` |
| Combined church/MDO payroll | `timothystl/website` | Website Admin Worker | Website Admin Payroll | Supabase payroll RPCs/tables |
| myMDO | `timothystl/childcare-portal` | Cloudflare Worker `childcare-portal` deployed by GitHub Actions + Supabase Functions | Public, admin, parent, and staff surfaces | Supabase project `dahdstopsumxnqvdclmy`: Postgres, Auth, Storage, Functions |
| MDO website controls | `timothystl/childcare-portal` | myMDO Admin | Settings → Website → MDO Website | Narrow seasonal settings; general page content is currently developer-managed in the repository |

## Current integrations

```text
Public Website
    └── reads published content from Website Admin

Website Admin
    ├── writes tlc-newsletter-db
    ├── stores media in R2
    ├── calls tlc-chms through VOLUNTEER_WORKER service binding
    └── reads payroll data through Supabase RPC contracts

Connect / tlc-chms
    ├── writes tlc-volunteer-db
    ├── serves Connect, Finance, Serve, and Scheduler
    └── calls myMDO finance-summary Function

myMDO
    └── owns MDO Postgres, Auth, Storage, Functions, and operational workflows
```

## Current operational weaknesses

1. `tlc-chms` contains four workloads with different traffic, sensitivity, and failure characteristics.
2. `tlc-volunteer-db` contains much more than volunteer data, obscuring ownership.
3. Finance caused heavy D1 reads that surfaced as account-wide failures in Website Admin.
4. Website Admin and Connect maintain separate staff authentication.
5. Payroll appears in Website Admin while relying on myMDO Supabase data and overlapping Connect Finance.
6. Staff, events, messaging, files, reporting, and audit capabilities exist in multiple systems without one ownership register.
7. Cloudflare database metrics identify SQL and database, but not a developer-friendly route-to-repository ownership chain.
8. Connect/Finance and myMDO can automatically reach production from merge workflows; overhaul work needs an explicit manual release gate and rollback checkpoint.

## September 5, 2026 stabilization state

- Website Admin caching/publish invalidation changes are deployed; the local `website` checkout is three commits behind `origin/main` but otherwise clean.
- Connect/Finance D1 optimizations for giving imports, yearly rollups, maintained batch totals, and bounded deposit coverage are merged to `origin/main` and their deployment workflows completed successfully.
- Finance/Giving hardening was merged through PR #828 (`3d37ac7`); its feature tip is `2b4e22f`. The clean local `chms` branch remains at `3098677`, one commit ahead and twelve behind current `origin/main`, but its tree is identical to `2b4e22f`. The prior preservation task is therefore closed; the local checkout should still not be reset or rebased casually.
- A targeted Finance/Giving test run previously passed all 121 tests across six relevant suites. The merged current-main state still needs a focused rerun, full suite, production migration-status check, concurrency verification, and control-total reconciliation before the stabilization gate is closed.
- myMDO retired its broad public-page content editor and retained only narrow seasonal controls. The redundant Cloudflare Workers Builds integration was disconnected; GitHub Actions remains the documented production deployer.

## Current usage population

- One primary myMDO administrator.
- MDO staff use clock-in/out and staff workflows.
- One primary Website editor.
- One cross-system administrator uses Website, Connect, Finance, and myMDO.
- Authenticated public/member usage is not currently represented.

This is the population for the seven-day Phase 0 baseline. Missing future-user traffic must be tested later in staging rather than manufactured in production.
