# CLAUDE.md — ZoneShift

This file provides guidance to Claude Code when working with this project.

## Project Overview

**ZoneShift** is a web-based DNS migration verification tool for MSP use. It helps migrate DNS zones from GoDaddy (or other providers) to Constellix by:
1. Parsing zone file exports (BIND format)
2. Reformatting them for Constellix import (removing SOA/NS records)
3. Verifying records match between old and new nameservers before NS cutover

**Context:** This tool is for Umetech MSP (Jeremiah). He migrates client DNS from GoDaddy to Constellix and needs to reformat exports and verify all records match before updating NS at the registrar.

## Tech Stack

- **Frontend:** React + TypeScript + Vite (single-page app, no backend)
- **DNS Lookups:** DNS-over-HTTPS (Google: `https://dns.google/resolve`)
- **Deployment:** Azure Static Web App via GitHub Actions
- **Domain:** `zoneshift.umetech.com` (or subdomain of Umetech Azure setup)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Vite)
npm run build        # Build to dist/
npm run lint         # ESLint check
```

## Project Structure

```
zoneshift/
├── .github/
│   └── workflows/
│       └── azure-static-web-apps.yml
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── ZoneFileImport.tsx      # Step 1: drag-drop or paste zone file
│   │   ├── RecordTable.tsx          # Parsed records display table
│   │   ├── FormattedOutput.tsx      # Step 2: Constellix-ready output
│   │   ├── NSLookup.tsx             # Step 3: Current NS detection
│   │   ├── ComparisonTable.tsx      # Step 4: Old vs New NS comparison
│   │   └── StepIndicator.tsx        # Wizard step progress
│   ├── utils/
│   │   ├── zoneParser.ts            # BIND zone file parser
│   │   ├── dnsLookup.ts             # DNS-over-HTTPS queries
│   │   └── recordComparison.ts      # Record matching/comparison logic
│   └── styles/
│       └── theme.css
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── vite.config.ts
└── CLAUDE.md
```

## Core Features

### 1. Zone File Import & Parsing
- Accept GoDaddy DNS zone file export (drag-drop or paste)
- Parse BIND-format zone files
- Extract domain name from `$ORIGIN` directive
- Parse all record types: A, AAAA, MX, TXT, CNAME, NS, SRV, CAA
- **Automatically remove for Constellix import:**
  - SOA record (including multi-line with parentheses)
  - Root NS records (`@ IN NS ...`)
  - Header comments from GoDaddy export
- Display parsed records in a table for review

### 2. Constellix-Formatted Output
- Generate clean BIND-format zone file ready for Constellix import
- Keep `$ORIGIN` directive
- Group records by type with section comments
- Provide: Copy to clipboard button, Download as .txt file button
- **Constellix requirements:** BIND9 format, no SOA, no root NS records

### 3. Current NS Lookup
- Auto-detect current authoritative nameservers for the domain
- Display current NS records
- Use DNS-over-HTTPS (Google: `https://dns.google/resolve`) for lookups

### 4. DNS Comparison Tool
- Input field for new Constellix nameserver (e.g., `ns11.constellix.com`)
- Query both old NS and new NS for all record types
- Build comparison table showing:
  - Record name, type, TTL
  - Value from old NS / Value from new NS
  - Match status: Match, Mismatch, Missing, New
- Highlight mismatches prominently
- Show summary: X of Y records match

### 5. Records to Query
For comprehensive comparison, query these subdomains (plus any found in zone file):
- `@` (root), `www`, `mail`, `ftp`
- `cpanel`, `webmail`, `webdisk`, `whm` (hosting records)
- `autodiscover` (Exchange/M365)
- `enterpriseenrollment`, `enterpriseregistration` (Intune)
- `selector1._domainkey`, `selector2._domainkey` (DKIM)
- `_dmarc`
- Query types: A, AAAA, MX, TXT, CNAME, NS

## DNS-over-HTTPS Implementation

```typescript
const dohLookup = async (domain: string, type: string) => {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/dns-json' }
  });
  const data = await response.json();
  return data.Answer || [];
};
```

