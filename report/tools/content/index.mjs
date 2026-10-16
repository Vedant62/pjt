import { p, src, table } from "./dsl.mjs";
import ch1 from "./ch1.mjs";
import ch2 from "./ch2.mjs";
import ch3 from "./ch3.mjs";
import ch4 from "./ch4.mjs";
import ch5 from "./ch5.mjs";
import ch6 from "./ch6.mjs";
import ch7 from "./ch7.mjs";

export const FRONT = {
  title: "Cashew: A Decentralized Protocol for Web3-Native Subscription Lifecycles",
  program: "Computer Science and Engineering",
  members: [
    { name: "Vardhman Bengani", reg: "23BCE5082" },
    { name: "Vedant Sharma", reg: "23BCE5094" },
    { name: "Ishita Singh", reg: "23BCE1955" },
  ],
  candidate: { name: "Vedant Sharma", reg: "23BCE5094" },
  guide: "Prof. Saktivel R",
  hod: "Prasanna J",
  date: "October, 2026",
  abstract: [
    "Recurring payment is the one everyday financial primitive that public blockchains still borrow from conventional finance: a smart contract cannot act on a timer, and the usual workaround, a large standing ERC-20 allowance, can be drained in a single transaction. This project presents Cashew, a protocol for subscription lifecycles that needs no trusted operator. A provider publishes a plan with immutable price, period, token and payee. A subscriber enrols with one EIP-712 permit signature, and afterwards any account, acting as an untrusted keeper, may trigger each charge when it falls due. The contract itself enforces the limit, at most the plan price at most once per elapsed period on an anchored schedule, and pays the keeper 0.25 % of each successful charge.",
    "The subscription is demonstrated as paid access to AI Power Grid, a live decentralized inference network on which the team operates its own GPU worker serving qwen3 models. A Cashew Gateway serves the OpenAI-compatible API only to wallets whose on-chain subscription is entitled, meters every request, and commits a Merkle root of usage rows on-chain each epoch.",
    "Cashew was implemented as four Solidity contracts, a Node.js keeper, an Express gateway and a Next.js dashboard, and deployed and verified on Ethereum Sepolia. It is backed by 72 Foundry tests, including fuzz properties and five handler-based invariants, with 100 % line coverage. Measurements show batching lowers the charge cost from 71,595 gas to 27,567 gas per subscriber, under 0.003 % of a 20-dollar cycle at the measured Base Sepolia gas price. In a 500-subscriber, twelve-period simulation, all 5,500 renewals executed for keeper intervals from one minute to six hours. After a three-period keeper outage, all 60 missed charges were recovered. A full lifecycle and live, on-chain-verified metering were demonstrated on the public testnet.",
    "Keywords: recurring payments, smart contracts, keepers, EIP-712, decentralized AI inference, Merkle commitments.",
  ],
  acknowledgement: [
    "It is my pleasure to express with deep sense of gratitude to Prof. Saktivel R, School of Computer Science and Engineering, Vellore Institute of Technology, Chennai, for their constant guidance, continual encouragement, understanding; more than all, they taught me patience in my endeavor. My association with them is not confined to academics only, but it is a great opportunity on my part of work with an intellectual and expert in the field of blockchain and distributed systems.",
    "It is with gratitude that I would like to extend my thanks to the visionary leader Dr. G. Viswanathan our Honorable Chancellor, Mr. Sankar Viswanathan, Dr. Sekar Viswanathan, Dr. G V Selvam Vice Presidents, Dr. Sandhya Pentareddy, Executive Director, Ms. Kadhambari S. Viswanathan, Assistant Vice-President, Dr. V. S. Kanchana Bhaaskaran Vice-Chancellor, Dr. T. Thyagarajan Pro-Vice Chancellor, VIT Chennai and Dr. P. K. Manoharan, Additional Registrar for providing an exceptional working environment and inspiring all of us during the tenure of the course.",
    "Special mention to Dr. Viswanathan V, Dean, Dr. Nithyanandam P, Associate Dean, Dr. Suganya G, Associate Dean, Dr. Sweetlin Hemalatha C, Associate Dean, School of Computer Science and Engineering, Vellore Institute of Technology, Chennai for spending their valuable time and efforts in sharing their knowledge and for helping us in every aspect.",
    "In jubilant state, I express ingeniously my whole-hearted thanks to **Prasanna J**, Head of the Department, B.Tech. **Computer Science and Engineering** and the Project Coordinators for their valuable support and encouragement to take up and complete the thesis.",
    "My sincere thanks to all the faculties and staffs at Vellore Institute of Technology, Chennai who helped me acquire the requisite knowledge. I would like to thank my parents for their support. It is indeed a pleasure to thank my friends who encouraged me to take up and complete this task.",
  ],
};

