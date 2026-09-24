# mcp-cms-open-payments

CMS Open Payments, with annual dataset discovery through the official DKAN API.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `open_payments_top_companies` | Rank the drug and device manufacturers that paid US physicians and teaching hospitals the most in a program year — the "who spends the most on doctors" question. Returns each company with its total US dollars, payment count and how many distinct recipients it reached, ordered by spend. CMS publishes no aggregate and its live API cannot group over the 14-million-row payment table, so this reads a summary computed offline; the response states the program year and when the summary was refreshed. Payments are disclosures of transfers of value, not evidence of wrongdoing. |
| `open_payments_search` | THE source for pharma/device industry money to doctors — "payments from manufacturers to physicians", "which drug companies paid this doctor", "Sunshine Act data", "industry payments to hospitals". Search one CMS Open Payments program-year dataset using structured recipient, company, product, geography, payment-nature, and amount filters. CAPABILITY LIMIT, state it rather than guessing: this source can look up and filter but CANNOT rank ALL manufacturers by total spend ("which manufacturer paid the most" is not computable live — the 14M-row aggregation times out upstream); answer those by saying so and offering a named-company lookup (open_payments_company) instead. CMS publishes company-reported relationships; a payment does not imply wrongdoing or a conflict. |
| `open_payments_physician` | Find CMS Open Payments records for a physician/non-physician practitioner by exact NPI in one program year. Returns the authoritative total match count plus a bounded payment sample; reported relationships do not imply misconduct. If you have a name rather than an NPI, resolve it first against the NPPES registry (npi_individual in the clinicaltables pack), or use open_payments_search with recipient_last_name + recipient_first_name. |
| `open_payments_company` | Search payments reported by a manufacturer or GPO in one CMS Open Payments program year. Company matching is a case-insensitive substring and may combine similarly named legal entities. |
| `open_payments_product` | Search general-payment records associated with a named drug, biologic, device, or medical supply across all five CMS product slots. Product association is reporting-entity supplied and does not prove the payment was exclusively for that product. |
| `open_payments_research` | Search CMS research-payment records by company, recipient NPI, study name, or state for one program year. Amounts may represent funding routed through an institution and should not automatically be attributed as personal compensation. |
| `open_payments_recipient_history` | Build a cross-year CMS Open Payments history for an exact recipient NPI. Returns authoritative annual match counts plus bounded samples; sampled dollar totals are explicitly not full-dataset totals. |
| `open_payments_company_history` | Build a cross-year CMS Open Payments history for a company-name substring. Annual counts are authoritative for that query; dollar figures cover only the returned bounded sample and company aliases may split or combine legal entities. |
| `open_payments_product_history` | Build a cross-year general-payment history for a reported product-name substring across CMS product slots. Product association is reporter-supplied; sample dollar amounts are not complete annual totals. |
| `open_payments_compare_companies` | Compare 2–5 company-name queries across CMS Open Payments program years using authoritative match counts and clearly labeled bounded samples. This does not compare complete spend unless every matching row fits in the sample. |
| `open_payments_nature_breakdown` | Break down the bounded payment sample for one recipient, company, or product across years by reported nature of payment. Counts and dollars in the breakdown are sample statistics; annual total_matches remains the authoritative query count. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "cms-open-payments": {
      "url": "https://gateway.pipeworx.io/cms-open-payments/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/cms-open-payments/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/open_payments_top_companies \
  -H 'Content-Type: application/json' \
  -d '{"limit":3}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/open_payments_top_companies`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "cms-open-payments": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-cms-open-payments"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-cms-open-payments
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Cms Open Payments data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
