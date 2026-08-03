interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
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
  {
    name: 'open_payments_recipient_history',
    description: 'Build a cross-year CMS Open Payments history for an exact recipient NPI. Returns authoritative annual match counts plus bounded samples; sampled dollar totals are explicitly not full-dataset totals.',
    inputSchema: { type: 'object', properties: {
      npi: { type: 'string' }, from_year: { type: 'number' }, to_year: { type: 'number' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'] },
      sample_per_year: { type: 'number', description: 'Rows per year (1-100, default 25).' },
    }, required: ['npi'] },
    outputSchema: historySchema(),
  },
  {
    name: 'open_payments_company_history',
    description: 'Build a cross-year CMS Open Payments history for a company-name substring. Annual counts are authoritative for that query; dollar figures cover only the returned bounded sample and company aliases may split or combine legal entities.',
    inputSchema: { type: 'object', properties: {
      company: { type: 'string' }, from_year: { type: 'number' }, to_year: { type: 'number' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'] }, sample_per_year: { type: 'number' },
    }, required: ['company'] },
    outputSchema: historySchema(),
  },
  {
    name: 'open_payments_product_history',
    description: 'Build a cross-year general-payment history for a reported product-name substring across CMS product slots. Product association is reporter-supplied; sample dollar amounts are not complete annual totals.',
    inputSchema: { type: 'object', properties: {
      product: { type: 'string' }, company: { type: 'string' }, from_year: { type: 'number' },
      to_year: { type: 'number' }, sample_per_year: { type: 'number' },
    }, required: ['product'] },
    outputSchema: historySchema(),
  },
  {
    name: 'open_payments_compare_companies',
    description: 'Compare 2–5 company-name queries across CMS Open Payments program years using authoritative match counts and clearly labeled bounded samples. This does not compare complete spend unless every matching row fits in the sample.',
    inputSchema: { type: 'object', properties: {
      companies: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
      from_year: { type: 'number' }, to_year: { type: 'number' },
      payment_type: { type: 'string', enum: ['General', 'Research', 'Ownership'] }, sample_per_year: { type: 'number' },
    }, required: ['companies'] },
    outputSchema: { type: 'object', properties: {
      companies: { type: 'array', items: { type: 'object' } }, interpretation: { type: 'string' },
    }, required: ['companies', 'interpretation'] },
  },
  {
    name: 'open_payments_nature_breakdown',
    description: 'Break down the bounded payment sample for one recipient, company, or product across years by reported nature of payment. Counts and dollars in the breakdown are sample statistics; annual total_matches remains the authoritative query count.',
    inputSchema: { type: 'object', properties: {
      npi: { type: 'string' }, company: { type: 'string' }, product: { type: 'string' },
      from_year: { type: 'number' }, to_year: { type: 'number' }, sample_per_year: { type: 'number' },
    }},
    outputSchema: { type: 'object', properties: {
      years: { type: 'array', items: { type: 'object' } }, nature_breakdown: { type: 'array', items: { type: 'object' } },
      interpretation: { type: 'string' },
    }, required: ['years', 'nature_breakdown', 'interpretation'] },
  },
];

function historySchema() {
  return { type: 'object', properties: {
    years: { type: 'array', items: { type: 'object' } }, total_matches_across_years: { type: 'number' },
    sampled_records: { type: 'number' }, sampled_amount_usd: { type: 'number' },
    interpretation: { type: 'string' },
  }, required: ['years', 'total_matches_across_years', 'sampled_records', 'sampled_amount_usd', 'interpretation'] };
}

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
    case 'open_payments_recipient_history':
      return paymentHistory({ ...args, recipient_npi: requiredString(args, 'npi') });
    case 'open_payments_company_history':
      return paymentHistory({ ...args, company: requiredString(args, 'company') });
    case 'open_payments_product_history':
      return paymentHistory({ ...args, payment_type: 'General', product: requiredString(args, 'product') });
    case 'open_payments_compare_companies':
      return compareCompanies(args);
    case 'open_payments_nature_breakdown':
      return natureBreakdown(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function paymentHistory(args: Record<string, unknown>) {
  const [from, to] = yearRange(args);
  const samplePerYear = intArg(args.sample_per_year, 25, 1, 100);
  const years = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => from + i).map(async (year) => {
    const result = await searchPayments({ ...args, year, limit: samplePerYear, offset: 0 }) as Record<string, any>;
    const sampledAmount = result.payments.reduce((sum: number, p: Record<string, any>) => sum + (Number(p.amount_usd) || 0), 0);
    return {
      program_year: year, total_matches: result.total_matches, sampled_records: result.returned,
      sampled_amount_usd: sampledAmount, dataset: result.dataset, payments: result.payments,
    };
  }));
  return {
    years,
    total_matches_across_years: years.reduce((sum, y) => sum + y.total_matches, 0),
    sampled_records: years.reduce((sum, y) => sum + y.sampled_records, 0),
    sampled_amount_usd: years.reduce((sum, y) => sum + y.sampled_amount_usd, 0),
    interpretation: 'Annual total_matches values are authoritative for the stated query. sampled_amount_usd and sampled_records cover only the bounded returned rows and must not be presented as complete payment totals.',
  };
}

