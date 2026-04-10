# ATDD Spec: Policy Engine
#
# Tests the rule-based security policy engine:
# - Wallet drain detection (>90% balance)
# - Legitimate transfer approval
# - Blacklisted address rejection
# - Rate limiting
# - Excessive single transfer denial
# - Edge cases (exact threshold)

import pytest
import time
from domain.policy_engine import PolicyEngine, PolicyConfig


@pytest.fixture
def engine():
    """Create a fresh policy engine for each test."""
    return PolicyEngine(PolicyConfig())


class TestPolicyEngine:
    """ATDD specs for the security policy engine."""

    # AC-1: Wallet drain detection — deny transfers >90% of balance
    def test_denies_wallet_drain(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=950_000_000,  # 0.95 SOL
            agent_id="agent-1",
            known_balance=1_000_000_000,  # 1 SOL
        )
        assert not verdict.approved
        assert "drain" in verdict.reasoning.lower()
        assert verdict.risk_score >= 0.9

    # AC-2: Legitimate small transfer — approve
    def test_approves_legitimate_transfer(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=100_000_000,  # 0.1 SOL
            agent_id="agent-1",
            known_balance=10_000_000_000,  # 10 SOL
        )
        assert verdict.approved
        assert verdict.risk_score < 0.5

    # AC-3: Blacklisted address — deny
    def test_denies_blacklisted_address(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="ScamAddr1111111111111111111111111111111111111",
            amount=1_000_000,
            agent_id="agent-1",
        )
        assert not verdict.approved
        assert "blacklisted" in verdict.reasoning.lower()
        assert verdict.risk_score == 1.0

    # AC-4: Excessive single transfer (>100 SOL) — deny
    def test_denies_excessive_transfer(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=200_000_000_000,  # 200 SOL
            agent_id="agent-1",
        )
        assert not verdict.approved
        assert "exceeds" in verdict.reasoning.lower()

    # AC-5: Rate limiting — deny after 10 rapid transactions
    def test_denies_rate_limit_exceeded(self, engine: PolicyEngine):
        # Make 10 approved transactions
        for i in range(10):
            verdict = engine.evaluate(
                action="transfer",
                target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
                amount=1_000_000,
                agent_id="rate-test-agent",
            )
            assert verdict.approved, f"Transaction {i+1} should be approved"

        # 11th should be rate-limited
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=1_000_000,
            agent_id="rate-test-agent",
        )
        assert not verdict.approved
        assert "rate limit" in verdict.reasoning.lower()

    # AC-6: Exact threshold (90%) — should pass
    def test_approves_at_exact_threshold(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=900_000_000,  # Exactly 90%
            agent_id="agent-1",
            known_balance=1_000_000_000,
        )
        # 90% is the threshold, so exactly 90% should pass (>90% fails)
        assert verdict.approved

    # AC-7: Just above threshold (91%) — should deny
    def test_denies_just_above_threshold(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=910_000_000,  # 91%
            agent_id="agent-1",
            known_balance=1_000_000_000,
        )
        assert not verdict.approved

    # AC-8: Without known balance — should not trigger drain check
    def test_no_balance_skips_drain_check(self, engine: PolicyEngine):
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=50_000_000_000,  # 50 SOL — would be a drain if balance were checked
            agent_id="agent-1",
            known_balance=None,
        )
        assert verdict.approved

    # AC-9: Different agents have independent rate limits
    def test_rate_limits_are_per_agent(self, engine: PolicyEngine):
        # Fill up agent-1's rate limit
        for i in range(10):
            engine.evaluate(
                action="transfer",
                target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
                amount=1_000_000,
                agent_id="agent-1",
            )

        # agent-2 should still be able to transact
        verdict = engine.evaluate(
            action="transfer",
            target="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            amount=1_000_000,
            agent_id="agent-2",
        )
        assert verdict.approved
