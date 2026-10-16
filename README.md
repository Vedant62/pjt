# Cashew

Decentralized recurring (subscription) payments on EVM chains. A provider publishes a plan on-chain, a subscriber signs **one** EIP-712 permit to enrol, and an untrusted, permissionless keeper triggers each charge when it falls due. The contract — not the allowance — enforces the limit: at most the plan price, at most once per elapsed period.

Demonstrated on access to [AI Power Grid](https://api.aipowergrid.io): the Cashew Gateway lets a wallet use the OpenAI-compatible API only while its on-chain subscription is entitled, meters usage, and commits a Merkle root of usage rows on-chain every epoch.

See [SPEC.md](SPEC.md) for the full specification and [PROGRESS.md](PROGRESS.md) for build status.

_Quickstart sections are filled in as phases land._
