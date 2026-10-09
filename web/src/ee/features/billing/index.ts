// Litefuse has no EE billing package. The evaluator UI only needs an upgrade
// prompt, which we already ship as a plain component, so this door re-points to
// it instead of pulling in upstream's billing graph.
// See docs/jev as judge/现状-改动与差异总览.md for the cost/benefit framing.
export { SupportOrUpgradePage } from "@/src/components/SupportOrUpgradePage";
