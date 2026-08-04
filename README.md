# mcp-cms-open-payments

CMS Open Payments, with annual dataset discovery through the official DKAN API.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `open_payments_search` | Search one CMS Open Payments program-year dataset using structured recipient, company, product, geography, payment-nature, and amount filters. CMS publishes company-reported relationships; a payment does not imply wrongdoing or a conflict. |
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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Cms Open Payments data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