async function compareCompanies(args: Record<string, unknown>) {
  const companies = Array.isArray(args.companies)
    ? args.companies.map(stringArg).filter((v): v is string => Boolean(v)) : [];
  if (companies.length < 2 || companies.length > 5) throw new Error('companies must contain 2-5 non-empty names');
  const [from, to] = yearRange(args);
  if ((to - from + 1) * companies.length > 20) {
    throw new Error('company comparison is limited to 20 company-year combinations');
  }
  const results = await Promise.all(companies.map(async (company) => ({
    company, ...(await paymentHistory({ ...args, company })),
  })));
  return {
    companies: results,
    interpretation: 'Compare authoritative match counts, not sampled dollar amounts, unless sampled_records equals total_matches for every year. Company substring matching can combine aliases or similarly named legal entities.',
  };
}

async function natureBreakdown(args: Record<string, unknown>) {
  const filters = [stringArg(args.npi), stringArg(args.company), stringArg(args.product)].filter(Boolean);
  if (filters.length !== 1) throw new Error('Provide exactly one of npi, company, or product.');
  const history = await paymentHistory({
    ...args, recipient_npi: stringArg(args.npi), payment_type: 'General',
  }) as Record<string, any>;
  const buckets = new Map<string, { nature: string; sampled_records: number; sampled_amount_usd: number }>();
  for (const year of history.years) for (const payment of year.payments) {
    const nature = String(payment.nature ?? 'Unspecified');
    const bucket = buckets.get(nature) ?? { nature, sampled_records: 0, sampled_amount_usd: 0 };
    bucket.sampled_records++; bucket.sampled_amount_usd += Number(payment.amount_usd) || 0; buckets.set(nature, bucket);
  }
  return {
    years: history.years.map(({ payments: _payments, ...year }: Record<string, any>) => year),
    nature_breakdown: [...buckets.values()].sort((a, b) => b.sampled_amount_usd - a.sampled_amount_usd),
    interpretation: 'Nature breakdown counts and dollars describe only the bounded returned sample. Use each year’s total_matches for complete query counts; CMS-reported payments do not imply wrongdoing.',
  };
}

function yearRange(args: Record<string, unknown>): [number, number] {
  const latest = new Date().getUTCFullYear() - 1;
  const from = args.from_year == null ? Math.max(2019, latest - 4) : yearArg(args.from_year);
  const to = args.to_year == null ? latest : yearArg(args.to_year);
  if (from > to) throw new Error('from_year must not be after to_year');
  if (to - from > 7) throw new Error('year range may span at most 8 program years');
  return [from, to];
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