export const ACRONYMS = [
  ["ABI", "Application Binary Interface"], ["AIPG", "AI Power Grid"], ["API", "Application Programming Interface"],
  ["CEI", "Checks-Effects-Interactions (ordering pattern)"], ["CDF", "Cumulative Distribution Function"], ["DApp", "Decentralized Application"],
  ["DeFi", "Decentralized Finance"], ["EIP", "Ethereum Improvement Proposal"], ["EOA", "Externally Owned Account"],
  ["ERC", "Ethereum Request for Comments"], ["ETH", "Ether, the native token of Ethereum"], ["EVM", "Ethereum Virtual Machine"],
  ["GPU", "Graphics Processing Unit"], ["HTTP", "Hypertext Transfer Protocol"], ["JSON", "JavaScript Object Notation"],
  ["JWT", "JSON Web Token"], ["L1 / L2", "Layer 1 / Layer 2 blockchain"], ["mUSDC", "Mock USD Coin (6-decimal test stablecoin)"],
  ["REST", "Representational State Transfer"], ["RPC", "Remote Procedure Call"], ["SIWE", "Sign-In With Ethereum (EIP-4361)"],
  ["SSE", "Server-Sent Events"], ["SQL", "Structured Query Language"], ["TTFT", "Time To First Token"],
  ["UI", "User Interface"], ["USDC", "USD Coin (fiat-backed stablecoin)"], ["bps", "Basis points (1 bps = 0.01 %)"],
];

