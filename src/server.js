"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const phala_entry_1 = __importDefault(require("./phala-entry"));
const fastify = (0, fastify_1.default)({ logger: true });
// Health check endpoint for dstack orchestration
fastify.get('/health', async (request, reply) => {
    return { status: 'alive' };
});
// The main POST endpoint that receives the Agent's intent
fastify.post('/enforce', async (request, reply) => {
    try {
        const payloadString = JSON.stringify(request.body);
        // Pass the payload directly to the isolated entrypoint
        const resultString = await (0, phala_entry_1.default)(payloadString);
        const result = JSON.parse(resultString);
        if (result.status === "denied") {
            reply.status(403).send(result);
        }
        else {
            reply.send(result);
        }
    }
    catch (e) {
        fastify.log.error(e);
        reply.status(500).send({
            status: "error",
            message: "Enclave processing failed",
            error: e.message
        });
    }
});
const start = async () => {
    try {
        // Must listen on 0.0.0.0 for Docker/dstack networking
        const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`[Aegis TEE] Hardware PEP listening on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
