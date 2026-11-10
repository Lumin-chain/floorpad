//! Per-token Sputnik DAO.
//!
//! At launch the DAO is created through the Sputnik factory with this
//! contract as its only council member. `finalize_dao` then (via two proposals
//! the launchpad approves itself) sets this contract as the DAO's staking
//! contract and switches to a holders-only, token-weighted policy. After that
//! the launchpad has no special powers in the DAO: ve-weight is the only vote.
//!
//! The DAO can call back into the launchpad for the token-specific powers
//! below (`dao_*`): creator milestone releases/clawback and the AI agent's
//! account and persona. It can never touch the floor vault's principal.
use crate::ext::{ext_dao, ext_factory, tgas};
use crate::*;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::{json, Value};
use near_sdk::{Promise, PromiseError};

const NS: u64 = 1_000_000_000;

#[near]
impl Contract {
    #[private]
    pub fn on_dao_created(&mut self, idx: u32, #[callback_result] r: Result<bool, PromiseError>) {
        let tok = self.tok_mut(idx);
        tok.dao_stage = if matches!(r, Ok(true)) { DaoStage::Created } else { DaoStage::Failed };
    }

    /// Permissionless: hand the freshly created DAO over to holders.
    /// Attach ~150 Tgas. The UI / keeper calls this right after launch.
    pub fn finalize_dao(&mut self, token_id: AccountId) -> Promise {
        let idx = self.idx_of(&token_id);
        let (dao_id, symbol) = {
            let t = self.tok(idx);
            require!(t.dao_stage == DaoStage::Created, "ERR_DAO_STAGE");
            (t.dao_id.clone(), t.meta.symbol.clone())
        };
        self.tok_mut(idx).dao_stage = DaoStage::Finalizing;
        let me = env::current_account_id();
        let staking_kind = json!({ "SetStakingContract": { "staking_id": me } });
        let policy_kind = json!({ "ChangePolicy": { "policy": self.holders_policy() } });
        let dao = |gas| ext_dao::ext(dao_id.clone()).with_static_gas(tgas(gas));
        dao(15)
            .add_proposal(json!({
                "description": format!("Floorpad: ve-locks of ${} are the vote weight", symbol),
                "kind": staking_kind.clone()
            }))
            .then(dao(25).act_proposal(0, "VoteApprove".into(), staking_kind, None))
            .then(dao(15).add_proposal(json!({
                "description": "Floorpad: hand the DAO to token holders".to_string(),
                "kind": policy_kind.clone()
            })))
            .then(dao(25).act_proposal(1, "VoteApprove".into(), policy_kind, None))
            .then(dao(5).get_staking_contract())
            .then(Self::ext(me).with_static_gas(tgas(5)).on_dao_finalized(idx))
    }

    #[private]
    pub fn on_dao_finalized(&mut self, idx: u32, #[callback_result] r: Result<String, PromiseError>) {
        let me = env::current_account_id().to_string();
        let tok = self.tok_mut(idx);
        tok.dao_stage = match r {
            Ok(s) if s == me => DaoStage::Ready,
            _ => DaoStage::Failed,
        };
    }

    /// Permissionless: if DAO creation or finalization failed, create a fresh DAO
    /// under a new name. Attach 200 Tgas.
    pub fn retry_dao(&mut self, token_id: AccountId) {
        let idx = self.idx_of(&token_id);
        let factory = self.config.sputnik_factory.clone();
        let tok = self.tok_mut(idx);
        require!(tok.dao_stage == DaoStage::Failed, "ERR_DAO_NOT_FAILED");
        tok.dao_attempt += 1;
        tok.dao_id = format!("{}-fp{}.{}", tok.meta.symbol.to_lowercase(), tok.dao_attempt, factory)
            .parse()
            .unwrap();
        tok.dao_stage = DaoStage::Creating;
        self.internal_create_dao(idx);
    }

    // ---------- powers the DAO can exercise via FunctionCall proposals ----------

