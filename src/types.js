"use strict";
// types.ts
// Ported from pdp-protocol/src/vera/types.ts for Aegis TEE Enclave
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentPurpose = exports.TrustTier = void 0;
var TrustTier;
(function (TrustTier) {
    TrustTier["T1"] = "T1";
    TrustTier["T2"] = "T2";
    TrustTier["T3"] = "T3";
    TrustTier["T4"] = "T4";
})(TrustTier || (exports.TrustTier = TrustTier = {}));
var AgentPurpose;
(function (AgentPurpose) {
    AgentPurpose["DATA_ANALYSIS"] = "data_analysis";
    AgentPurpose["CUSTOMER_SERVICE"] = "customer_service";
    AgentPurpose["FINANCIAL_OPERATIONS"] = "financial_operations";
})(AgentPurpose || (exports.AgentPurpose = AgentPurpose = {}));
