# Orglens Privacy Policy

_Last updated: July 2026_

Orglens is a read-only Chrome extension for analyzing Salesforce org metadata.

## What Orglens accesses

- **Your existing Salesforce session cookie (`sid`)** on `*.salesforce.com`, `*.force.com`, and `*.salesforce-setup.com` domains. This is used solely to authenticate read-only API requests to your own Salesforce org. Orglens never asks for, collects, or stores your credentials.
- **The URL of your active browser tab**, only to detect which Salesforce org to connect to and to enable the toolbar icon on Salesforce pages.

## What Orglens does with data

- All API requests go **exclusively to your own Salesforce instance**. Orglens communicates with no other server of any kind.
- Metadata query results are cached **in memory for the current session only** and are discarded when the extension closes.
- Orglens issues **read-only (GET) requests only**. It contains no code path that creates, updates, deletes, or deploys anything in your org.

## What Orglens does NOT do

- No data is collected, logged, or transmitted to the developer or any third party.
- No analytics, tracking, or advertising of any kind.
- No data is sold or shared. There is nothing to sell or share — nothing leaves your browser except requests to your own Salesforce org.

## Changes

Any change to this policy will be published at this URL before taking effect.

## Contact

Questions: open an issue on this repository.
