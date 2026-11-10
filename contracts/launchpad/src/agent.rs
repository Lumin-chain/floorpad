//! Per-token AI agent. The agent operator posts on-chain; after graduation every
//! post is paid from the agent budget that holders vote for each epoch. No
//! budget, no posts: the agent is only as loud as its holders fund it.
use crate::math;
use crate::*;
use near_sdk::json_types::U128;

/// Storage deposit the agent attaches per post.
pub const POST_DEPOSIT: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

#[near]
impl Contract {
    #[payable]
    pub fn agent_post(&mut self, token_id: AccountId, text: String) -> u32 {
        require!(env::attached_deposit().as_yoctonear() >= POST_DEPOSIT, "ERR_POST_DEPOSIT");
        require!(!text.is_empty() && text.len() <= 1000, "ERR_POST_LEN");
        let idx = self.idx_of(&token_id);
        let cost_near = self.config.agent_post_cost.as_yoctonear();
        let agent = env::predecessor_account_id();
        let tok = self.tok_mut(idx);
        require!(agent == tok.agent_account, "ERR_NOT_AGENT");
        let mut paid = 0;
        if tok.grad_stage == GradStage::Graduated && tok.last_linear_price > 0 && cost_near > 0 {
            paid = math::near_to_shares_conservative(cost_near, tok.last_linear_price);
            require!(tok.agent_budget_shares >= paid, "ERR_AGENT_BUDGET_EMPTY");
            tok.agent_budget_shares -= paid;
        }
        let slot = tok.post_count % MAX_POSTS;
        let n = tok.post_count;
        tok.post_count += 1;
        self.posts.insert((idx, slot), Post { ts: now_secs(), text, paid: U128(paid) });
        self.credit_linear(&agent, paid);
        n
    }
}
