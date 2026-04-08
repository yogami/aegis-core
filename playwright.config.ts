import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 1,
    use: {
        baseURL: process.env.TEST_API_URL || 'http://127.0.0.1:8000',
        extraHTTPHeaders: {
            'Content-Type': 'application/json',
        },
    },
    webServer: process.env.TEST_API_URL ? undefined : {
        command: 'npx tsx src/server.ts',
        port: 8000,
        timeout: 15000,
        reuseExistingServer: true,
    },
    reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
});