export const REFERENCES = [
  "Abadi, A., Murdoch, S. J., & Zacharias, T. (2023). Recurring contingent service payment. In *2023 IEEE 8th European Symposium on Security and Privacy (EuroS&P)*. IEEE.",
  "AI Power Grid. (2026). *AI Power Grid documentation* [Online documentation]. Retrieved October 16, 2026, from https://aipowergrid.io/docs",
  "Antonopoulos, A. M., & Wood, G. (2018). *Mastering Ethereum: Building smart contracts and DApps*. O'Reilly Media.",
  "Atzei, N., Bartoletti, M., & Cimoli, T. (2017). A survey of attacks on Ethereum smart contracts (SoK). In *Principles of Security and Trust (POST 2017)* (Lecture Notes in Computer Science, Vol. 10204, pp. 164–186). Springer.",
  "Bloemen, R., Logvinov, L., & Evans, J. (2017). *EIP-712: Typed structured data hashing and signing* (Ethereum Improvement Proposal No. 712). https://eips.ethereum.org/EIPS/eip-712",
  "Breidenbach, L., Cachin, C., Chan, B., Coventry, A., Ellis, S., Juels, A., Koushanfar, F., Miller, A., Magauran, B., Moroz, D., Nazarov, S., Topliceanu, A., Tramèr, F., & Zhang, F. (2021). *Chainlink 2.0: Next steps in the evolution of decentralized oracle networks* [White paper]. Chainlink Labs.",
  "Buckley, D., Bendiab, G., Shiaeles, S., Savage, N., & Kolokotronis, N. (2021). CHAINGE: A blockchain solution to automate payment detail updates to subscription services. In *2021 IEEE International Conference on Communications Workshops (ICC Workshops)*. IEEE.",
  "Buterin, V. (2014). *Ethereum: A next-generation smart contract and decentralized application platform* [White paper]. https://ethereum.org/whitepaper",
  "Buterin, V., Weiss, Y., Tirosh, D., Nacson, S., Forshtat, A., Gazso, K., & Hess, T. (2021). *ERC-4337: Account abstraction using alt mempool* (Ethereum Improvement Proposal No. 4337). https://eips.ethereum.org/EIPS/eip-4337",
  "Chang, W., Rocco, G., Millegan, B., Johnson, N., & Terbu, O. (2021). *EIP-4361: Sign-In with Ethereum* (Ethereum Improvement Proposal No. 4361). https://eips.ethereum.org/EIPS/eip-4361",
  "Daian, P., Goldfeder, S., Kell, T., Li, Y., Zhao, X., Bentov, I., Breidenbach, L., & Juels, A. (2020). Flash Boys 2.0: Frontrunning in decentralized exchanges, miner extractable value, and consensus instability. In *2020 IEEE Symposium on Security and Privacy (SP)* (pp. 910–927). IEEE.",
  "Gogol, K., Killer, C., Schlosser, M., Boeck, T., Stiller, B., & Tessone, C. (2024). *SoK: Decentralized finance (DeFi) – fundamentals, taxonomy and risks* (arXiv:2404.11281). arXiv.",
  "Grybniak, S., Mihai, R., Datta, G., Goga, N., Mazurok, I., & Ozkul, O. F. (2022). Recurring payments on EVM-based platforms. In *2022 IEEE 1st Global Emerging Technology Blockchain Forum: Blockchain & Beyond (iGETblockchain)*. IEEE. https://doi.org/10.1109/iGETblockchain56591.2022.10087077",
  "Kaleem, M., & Shi, W. (2021). Demystifying Pythia: A survey of ChainLink oracles usage on Ethereum. In *Financial Cryptography and Data Security. FC 2021 International Workshops* (Lecture Notes in Computer Science, Vol. 12676). Springer.",
  "Lu, Q., Xu, X., Bandara, H. M. N. D., Chen, S., & Zhu, L. (2021). Patterns for blockchain-based payment applications. In *Proceedings of the 26th European Conference on Pattern Languages of Programs (EuroPLoP '21)*. ACM.",
  "Lundfall, M. (2020). *ERC-2612: Permit extension for EIP-20 signed approvals* (Ethereum Improvement Proposal No. 2612). https://eips.ethereum.org/EIPS/eip-2612",
  "Mayer, H., Bejarano, I., Fernandez, D., Ajzenman, G., Ayala, N., Santoalla, N., Sarraute, C., & Futoransky, A. (2020). *BatPay: A gas efficient protocol for the recurrent micropayment of ERC20 tokens* (arXiv:2002.02316). arXiv.",
  "Meng, Z., & Feng, V. (2025). *A stream pipeline framework for digital payment programming based on smart contracts* (arXiv:2508.21075). arXiv.",
  "Merkle, R. C. (1988). A digital signature based on a conventional encryption function. In *Advances in Cryptology – CRYPTO '87* (Lecture Notes in Computer Science, Vol. 293, pp. 369–378). Springer.",
  "Mita, M., Ito, K., Ohsawa, S., & Tanaka, H. (2019). What is stablecoin?: A survey on price stabilization mechanisms for decentralized payment systems. In *2019 8th International Congress on Advanced Applied Informatics (IIAI-AAI)* (pp. 60–66). IEEE.",
  "Nakamoto, S. (2008). *Bitcoin: A peer-to-peer electronic cash system* [White paper]. https://bitcoin.org/bitcoin.pdf",
  "Onica, E., & Amariei, C. (2022). Using SGX for meta-transactions support in Ethereum DApps. In *Distributed Applications and Interoperable Systems (DAIS 2022)* (Lecture Notes in Computer Science). Springer.",
  "OpenZeppelin. (2024). *OpenZeppelin Contracts* (Version 5.1.0) [Computer software]. https://github.com/OpenZeppelin/openzeppelin-contracts",
  "Owocki, K. (2018). *ERC-948: Recurring subscription models are a better way of doing business* [GitHub issue #948]. ethereum/EIPs. https://github.com/ethereum/EIPs/issues/948",
  "Pernice, I. G. A., Henningsen, S., Proskalovich, R., Florian, M., Elsden, H., & Scheuermann, B. (2019). Monetary stabilization in cryptocurrencies – design approaches and open questions. In *2019 Crypto Valley Conference on Blockchain Technology (CVCBT)* (pp. 47–59). IEEE.",
  "Seres, I. A. (2020). *On blockchain metatransactions* (arXiv:2004.08094). arXiv.",
  "Vogelsteller, F., & Buterin, V. (2015). *EIP-20: Token standard* (Ethereum Improvement Proposal No. 20). https://eips.ethereum.org/EIPS/eip-20",
  "Wang, Q., & Chen, S. (2023). *Account abstraction, analysed* (arXiv:2309.00448). arXiv.",
  "Wood, G. (2014). *Ethereum: A secure decentralised generalised transaction ledger* [Yellow paper]. https://ethereum.github.io/yellowpaper/paper.pdf",
];

