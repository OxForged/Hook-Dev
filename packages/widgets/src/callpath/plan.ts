// SPDX-License-Identifier: MIT
/**
 * Action-plan encoding.
 *
 * A periphery call is a list of `(actionId, abi-encoded params)` pairs executed
 * inside one vault lock. The pairs are transported as `abi.encode(bytes actions,
 * bytes[] params)`, where `actions` is the raw concatenation of one-byte ids.
 *
 * `CalldataDecoder.decodeActionsRouterParams` requires *strict* encoding - the
 * first word must be exactly `0x40` - which is what a standard two-parameter ABI
 * encoding produces. Do not hand-roll this.
 */

import { concatHex, encodeAbiParameters, type Hex } from "viem";

/** One step of a plan. */
export interface PlannedAction {
  readonly action: number;
  readonly params: Hex;
  /** Debug label, never encoded. */
  readonly label: string;
}

/** An ordered list of actions destined for one vault lock. */
export class ActionPlan {
  readonly #steps: PlannedAction[] = [];

  /** Appends an action. Order is the execution order. */
  add(action: number, params: Hex, label: string): this {
    if (!Number.isInteger(action) || action < 0 || action > 0xff) {
      throw new RangeError(`action id must fit in one byte: ${action}`);
    }
    this.#steps.push({ action, params, label });
    return this;
  }

  /** The planned steps, in order. */
  get steps(): readonly PlannedAction[] {
    return this.#steps;
  }

  /** Human-readable trace of the plan, used in dev tooling and error messages. */
  describe(): string {
    return this.#steps
      .map((step, index) => `${index}. ${step.label} (0x${step.action.toString(16).padStart(2, "0")})`)
      .join("\n");
  }

  /** `abi.encode(bytes actions, bytes[] params)`. */
  encode(): Hex {
    if (this.#steps.length === 0) {
      throw new Error("[@latchprotocol/widgets] cannot encode an empty action plan");
    }
    const actions = concatHex(
      this.#steps.map((step) => `0x${step.action.toString(16).padStart(2, "0")}` as Hex),
    );
    const params = this.#steps.map((step) => step.params);
    return encodeAbiParameters(
      [
        { name: "actions", type: "bytes" },
        { name: "params", type: "bytes[]" },
      ],
      [actions, params],
    );
  }
}

/** Convenience constructor. */
export function plan(): ActionPlan {
  return new ActionPlan();
}
