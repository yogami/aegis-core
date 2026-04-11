"use client";

import { useState } from "react";
import { Connection, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { withAegis } from "aegis-core/sdk";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const executeAegisPayload = async () => {
    setIsProcessing(true);
    setLogs((prev) => [...prev, "🚀 Initializing Aegis-12 Security Gateway..."]);
    
    try {
      // 1. Mock the Agentic transaction
      setLogs((prev) => [...prev, "📦 Constructing Solana User Operations intent..."]);
      const agentKeypair = Keypair.generate();
      const rawTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agentKeypair.publicKey,
          toPubkey: agentKeypair.publicKey,
          lamports: 10,
        })
      );
      rawTx.recentBlockhash = "11111111111111111111111111111111";
      rawTx.feePayer = agentKeypair.publicKey;

      // 2. The entire DevX Execution (2 Lines of Code!)
      setLogs((prev) => [...prev, "🛡️ Engaging Iron Triangle `withAegis()` wrapper..."]);
      // Artificial delay for UI effect
      await new Promise((r) => setTimeout(r, 1000));
      
      const { safeTx, receipt } = await withAegis(rawTx, {
          // Devnet mock endpoint or fallbacks
          enclaveUrl: "http://localhost:3000/solana/enforce-tx",
          strictMode: false // So it passes gracefully in the dummy
      });

      setLogs((prev) => [
        ...prev, 
        `✅ SUCCESS! Cryptographic bounds validated.`,
        `📜 ARS Proof Anchor: ${receipt.arsToken}`,
        `⏱️ Slot: ${receipt.simulatedSlot} | Review Pending: false`
      ]);

    } catch (e: any) {
      setLogs((prev) => [...prev, `❌ GATEWAY LOCKDOWN: ${e.message}`]);
    }

    setIsProcessing(false);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-cyan-900/40 blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-900/40 blur-[150px] rounded-full pointer-events-none" />

        <div className="z-10 w-full max-w-3xl flex flex-col items-center space-y-8">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-center bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
                Aegis-12 Security Dashboard
            </h1>
            <p className="text-neutral-400 text-center max-w-xl text-sm md:text-base">
                An absolute zero-friction Developer Experience. Click the button below to simulate routing an autonomous transaction through the remote AMD SEV Hardware Enclave via the `withAegis` Typescript SDK.
            </p>

            <button 
                onClick={executeAegisPayload}
                disabled={isProcessing}
                className="group relative inline-flex items-center justify-center px-8 py-3 font-semibold text-white transition-all duration-300 bg-cyan-600 rounded-full hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isProcessing ? "Routing to Enclave..." : "Execute secure Agent Payload"}
            </button>

            {/* Terminal Interface */}
            <div className="w-full mt-8 p-6 bg-neutral-900/80 backdrop-blur-xl border border-neutral-800 rounded-xl shadow-2xl font-mono text-xs md:text-sm h-64 overflow-y-auto">
                <div className="flex items-center space-x-2 mb-4 border-b border-neutral-800 pb-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span className="text-neutral-500 ml-4">aegis-12/enclave-gateway</span>
                </div>
                
                {logs.length === 0 ? (
                    <span className="text-neutral-600">Waiting for transaction intent...</span>
                ) : (
                    <div className="flex flex-col space-y-2">
                        {logs.map((log, index) => (
                            <span 
                                key={index} 
                                className={`${log.includes('❌') ? 'text-red-400' : log.includes('✅') || log.includes('📜') ? 'text-emerald-400' : 'text-neutral-300'}`}
                            >
                                {log}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    </main>
  );
}
