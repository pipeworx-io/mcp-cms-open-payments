interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * CMS Open Payments, with annual dataset discovery through the official DKAN API.
 */

const BASE = 'https://openpaymentsdata.cms.gov/api/1';
const MAX_BYTES = 4_000_000;
type PaymentType = 'General' | 'Research' | 'Ownership';

const paymentListSchema = {
  type: 'object', properties: {
    program_year: { type: 'number' }, payment_type: { type: 'string' },
    total_matches: { type: 'number' }, returned: { type: 'number' },
    payments: { type: 'array', items: { type: 'object' } },
    dataset: { type: 'object' }, interpretation: { type: 'string' },
  }, required: ['program_year', 'payment_type', 'total_matches', 'returned', 'payments', 'dataset', 'interpretation'],
};

const tools: McpToolExport['tools'] = [
  {
    name: 'open_payments_search',
    description: 'Search one CMS Open Payments program-year dataset using structured recipient, company, product, geography, payment-nature, and amount filters. CMS publishes company-reported relationships; a payment does not imply wrongdoing or a conflict.',
    inputSchema: { type: 'object', properties: {
      year: { type: 'number', description: 'Program year (2019-current published year; default latest).' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'], description: 'Default General.' },
      recipient_npi: { type: 'string', description: 'Exact 10-digit NPI.' },
      recipient_last_name: { type: 'string', description: 'Exact recipient last name. CMS stores names uppercase; case is normalized for you. Pair with recipient_first_name — a common surname alone matches many practitioners.' },
      recipient_first_name: { type: 'string', description: 'Exact recipient first name, to disambiguate a common surname (e.g. last_name "PATEL" + first_name "RIPAL").' },
      company: { type: 'string', description: 'Case-insensitive company-name substring.' },
      product: { type: 'string', description: 'Case-insensitive associated-product substring across all five product fields.' },
      state: { type: 'string', description: 'Exact two-letter recipient state.' },
      nature: { type: 'string', description: 'Exact nature of payment.' },
      minimum_amount: { type: 'number', description: 'Minimum reported payment in USD.' },
      limit: { type: 'number', description: 'Results (1-100, default 25).' },
      offset: { type: 'number', description: 'Pagination offset (0-10000).' },
    }},
    outputSchema: paymentListSchema,
  },
  {
    name: 'open_payments_physician',
    description: 'Find CMS Open Payments records for a physician/non-physician practitioner by exact NPI in one program year. Returns the authoritative total match count plus a bounded payment sample; reported relationships do not imply misconduct. If you have a name rather than an NPI, resolve it first against the NPPES registry (npi_individual in the clinicaltables pack), or use open_payments_search with recipient_last_name + recipient_first_name.',
    inputSchema: { type: 'object', properties: {
      npi: { type: 'string', description: 'Exact 10-digit NPI.' },
      year: { type: 'number', description: 'Program year; default latest.' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'] },
      limit: { type: 'number', description: 'Payment rows (1-100, default 50).' },
    }, required: ['npi'] },
    outputSchema: paymentListSchema,
  },
  {
    name: 'open_payments_company',
    description: 'Search payments reported by a manufacturer or GPO in one CMS Open Payments program year. Company matching is a case-insensitive substring and may combine similarly named legal entities.',
    inputSchema: { type: 'object', properties: {
      company: { type: 'string' }, year: { type: 'number' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'] },
      minimum_amount: { type: 'number' }, limit: { type: 'number' }, offset: { type: 'number' },
    }, required: ['company'] },
    outputSchema: paymentListSchema,
  },
  {
    name: 'open_payments_product',
    description: 'Search general-payment records associated with a named drug, biologic, device, or medical supply across all five CMS product slots. Product association is reporting-entity supplied and does not prove the payment was exclusively for that product.',
    inputSchema: { type: 'object', properties: {
      product: { type: 'string' }, year: { type: 'number' },
      company: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' },
    }, required: ['product'] },
    outputSchema: paymentListSchema,
  },
  {
    name: 'open_payments_research',
    description: 'Search CMS research-payment records by company, recipient NPI, study name, or state for one program year. Amounts may represent funding routed through an institution and should not automatically be attributed as personal compensation.',
    inputSchema: { type: 'object', properties: {
      year: { type: 'number' }, company: { type: 'string' }, recipient_npi: { type: 'string' },
      study: { type: 'string', description: 'Case-insensitive study-name substring.' },
      state: { type: 'string' }, minimum_amount: { type: 'number' },
      limit: { type: 'number' }, offset: { type: 'number' },
    }},
    outputSchema: paymentListSchema,
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'open_payments_search': return searchPayments(args);
    case 'open_payments_physician':
      return searchPayments({ ...args, recipient_npi: requiredString(args, 'npi') });
    case 'open_payments_company':
      return searchPayments({ ...args, company: requiredString(args, 'company') });
    case 'open_payments_product':
      return searchPayments({ ...args, payment_type: 'General', product: requiredString(args, 'product') });
    case 'open_payments_research':
      return searchPayments({ ...args, payment_type: 'Research' });
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

interface Condition { property?: string; value?: string | number; operator?: string; groupOperator?: string; conditions?: Condition[] }

async function searchPayments(args: Record<string, unknown>) {
  const year = yearArg(args.year);
  const type = paymentType(args.payment_type);
  const dataset = await resolveDataset(year, type);
  const conditions: Condition[] = [];
  addExact(conditions, 'covered_recipient_npi', stringArg(args.recipient_npi));
  addExact(conditions, 'covered_recipient_last_name', stringArg(args.recipient_last_name)?.toUpperCase());
  addExact(conditions, 'covered_recipient_first_name', stringArg(args.recipient_first_name)?.toUpperCase());
  addContains(conditions, 'applicable_manufacturer_or_applicable_gpo_making_payment_name', stringArg(args.company));
  addExact(conditions, 'recipient_state', stringArg(args.state)?.toUpperCase());
  addExact(conditions, 'nature_of_payment_or_transfer_of_value', stringArg(args.nature));
  if (args.minimum_amount != null) conditions.push({
    property: 'total_amount_of_payment_usdollars', value: numberArg(args.minimum_amount, 'minimum_amount'), operator: '>=',
  });
  const product = stringArg(args.product);
  if (product) conditions.push({
    groupOperator: 'or',
    conditions: Array.from({ length: 5 }, (_, i) => ({
      property: `name_of_drug_or_biological_or_device_or_medical_supply_${i + 1}`,
      value: product, operator: 'contains',
    })),
  });
  const study = stringArg(args.study);
  if (study) addContains(conditions, 'name_of_study', study);
  if (!conditions.length) throw new Error('Provide at least one search filter.');

  const body = {
    resources: [{ id: dataset.distribution_id, alias: 't' }],
    conditions,
    limit: intArg(args.limit, 25, 1, 100),
    offset: intArg(args.offset, 0, 0, 10_000),
    schema: false,
    keys: true,
    count: true,
  };
  const response = await fetch(`${BASE}/datastore/query`, {
    method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await boundedJson(response, 'CMS Open Payments query');
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return {
    program_year: year,
    payment_type: type,
    total_matches: Number(payload.count ?? rows.length),
    returned: rows.length,
    payments: rows.map(projectPayment),
    dataset,
    interpretation: interpretation(type),
  };
}

async function resolveDataset(year: number, type: PaymentType) {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('fulltext', 'payments');
  url.searchParams.set('page-size', '100');
  url.searchParams.set('facets', '0');
  const payload = await boundedJson(await fetch(url, { headers: { Accept: 'application/json' } }), 'CMS metadata search');
  const datasets = payload.results && typeof payload.results === 'object' ? Object.values(payload.results) as Array<Record<string, any>> : [];
  const title = `${year} ${type} Payment Data`;
  const match = datasets.find((row) => row.title === title);
  const distribution = match?.['%Ref:distribution']?.[0]?.identifier;
  if (!match || !distribution) throw new Error(`CMS Open Payments ${type.toLowerCase()} dataset for ${year} was not found.`);
  return {
    title: match.title,
    dataset_id: match.identifier,
    distribution_id: distribution,
    modified: match.modified,
    source_url: `https://openpaymentsdata.cms.gov/datasets/${match.identifier}`,
  };
}

function projectPayment(r: Record<string, any>) {
  const products = Array.from({ length: 5 }, (_, i) => i + 1).map((i) => compact({
    name: r[`name_of_drug_or_biological_or_device_or_medical_supply_${i}`],
    type: r[`indicate_drug_or_biological_or_device_or_medical_supply_${i}`],
    category: r[`product_category_or_therapeutic_area_${i}`],
    ndc: r[`associated_drug_or_biological_ndc_${i}`],
    device_pdi: r[`associated_device_or_medical_supply_pdi_${i}`],
  })).filter((p) => Object.keys(p).length);
  return compact({
    record_id: r.record_id, program_year: numberOrNull(r.program_year),
    recipient: compact({
      type: r.covered_recipient_type, profile_id: r.covered_recipient_profile_id,
      npi: r.covered_recipient_npi,
      name: [r.covered_recipient_first_name, r.covered_recipient_middle_name, r.covered_recipient_last_name].filter(Boolean).join(' '),
      teaching_hospital: r.teaching_hospital_name, specialty: r.covered_recipient_specialty_1,
      city: r.recipient_city, state: r.recipient_state,
    }),
    company: r.applicable_manufacturer_or_applicable_gpo_making_payment_name,
    submitting_company: r.submitting_applicable_manufacturer_or_applicable_gpo_name,
    amount_usd: numberOrNull(r.total_amount_of_payment_usdollars),
    payment_date: cmsDate(r.date_of_payment), nature: r.nature_of_payment_or_transfer_of_value,
    form: r.form_of_payment_or_transfer_of_value, products,
    disputed: r.dispute_status_for_publication, ownership_interest: r.physician_ownership_indicator,
    study_name: r.name_of_study,
  });
}

async function boundedJson(response: Response, label: string): Promise<Record<string, any>> {
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error(`${label} exceeded size limit`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`${label} exceeded size limit`);
  return JSON.parse(text);
}
function paymentType(value: unknown): PaymentType {
  const result = stringArg(value) ?? 'General';
  if (!['General', 'Research', 'Ownership'].includes(result)) throw new Error('payment_type must be General, Research, or Ownership');
  return result as PaymentType;
}
function yearArg(value: unknown): number {
  const latest = new Date().getUTCFullYear() - 1;
  const year = value == null ? latest : Number(value);
  if (!Number.isInteger(year) || year < 2019 || year > latest) throw new Error(`year must be 2019-${latest}`);
  return year;
}
function addExact(list: Condition[], property: string, value: string | null | undefined) {
  if (value) list.push({ property, value, operator: '=' });
}
function addContains(list: Condition[], property: string, value: string | null | undefined) {
  if (value) list.push({ property, value, operator: 'contains' });
}
function interpretation(type: PaymentType) {
  return type === 'Research'
    ? 'CMS publishes data attested to by reporting entities. Research payments may be routed through institutions and do not necessarily represent personal compensation or wrongdoing.'
    : 'CMS publishes data attested to by reporting entities. A disclosed payment or financial relationship does not necessarily indicate a conflict of interest or wrongdoing.';
}
function cmsDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}
function numberOrNull(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function numberArg(value: unknown, key: string): number { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be non-negative`); return n; }
function requiredString(args: Record<string, unknown>, key: string): string { const v = stringArg(args[key]); if (!v) throw new Error(`${key} is required`); return v; }
function stringArg(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function intArg(value: unknown, fallback: number, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback; }
function compact<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length))) as T; }

export default { tools, callTool, meter: { credits: 4 } } satisfies McpToolExport;
