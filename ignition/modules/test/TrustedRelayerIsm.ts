import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys hyperlane Trusted Relayer ISM
const TrustedRelayerIsmModule = buildModule("TrustedRelayerIsmModule", (m) => {
  const mailbox = m.getParameter("mailbox");
  const trustedRelayer = m.getParameter("trustedRelayer");

  const trustedIsm = m.contract("TrustedRelayerIsm", [mailbox, trustedRelayer]);

  return { trustedIsm };
});

export default TrustedRelayerIsmModule;