## Zone File Parsing Notes
- Handle multi-line SOA records (track parentheses depth)
- Normalize record values for comparison (remove trailing dots, quotes, lowercase)
- Handle TXT record concatenation (multiple quoted strings)
- Skip comment-only lines but preserve record type section comments for output

## UI/UX Requirements
- **Theme:** Dark, professional MSP utility aesthetic
- **Font:** Monospace (JetBrains Mono, Fira Code, or similar)
- **Colors:** Dark background (#0d1117), green for success (#238636), red for errors (#da3633), blue for info (#1f6feb)
- **Layout:** Step-by-step wizard flow:
  1. Import Zone File
  2. Review & Download Formatted Output
  3. Lookup Current Nameservers
  4. Run Comparison
- Progress indicators for DNS lookups
- Mobile-responsive

## Step Flow

```
Step 1: Import
  [Drag & Drop Zone File] or [Paste Zone Content]
          ↓
Step 2: Review & Export
  Domain: almanufacturing.com
  Records Found: 24
  [Formatted zone file preview]
  [Copy to Clipboard] [Download .txt]
          ↓
Step 3: Current Nameservers
  [Lookup Current NS]
  Current NS: ns57.domaincontrol.com, ns58.domaincontrol.com
          ↓
Step 4: Compare DNS Records
  New Constellix NS: [ns11.constellix.com]
  [Run Comparison]
  Comparison table with match/mismatch indicators
  Summary: 24/24 records match — Ready for NS cutover!
```

## Sample GoDaddy Zone File (for testing)

```
; Domain: almanufacturing.com
; Exported (y-m-d hh:mm:ss): 2026-01-28 10:58:45
;
; This file is intended for use for informational and archival
; purposes ONLY and MUST be edited before use on a production
; DNS server.

$ORIGIN almanufacturing.com.

; SOA Record
@	3600	 IN 	SOA	ns57.domaincontrol.com.	dns.jomax.net. (
					2026012105
					28800
					7200
					604800
					3600
					)

; A Record
@	600	 IN 	A	65.181.116.249
cpanel	600	 IN 	A	65.181.116.249
webmail	600	 IN 	A	65.181.116.249

; TXT Record
@	3600	 IN 	TXT	"v=spf1 +a +mx include:spf.protection.outlook.com ~all"
@	3600	 IN 	TXT	"v=verifydomain MS=6933447"

; CNAME Record
autodiscover	3600	 IN 	CNAME	autodiscover.outlook.com.
www	3600	 IN 	CNAME	@

; NS Record
@	3600	 IN 	NS	ns57.domaincontrol.com.
@	3600	 IN 	NS	ns58.domaincontrol.com.

; MX Record
@	3600	 IN 	MX	10	almanufacturing-com.p10.mxthunder.com.
@	3600	 IN 	MX	20	almanufacturing-com.p20.mxthunder.net.
```

## Expected Constellix Output (after parsing)

```
$ORIGIN almanufacturing.com.
; A Record
@	600	 IN 	A	65.181.116.249
cpanel	600	 IN 	A	65.181.116.249
webmail	600	 IN 	A	65.181.116.249
; TXT Record
@	3600	 IN 	TXT	"v=spf1 +a +mx include:spf.protection.outlook.com ~all"
@	3600	 IN 	TXT	"v=verifydomain MS=6933447"
; CNAME Record
autodiscover	3600	 IN 	CNAME	autodiscover.outlook.com.
www	3600	 IN 	CNAME	@
; MX Record
@	3600	 IN 	MX	10	almanufacturing-com.p10.mxthunder.com.
@	3600	 IN 	MX	20	almanufacturing-com.p20.mxthunder.net.
```

SOA and root NS records are removed, header comments stripped.

## Deployment

Deploy as Azure Static Web App:
- Use GitHub Actions for CI/CD
- No API/backend needed (all client-side)
- GitHub repo: `umetech/zoneshift` (or appropriate org)

## Initial Setup Commands

```bash
npm create vite@latest . -- --template react-ts
npm install
git init
gh repo create umetech/zoneshift --public --source=. --remote=origin
```

## Related Projects

- **UMT-HUD** (`/root/projects/UMT-HUD`) — Mission Control dashboard at https://cloudops.umetech.net — has a "Tools" menu linking to this tool