export const APPENDICES = [
  {
    title: "SubscriptionVault.sol (complete source)",
    blocks: [p("The complete source of the core contract as deployed and verified on Ethereum Sepolia at 0x9bC880415C54122cB64463888Db6a94Bf285dB8a.", { noIndent: true }), src("contracts/src/SubscriptionVault.sol", null, { size: 14 })],
  },
  {
    title: "PlanRegistry.sol and UsageRootRegistry.sol",
    blocks: [src("contracts/src/PlanRegistry.sol", "B.1  PlanRegistry.sol", { size: 14 }), src("contracts/src/UsageRootRegistry.sol", "B.2  UsageRootRegistry.sol", { size: 14 })],
  },
  {
    title: "Keeper core (keeper/src/keeper.ts)",
    blocks: [src("keeper/src/keeper.ts", null, { size: 14 })],
  },
  {
    title: "Invariant specifications (excerpt)",
    blocks: [p("The five protocol invariants as encoded for Foundry's handler-based invariant fuzzer. The handler that drives random action sequences is in contracts/test/invariant/Handler.sol.", { noIndent: true }), src("contracts/test/invariant/Invariants.t.sol", null, { size: 14 })],
  },
  {
    title: "Deployment record and reproduction commands",
    blocks: [
      table("Ethereum Sepolia deployment (chainId 11155111)", ["Item", "Value"], [
        ["Deployer / provider / payee", "0xdb0C7Acf5560eA87eD7D5D7C570dF21092ac62E7"],
        ["MockUSDC", "0x75e8B2f30a7c08cf3967A2745dFAb0CF418Ced96"],
        ["PlanRegistry", "0x9109E3Af83D6499E4d433128B60CDAc5505Cc815"],
        ["SubscriptionVault", "0x9bC880415C54122cB64463888Db6a94Bf285dB8a"],
        ["UsageRootRegistry", "0x3fF143e67616114B4F638b332BaF060Cb8e8696C"],
        ["Gateway (root committer)", "0x6c9e15ce9e9B812d7746DDab4926b2eBFE9fade2"],
        ["Keeper", "0x9EE946ea5d8aDf194295a1a951bCd2F9C7CD2159"],
        ["First deployment block", "11925719"],
        ["Plans", "#1 demo: 20 mUSDC / 180 s / grace 60 s; #2 production: 20 mUSDC / 30 days / grace 3 days"],
      ], [1.6, 4.4], { size: 19 }),
      p("**Reproducing the results.** From a fresh clone of the repository:", { noIndent: true }),
      { t: "code", lines: [
        "pnpm i                      # install the workspace",
        "pnpm test:contracts         # 72 Foundry tests (unit, fuzz, invariant)",
        "pnpm local:up               # anvil + deploy + seed + keeper + gateway (mock) + dashboard",
        "pnpm test:gateway           # 10 end-to-end gateway tests against the local chain",
        "pnpm results:local          # test summary, gas, batch sweep, cost, schedule sim, outage",
        "pnpm deploy:testnet         # deploy + seed + verify on Ethereum Sepolia",
        "pnpm testnet:up             # keeper + gateway + dashboard against Sepolia",
        "pnpm results:testnet        # lifecycle, grid snapshot, live bench (asks first), epochs",
        "pnpm results:summary        # figures + results/RESULTS.md",
      ], size: 17 },
    ],
  },
];

export const CHAPTERS = [ch1, ch2, ch3, ch4, ch5, ch6, ch7];
