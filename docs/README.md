# HyperStaking Documentation

## Overview

This directory contains documentation for the HyperStaking protocol.

---

## Core Documentation

### Development Guide

[DEVELOPMENT.md](./DEVELOPMENT.md)

Guide for developing and testing the HyperStaking protocol, including:

- Project architecture and design patterns
- Environment setup and configuration
- Testing framework
- Creating custom strategies
- Development workflow and commands

**Use this guide for**: Local development, writing tests, creating strategies, and understanding the codebase.

### Deployment Guide

[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

Step-by-step guide for deploying HyperStaking across multiple chains:

- Pre-deployment checklist
- Deployment procedures (Lumia and origin chains)
- Cross-chain configuration with Hyperlane
- Strategy deployment
- Test deployment walkthrough
- Emergency procedures

**Use this guide for**: Deploying to testnets/mainnet, configuring cross-chain messaging, and managing deployments.

---

## Specification

### Protocol Specification

[spec/spec.pdf](./spec/spec.pdf)

Detailed technical specification of the HyperStaking protocol, covering:

- System architecture and design decisions
- Contract interfaces and data structures
- Cross-chain messaging flows
- Security considerations

---

## API Documentation

### Solidity API Documentation

Generate API documentation from contract NatSpec comments:

```bash
npm run docgen
```

The generated API documentation will be saved in `docs/index.md`.

**What's included**:

- Contract interfaces and functions
- Parameter descriptions
- Return values
- Events and errors
- Usage examples from NatSpec comments

---

## Quick Links

- **Development**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Deployment**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- **Specification**: [spec/spec.pdf](./spec/spec.pdf)
- **API Reference**: Run `npm run docgen` to generate

---

Last Updated: January 2026
