# Appendix C — Tools and Library Versions

Copied from `docs/REPORT_NOTES.md` §6.

| Tool / library | Version |
|---|---|
| Foundry (forge/anvil/cast) | 1.8.5 (Homebrew) |
| Solidity | 0.8.24, optimizer 200 runs, EVM cancun |
| OpenZeppelin Contracts | 5.1.0 (vendored in `contracts/lib`) |
| forge-std | 1.17.0 (vendored) |
| Node.js / pnpm | 22.23.1 / 9.9.0 |
| TypeScript / tsx | 5.6.3 / 4.19.1 |
| viem | 2.21.37 |
| wagmi / RainbowKit / TanStack Query | 2.12.25 / 2.2.0 / 5.59.16 |
| Next.js / React / Tailwind | 14.2.15 / 18.3.1 / 3.4.14 |
| Express / better-sqlite3 / jsonwebtoken | 4.21.1 / 11.5.0 / 9.0.2 |
| @openzeppelin/merkle-tree | 1.0.7 |
| Python / matplotlib | 3.14.4 / 3.10.7 |

Foundry test configuration (`contracts/foundry.toml`): fuzz `runs = 1000`; invariant `runs = 256`, `depth = 64`, `fail_on_revert = false`.
