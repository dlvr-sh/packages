# @dlvr/n8n-nodes-dlvr

The official dlvr.sh community node for n8n. Create temporary file deliveries, return clean share links, sell finished work, manage existing deliveries, and download public shares without moving file bytes through the dlvr.sh application server.

## Installation

Install `@dlvr/n8n-nodes-dlvr` from **Settings → Community Nodes** in n8n. Verified installation through the n8n node picker will become available after n8n completes its review.

Upload and account-management operations require a Pro or Team API key from [the dlvr.sh API dashboard](https://dlvr.sh/account/api/). Public share downloads do not require an API key.

## Quick example

To share a build artifact, add the **dlvr.sh** node after the step that produces binary data, select **Create Delivery**, choose the binary property, and set the retention period. The node returns the temporary share URL in `url`, ready for a later email, Slack, issue, or database step.

For an AI Agent workflow, connect the **dlvr.sh** node as a tool, select **Create Delivery**, and provide a public HTTPS source URL. The agent receives the same temporary share URL as structured output.

## Operations

- **Create Delivery** from one or all binary properties on each incoming item.
- **Create Delivery** from a public HTTPS URL. This mode works when the node is connected as an n8n AI Agent tool.
- **Get Many Deliveries**, **Get Delivery**, and **Delete Delivery** for the personal or Team scope bound to the API key.
- **Download Share** into n8n binary storage. Multi-file shares are returned as a ZIP archive.

Each incoming item creates one delivery. Selecting all binary properties creates a multi-file share containing up to 100 files. The node asks dlvr.sh for the credential's current retention options and the API remains authoritative for file size, retention, active-delivery capacity, and storage spend limits.

## File selling

Enable **Sell This Delivery** and set a USD price from $1 to $10,000. The API-key owner must already have completed Stripe Connect onboarding and accepted the current seller terms. Team members cannot sell; eligible owners and admins can. The default Stripe tax code is `txcd_10000000`.

The node creates the paid delivery but does not onboard sellers or purchase paid files. Attempting to use **Download Share** for a paid file returns a payment-required error.

## Binary and URL handling

Stored n8n binary data is read as a stream and buffered one multipart part at a time. Inline binary values are sliced in memory. Parts upload directly to signed private-storage URLs, and the dlvr API key is never sent to those URLs.

URL uploads accept public HTTPS destinations only. Literal private, loopback, link-local, credentialed, and local hostnames are rejected, and n8n's own outbound request policy remains in effect. Range-capable sources support large files. A source that ignores byte ranges must declare a size of 64 MiB or less.

## AI Agent use

The node is usable as an n8n AI Agent tool. URL upload and JSON management operations work in tool mode. Binary upload and binary download require a normal workflow connection because n8n Agent tools exchange JSON arguments rather than upstream binary items.

Keep destructive operations such as **Delete Delivery** fixed by the workflow author or protect them with n8n's human approval controls.

## Compatibility

- Minimum intended n8n version: 2.0.0
- Tested with the current n8n 2.x release
- Node.js 22.14 or newer

## Resources

- [dlvr.sh documentation](https://dlvr.sh/docs/)
- [REST API](https://dlvr.sh/docs/api/)
- [n8n community node installation](https://docs.n8n.io/integrations/community-nodes/installation/)

## License

MIT
