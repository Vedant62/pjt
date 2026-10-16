# Gas report

Generated 2026-10-16T04:46:17.519Z at commit `4439796` by `sim/src/gas-report.ts`.

Execution gas per call as measured by Foundry across unit tests (includes reverting calls in tests). Excludes 21,000 intrinsic + calldata gas. chargeBatch varies with batch size; see batch_sweep.json.

| Operation | Contract | Calls | Min | Avg | Median | Max |
|---|---|---:|---:|---:|---:|---:|
| `createPlan` | PlanRegistry | 63 | 23226 | 147209 | 161973 | 161973 |
| `subscribeWithPermit` | SubscriptionVault | 3 | 213051 | 252454 | 253892 | 290419 |
| `subscribe` | SubscriptionVault | 43 | 36446 | 204235 | 241640 | 241640 |
| `charge` | SubscriptionVault | 30 | 29057 | 61712 | 46360 | 94772 |
| `chargeBatch` | SubscriptionVault | 4 | 27118 | 61279 | 49704 | 118593 |
| `cancel` | SubscriptionVault | 10 | 23762 | 28689 | 30458 | 30498 |
| `withdraw` | SubscriptionVault | 4 | 29149 | 48111 | 48111 | 67074 |
| `commitRoot` | UsageRootRegistry | 5 | 25044 | 58681 | 27397 | 118440 |
