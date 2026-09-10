/**
 * LOCAL HARNESS STUB - do not submit. Upstream this is
 * DefiLlama-Adapters/projects/helper/utils.js.
 */
function sliceIntoChunks(arr, chunkSize = 100) {
  const out = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

module.exports = { sliceIntoChunks };
