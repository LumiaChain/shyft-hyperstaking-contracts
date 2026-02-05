# Hyperlane test deployment files

This directory contains Hyperlane config files exported from `.hyperlane/chains/<chain-name>` for a local/test deployment.

Files:

- `metadata.yaml` – chain metadata used by Hyperlane tooling (chain id, RPCs, etc.)
- `addresses.yaml` – deployed Hyperlane contract addresses for this chain (Mailbox, ISM, etc.)

## How to use

To test cross-chain messaging with this deployment, copy these files into the Hyperlane working directory:

```bash
cp -r ./hyperlane/chains/<chain-name>/* ~/.hyperlane/chains/<chain-name>/
```
