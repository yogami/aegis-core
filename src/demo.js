"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const phala_entry_1 = __importDefault(require("./phala-entry"));
const types_1 = require("./types");
async function runDemo() {
    console.log("=== Aegis Hackathon Demo: DeFAI Terminal Refusal ===\n");
    const baseAgent = {
        did: "did:web:noahai.agent.tradebot1",
        purpose: types_1.AgentPurpose.FINANCIAL_OPERATIONS,
        currentTier: types_1.TrustTier.T4
    };
    console.log("--> Scenario 1: Authorized Trade (Within Risk Parameters)");
    const authorizedPayload = {
        agent: baseAgent,
        action: {
            toolId: "JupiterTradeExecution",
            actionType: "swap",
            parameters: {
                tokenIn: "USDC",
                tokenOut: "SOL",
                amountIn: 50_000
            },
            estimatedValue: 50_000 // Under T4 limit of 100k
        },
        context: {
            sessionId: "session-1",
            actionsThisSession: 5,
            actionsThisHour: 10,
            currentAnomalyScore: 0.1, // Low anomaly
            recentIncidents: 0
        }
    };
    const res1 = await (0, phala_entry_1.default)(JSON.stringify(authorizedPayload));
    console.log("Result: ", JSON.parse(res1));
    console.log("\n-------------------------------------------------\n");
    console.log("--> Scenario 2: Adversarial Injection (Terminal Refusal)");
    // An attacker compromises the agent and tries to drain $500k to a rogue wallet
    const maliciousPayload = {
        agent: baseAgent,
        action: {
            toolId: "SolanaTreasuryTransfer",
            actionType: "withdraw",
            parameters: {
                destination: "RogueWalletAddress123",
                amount: 500_000
            },
            estimatedValue: 500_000 // OVER T4 limit of 100k
        },
        context: {
            sessionId: "session-2",
            actionsThisSession: 20,
            actionsThisHour: 150,
            currentAnomalyScore: 0.9, // High anomaly detected by SWDB
            recentIncidents: 0
        }
    };
    const res2 = await (0, phala_entry_1.default)(JSON.stringify(maliciousPayload));
    console.log("Result (TERMINAL REFUSAL): \n", JSON.parse(res2));
    console.log("\n=================================================");
    console.log("Demo Complete. hardware-enforced policy cannot be bypassed.");
}
runDemo().catch(console.error);
