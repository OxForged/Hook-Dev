import { loadCompilation, findProjectRoot, readFoundryConfig, findHookContracts } from "./dist/index.js";
import { collect, getNode, getNodes, getString } from "./dist/ast/node.js";
const root = findProjectRoot("test/fixtures/src");
const comp = loadCompilation(readFoundryConfig(root), { build: false });
for (const h of findHookContracts(comp)) {
  if (h.ref.name !== "PerWalletCap" && h.ref.name !== "OracleGatedSwap") continue;
  const b = h.callbacks.get("beforeSwap");
  console.log(h.ref.name, "status", b.status, "path", b.path.map(f=>getString(f,"name")));
  const impl = b.impl;
  const params = getNodes(getNode(impl, "parameters"), "parameters");
  console.log("  params:", params.map(p=>[getString(p,"name"), getString(getNode(p,"typeDescriptions"),"typeString"), p.id]));
  const body = getNode(impl, "body");
  console.log("  IndexAccess count", collect(body, "IndexAccess").length);
  console.log("  RevertStatement count", collect(body, "RevertStatement").length);
  console.log("  FunctionCall kinds", collect(body,"FunctionCall").map(c=>[getString(c,"kind"), getString(getNode(c,"expression"),"memberName")||getString(getNode(c,"expression"),"name")]));
}
