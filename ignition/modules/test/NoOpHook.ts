import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys noop hyperlane post dispatch hook
const NoOpHyperlaneHookModule = buildModule("NoOpHyperlaneHookModule", (m) => {
  const noOpHook = m.contract("NoOpHook", []);

  return { noOpHook };
});

export default NoOpHyperlaneHookModule;