    /// Release creator fee escrow (e.g. on a milestone vote).
    pub fn dao_release_creator(&mut self, token_id: AccountId, amount: U128) -> Promise {
        let idx = self.assert_dao(&token_id);
        let tok = self.tok_mut(idx);
        require!(amount.0 <= tok.creator_escrow, "ERR_AMOUNT");
        tok.creator_escrow -= amount.0;
        tok.creator_released += amount.0;
        Promise::new(tok.creator.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    /// Move the remaining creator escrow into the DAO treasury.
    pub fn dao_clawback_creator(&mut self, token_id: AccountId) -> Promise {
        let idx = self.assert_dao(&token_id);
        let tok = self.tok_mut(idx);
        let amount = tok.creator_escrow;
        tok.creator_escrow = 0;
        Promise::new(tok.dao_id.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    /// Change the AI agent operator and/or persona.
    pub fn dao_set_agent(
        &mut self,
        token_id: AccountId,
        agent_account: Option<AccountId>,
        persona: Option<String>,
    ) {
        let idx = self.assert_dao(&token_id);
        let tok = self.tok_mut(idx);
        if let Some(a) = agent_account {
            tok.agent_account = a;
        }
        if let Some(p) = persona {
            require!(p.len() <= 1500, "ERR_PERSONA");
            tok.agent_persona = p;
        }
    }
}

impl Contract {
    fn assert_dao(&self, token_id: &AccountId) -> u32 {
        let idx = self.idx_of(token_id);
        let t = self.tok(idx);
        require!(t.dao_stage == DaoStage::Ready, "ERR_DAO_NOT_READY");
        require!(env::predecessor_account_id() == t.dao_id, "ERR_NOT_DAO");
        idx
    }

    pub(crate) fn internal_create_dao(&mut self, idx: u32) {
        let cfg = self.config.clone();
        let (dao_id, symbol, name) = {
            let t = self.tok(idx);
            (t.dao_id.clone(), t.meta.symbol.clone(), t.meta.name.clone())
        };
        let short = dao_id.as_str().split('.').next().unwrap().to_string();
        let me = env::current_account_id();
        let args = json!({
            "config": {
                "name": short,
                "purpose": format!("Holders DAO of {} (${}) on Floorpad", name, symbol),
                "metadata": ""
            },
            "policy": {
                "roles": [{
                    "name": "launcher",
                    "kind": { "Group": [me] },
                    "permissions": ["*:*"],
                    "vote_policy": {}
                }],
                "default_vote_policy": { "weight_kind": "RoleWeight", "quorum": "0", "threshold": [1, 1] },
                "proposal_bond": "0",
                "proposal_period": (cfg.dao_proposal_period_secs * NS).to_string(),
                "bounty_bond": "0",
                "bounty_forgiveness_period": (86_400 * NS).to_string()
            }
        });
        ext_factory::ext(cfg.sputnik_factory)
            .with_attached_deposit(cfg.dao_deposit)
            .with_static_gas(tgas(150))
            .create(
                short.parse().unwrap(),
                Base64VecU8::from(near_sdk::serde_json::to_vec(&args).unwrap()),
            )
            .then(Self::ext(me).with_static_gas(tgas(5)).on_dao_created(idx)).detach();
    }

    /// Holders-only, ve-weighted policy. Sensitive actions need 2/3.
    pub(crate) fn holders_policy(&self) -> Value {
        let cfg = &self.config;
        let simple = json!({
            "weight_kind": "TokenWeight",
            "quorum": cfg.dao_quorum,
            "threshold": [1, 2]
        });
        let strict = json!({
            "weight_kind": "TokenWeight",
            "quorum": cfg.dao_quorum,
            "threshold": [2, 3]
        });
        json!({
            "roles": [
                {
                    "name": "all",
                    "kind": "Everyone",
                    "permissions": ["*:AddProposal"],
                    "vote_policy": {}
                },
                {
                    "name": "holders",
                    "kind": { "Member": "1" },
                    "permissions": [
                        "*:AddProposal", "*:VoteApprove", "*:VoteReject",
                        "*:VoteRemove", "*:Finalize"
                    ],
                    "vote_policy": {
                        "policy": strict.clone(),
                        "upgrade_self": strict.clone(),
                        "upgrade_remote": strict.clone(),
                        "set_vote_token": strict
                    }
                }
            ],
            "default_vote_policy": simple,
            "proposal_bond": cfg.dao_proposal_bond,
            "proposal_period": (cfg.dao_proposal_period_secs * NS).to_string(),
            "bounty_bond": cfg.dao_proposal_bond,
            "bounty_forgiveness_period": (86_400 * NS).to_string()
        })
    }
}
