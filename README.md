# Orius Network

**Distributed Compute Network** | Transform your browser into a compute node and earn $Orius tokens on Solana.

## Overview

Orius Network is a decentralized computing platform that harnesses idle browser resources for distributed matrix operations and cryptographic computations. Contributors earn $Orius tokens (Token-2022 on Solana mainnet) based on verified computational work.

## Quick Start

### Chrome Installation

1. Download the extension folder
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the extension folder
5. The Orius icon appears in your toolbar

### Firefox Installation

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** > **Load Temporary Add-on**
3. Select the `manifest.json` from the `firefox-extension/` folder

## Features

- **Compute Node Toggle** - Enable/disable compute contribution with visual feedback
- **Real-Time Metrics** - Session time, compute score, earnings tracking
- **Token Claims** - Claim earned $Orius to your Solana wallet (100 minimum)
- **WebGPU Acceleration** - GPU-accelerated matrix operations when available
- **Device Security** - Wallet bound to device for enhanced security

## Architecture

```
orius-network/
├── src/
│   ├── index.js              # Main server entry
│   ├── api/routes.js         # REST API endpoints
│   ├── compute/taskGenerator.js
│   ├── queue/taskQueue.js
│   ├── verification/verifier.js
│   ├── models/schema.sql
│   └── utils/
├── manifest.json             # Chrome Extension Manifest V3
├── popup.html                # Extension UI
├── popup.js                  # Main controller
├── compute-engine.js         # WebGPU/WASM compute engine
├── task-client.js            # Server communication
├── background.js             # Service worker
└── firefox-extension/        # Firefox-specific files
```

## Token Economics

| Parameter | Value |
|-----------|-------|
| Token | $Orius (Token-2022) |
| Mint Address | B1sPn76LWSWRnxSz8ES8TSnrohvBzTaKU4fFJcJBpump |
| Minimum Claim | 100 $Orius |
| Maximum Claim | 10,000 $Orius |
| Daily Cap | 8,000 $Orius |

## API Endpoints

### Core APIs
- `POST /api/register` - Register wallet with device
- `POST /api/heartbeat` - Report activity
- `GET /api/balance/:wallet` - Get wallet balance
- `POST /api/claim` - Claim tokens

### Compute APIs
- `POST /api/compute/capabilities` - Register node capabilities
- `POST /api/compute/task/request` - Request compute task
- `POST /api/compute/task/submit` - Submit task result

### Analytics APIs
- `GET /api/analytics/network` - Network statistics
- `GET /api/analytics/live` - Live activity data
- `GET /api/data/export` - Full data export

## Security

- Device-bound wallet prevents unauthorized transfers
- WebGPU sandboxed execution
- Result verification with redundancy checks
- Trust scoring system for node reliability

## Links

- Website: [https://orius.io](https://orius.io)
- Dashboard: [https://ai.orius.io](https://ai.orius.io)
- Privacy Policy: [privacy-policy.html](privacy-policy.html)

---

**Version:** 2.0.0 | **License:** MIT | **Developed by Orius Team**
