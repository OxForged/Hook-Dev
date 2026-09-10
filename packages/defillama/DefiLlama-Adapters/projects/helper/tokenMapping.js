/**
 * LOCAL HARNESS STUB - do not submit. Upstream this is
 * DefiLlama-Adapters/projects/helper/tokenMapping.js.
 *
 * Only the two exports the Latch TVL adapter touches. `nullAddress` is the zero
 * address (ADDRESSES.null upstream); it is both how native currency appears in a
 * Latch pool key and the "no hook" sentinel in an Initialize log.
 */
const nullAddress = "0x0000000000000000000000000000000000000000";

/** Sentinels other chains use for their native coin. Upstream treats these as native too. */
const gasTokens = [
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000001010",
];

module.exports = { nullAddress, gasTokens };
