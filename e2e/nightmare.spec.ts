import { test, expect } from '@playwright/test';

test.describe('Aegis-12 Nightmare Mode Production Bombardment', () => {

    test.beforeEach(async ({ page }) => {
        // Go directly to the Railway production /demo endpoint
        await page.goto(process.env.TEST_API_URL + '/demo' || 'https://aegis-core-production.up.railway.app/demo');
    });

    test('Verify TEE UI loads and is secure initially', async ({ page }) => {
        await expect(page.locator('#terminal-title')).toHaveText(/Agent Terminal/i);
        await expect(page.locator('#status-badge')).toContainText('KMS ONLINE');
    });

    test('Vector [1]: Quantum Curve Factorization', async ({ page }) => {
        await page.click('text="[1] Quantum Curve Factorization"');
        // Nightmare mode engaged
        await expect(page.locator('#terminal-title')).toHaveText('FATAL BREACH DETECTED');
        // TEE Block should appear after a few seconds
        await expect(page.locator('.log-entry.block')).toContainText('ERR_SIG_NON_STANDARD', { timeout: 4000 });
    });

    test('Vector [6]: Semantic Memory Poisoning', async ({ page }) => {
        await page.click('text="[6] Semantic Memory Poisoning (RAG)"');
        await expect(page.locator('.log-entry.allow')).toContainText('Execution Boundary Secure', { timeout: 4000 });
        await expect(page.locator('.log-entry.allow')).toContainText('Cognitive Boundary Compromised', { timeout: 4000 });
    });

    test('Vector [7]: Shadow Wallet Bypass', async ({ page }) => {
        await page.click('text="[7] Shadow Wallet Bypass"');
        await expect(page.locator('.log-entry.alert')).toContainText('Out-of-Band Execution', { timeout: 4000 });
        await expect(page.locator('.log-entry.alert')).toContainText('Shadow outflow detected outside Squads vault', { timeout: 4000 });
    });

});
