// Deterministic FIXTURE dataset so the web app is demonstrable before the real pipeline output exists.
// Everything here is synthetic: CIDs are placeholders and are NOT published to IPFS.
import { DuckDBInstance } from '@duckdb/node-api';
import ngeohash from 'ngeohash';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const FIXTURE_SOURCE = 'fixture';
export const RUN_IDS = ['2026-11-06T02-00-00Z', '2026-11-08T02-00-00Z', '2026-11-10T02-00-00Z'] as const;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (base: Date, n: number): Date => new Date(base.getTime() - n * 86_400_000);
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

const AREAS = [
  {
    city: 'CHICAGO',
    lat: 41.8781,
    lon: -87.6298,
    spread: 0.12,
    zips: [
      '60601',
      '60605',
      '60607',
      '60610',
      '60614',
      '60618',
      '60622',
      '60625',
      '60630',
      '60641',
      '60647',
      '60657',
    ],
    townships: ['LAKE VIEW', 'WEST CHICAGO', 'NORTH CHICAGO', 'JEFFERSON', 'HYDE PARK', 'LAKE'],
    weight: 0.7,
  },
  {
    city: 'EVANSTON',
    lat: 42.0451,
    lon: -87.6877,
    spread: 0.025,
    zips: ['60201', '60202'],
    townships: ['EVANSTON'],
    weight: 0.15,
  },
  {
    city: 'OAK PARK',
    lat: 41.885,
    lon: -87.7845,
    spread: 0.02,
    zips: ['60301', '60302', '60304'],
    townships: ['OAK PARK'],
    weight: 0.15,
  },
] as const;
const STREETS = [
  'N CLARK ST',
  'W DIVISION ST',
  'N ASHLAND AVE',
  'W FULLERTON AVE',
  'S MICHIGAN AVE',
  'N DAMEN AVE',
  'W IRVING PARK RD',
  'N KEDZIE AVE',
  'W BELMONT AVE',
  'N WESTERN AVE',
  'S HALSTED ST',
  'W ADDISON ST',
  'RIDGE AVE',
  'ASBURY AVE',
  'SHERMAN AVE',
  'DEMPSTER ST',
  'LAKE ST',
  'OAK PARK AVE',
  'MADISON ST',
  'HARLEM AVE',
];
const LAST = [
  'SMITH',
  'JOHNSON',
  'WILLIAMS',
  'BROWN',
  'JONES',
  'GARCIA',
  'MILLER',
  'DAVIS',
  'RODRIGUEZ',
  'MARTINEZ',
  'HERNANDEZ',
  'LOPEZ',
  'GONZALEZ',
  'WILSON',
  'ANDERSON',
  'THOMAS',
  'TAYLOR',
  'MOORE',
  'JACKSON',
  'MARTIN',
  'LEE',
  'PEREZ',
  'THOMPSON',
  'WHITE',
  'HARRIS',
  'SANCHEZ',
  'CLARK',
  'RAMIREZ',
  'LEWIS',
  'ROBINSON',
  'WALKER',
  'YOUNG',
  'ALLEN',
  'KING',
  'WRIGHT',
  'SCOTT',
  'TORRES',
  'NGUYEN',
  'HILL',
  'FLORES',
  'KOWALSKI',
  'NOWAK',
  'OBRIEN',
  'MURPHY',
  'PATEL',
  'KIM',
  'SINGH',
  'CHEN',
];
const FIRST = [
  'JAMES',
  'MARY',
  'ROBERT',
  'PATRICIA',
  'JOHN',
  'JENNIFER',
  'MICHAEL',
  'LINDA',
  'DAVID',
  'ELIZABETH',
  'WILLIAM',
  'BARBARA',
  'RICHARD',
  'SUSAN',
  'JOSEPH',
  'JESSICA',
  'THOMAS',
  'SARAH',
  'MARIA',
  'JOSE',
  'CARLOS',
  'ANNA',
  'PAUL',
  'KAREN',
];
const OUT_OF_AREA = [
  { city: 'SCOTTSDALE', state: 'AZ', zip: '85251' },
  { city: 'NAPLES', state: 'FL', zip: '34102' },
  { city: 'NEW YORK', state: 'NY', zip: '10001' },
  { city: 'LOS ANGELES', state: 'CA', zip: '90012' },
  { city: 'DALLAS', state: 'TX', zip: '75201' },
  { city: 'MILWAUKEE', state: 'WI', zip: '53202' },
  { city: 'NAPERVILLE', state: 'IL', zip: '60540' },
  { city: 'SCHAUMBURG', state: 'IL', zip: '60173' },
  { city: 'INDIANAPOLIS', state: 'IN', zip: '46204' },
];
const CLASSES = ['202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '234', '278', '295'];
const ROOF_WORK = [
  'TEAR OFF AND RE-ROOF EXISTING SINGLE FAMILY RESIDENCE',
  'REROOF: REMOVE SHINGLES, INSTALL NEW ASPHALT SHINGLES',
  'ROOFING - REPLACE FLAT ROOF MEMBRANE',
  'TEAR-OFF EXISTING ROOF AND INSTALL NEW SHINGLE ROOF',
  'RE-ROOF GARAGE AND HOUSE',
  'ROOF REPLACEMENT, NO STRUCTURAL CHANGES',
];
const OTHER_WORK = [
  'INTERIOR ALTERATIONS KITCHEN REMODEL',
  'INSTALL NEW FURNACE AND AC',
  'ELECTRICAL SERVICE UPGRADE 200A',
  'REAR DECK REPLACEMENT',
  'BASEMENT FINISH',
  'PORCH REPAIR',
  'WINDOW REPLACEMENT 12 UNITS',
  'INSTALL ROOFTOP SOLAR PANELS',
  'GREEN ROOF INSTALLATION',
  'FENCE 6FT WOOD',
  'PLUMBING: REPLACE WATER HEATER',
  'GARAGE DEMOLITION',
];
const OPEN_STATUS = ['OPEN', 'ISSUED', 'IN PROGRESS'];
const CLOSED_STATUS = ['COMPLETE', 'CLOSED', 'EXPIRED', 'CANCELED'];
const BBB = ['A+', 'A+', 'A', 'A', 'A-', 'B+', 'B', 'C', 'F'];
const ROOFING_RULE =
  'work_description ~ /\\bRE-?ROOF|\\bROOF(ING)?\\b|SHINGLE|TEAR[- ]?OFF/i and not /ROOF ?DECK|ROOFTOP|GREEN ROOF|SOLAR/i';
const isRoofingDesc = (s: string): boolean =>
  /\bRE-?ROOF|\bROOF(ING)?\b|SHINGLE|TEAR[- ]?OFF/i.test(s) &&
  !/ROOF ?DECK|ROOFTOP|GREEN ROOF|SOLAR/i.test(s);
const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return 'sha256:' + h.toString(16).padStart(8, '0').repeat(8);
};
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const placeholderCid = (label: string): string =>
  (
    'bafybeifixture' +
    label
      .toLowerCase()
      .replace(/\d/g, (d) => DIGIT_WORDS[Number(d)] ?? '')
      .replace(/[^a-z2-7]/g, '') +
    'a'.repeat(60)
  ).slice(0, 59);

export interface FixtureSummary {
  dbPath: string;
  publicationsDir: string;
  counts: Record<string, number>;
}

export async function makeFixture(dbPath: string, publicationsDir: string): Promise<FixtureSummary> {
  const now = new Date('2026-11-10T02:00:00Z');
  const runId = RUN_IDS[2];
  const ingested = now.toISOString();

  // ---- contractors (300)
  const contractors = Array.from({ length: 300 }, (_, i) => {
    const name = `${pick(LAST)} ${pick(['ROOFING', 'ROOFING & SIDING', 'CONSTRUCTION', 'EXTERIORS', 'HOME IMPROVEMENT', 'BUILDERS'])} ${pick(['INC', 'LLC', 'CO', 'CORP'])}`;
    const bbbRoll = rand();
    const bbb_state =
      bbbRoll < 0.55
        ? 'confirmed_present'
        : bbbRoll < 0.75
          ? 'confirmed_empty'
          : bbbRoll < 0.9
            ? 'unavailable'
            : 'unknown';
    const license = `104.${pad(int(10000, 99999), 6)}`;
    return {
      contractor_id: `idfpr:${license}`,
      name,
      name_normalized: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
      license_number: license,
      license_type: 'ROOFING CONTRACTOR',
      license_status: rand() < 0.9 ? 'ACTIVE' : 'EXPIRED',
      city: pick(['CHICAGO', 'EVANSTON', 'OAK PARK', 'SKOKIE', 'CICERO', 'BERWYN']),
      state: 'IL',
      county: 'COOK',
      ever_disciplined: rand() < 0.06,
      bbb_rating: bbb_state === 'confirmed_present' ? pick(BBB) : null,
      bbb_url:
        bbb_state === 'confirmed_present'
          ? `https://www.bbb.org/us/il/chicago/profile/roofing-contractors/fixture-${i}`
          : null,
      bbb_checked_at: bbb_state === 'unknown' ? null : ingested,
      bbb_state,
      source_system: FIXTURE_SOURCE,
      source_record_key: license,
      source_record_hash: hash(name),
      source_url: `https://data.illinois.gov/resource/pzzh-kp68.json?license_number=${license}`,
      ingested_at: ingested,
      run_id: runId,
    };
  });

  // ---- properties (5000)
  const properties = Array.from({ length: 5000 }, (_, i) => {
    const r = rand();
    const area = r < 0.7 ? AREAS[0] : r < 0.85 ? AREAS[1] : AREAS[2];
    const lat = +(area.lat + (rand() - 0.5) * 2 * area.spread).toFixed(6);
    const lon = +(area.lon + (rand() - 0.5) * 2 * area.spread * 1.3).toFixed(6);
    const pin14 = `${pad(int(10, 33), 2)}${pad(int(1, 36), 2)}${pad(int(100, 430), 3)}${pad(int(1, 80), 3)}${pad(i % 10000, 4)}`;
    const year_built = int(1885, 2022);
    const owner =
      rand() < 0.12
        ? `${pick(LAST)} ${pick(['PROPERTIES LLC', 'TRUST', 'HOLDINGS LLC'])}`
        : `${pick(FIRST)} ${pick(LAST)}`;
    const outOfArea = rand() < 0.14;
    const mail = outOfArea ? pick(OUT_OF_AREA) : { city: area.city, state: 'IL', zip: pick(area.zips) };
    const address = `${int(100, 7999)} ${pick(STREETS)}`;
    const saleYearsAgo = rand() < 0.85 ? +(rand() * 40).toFixed(2) : null;
    const saleDate = saleYearsAgo === null ? null : daysAgo(now, saleYearsAgo * 365.25);
    return {
      pin14,
      pin10: pin14.slice(0, 10),
      address,
      city: area.city,
      zip: pick(area.zips),
      lat,
      lon,
      geohash6: ngeohash.encode(lat, lon, 6),
      year_built,
      class: pick(CLASSES),
      municipality:
        area.city === 'CHICAGO'
          ? 'CITY OF CHICAGO'
          : `VILLAGE OF ${area.city}`.replace('VILLAGE OF EVANSTON', 'CITY OF EVANSTON'),
      township: pick(area.townships),
      owner_name: owner,
      mail_address: outOfArea
        ? `${int(100, 9999)} ${pick(['MAIN ST', 'OAK AVE', 'PALM DR', 'BROADWAY', 'ELM ST'])}`
        : address,
      mail_city: mail.city,
      mail_state: mail.state,
      mail_zip: mail.zip,
      is_out_of_area: outOfArea,
      last_sale_date: saleDate ? iso(saleDate) : null,
      last_sale_price: saleDate ? int(90, 1900) * 1000 : null,
      years_since_sale: saleYearsAgo,
      roof_age_years: null as number | null,
      roof_age_basis: 'year_built' as 'year_built' | 'reroof_permit',
      roof_age_confidence: (year_built >= 1990 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      roof_age_anchor_date: `${year_built}-01-01`,
      source_system: FIXTURE_SOURCE,
      source_record_key: pin14,
      source_record_hash: hash(pin14 + address),
      source_url: `https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json?pin=${pin14}&year=2026`,
      ingested_at: ingested,
      run_id: runId,
    };
  });

  // ---- permits (2000: 600 roofing of which 150 long-open)
  const permits = Array.from({ length: 2000 }, (_, i) => {
    const roofing = i < 600;
    const longOpen = i < 150;
    const prop = pick(properties);
    const withPin = rand() < 0.75;
    const src = rand() < 0.6 ? 'chicago_building_permits' : 'cook_assessor_permits';
    const work = roofing ? pick(ROOF_WORK) : pick(OTHER_WORK);
    const isRoofing = isRoofingDesc(work);
    const open = longOpen ? true : roofing ? i < 300 : rand() < 0.2;
    const issuedDaysAgo = longOpen ? int(3 * 365, 12 * 365) : open ? int(10, 2 * 365) : int(60, 15 * 365);
    const issued = daysAgo(now, issuedDaysAgo);
    const closed = open ? null : daysAgo(issued, -int(20, 400));
    const contractor = rand() < 0.8 ? pick(contractors) : null;
    const permitNo =
      src === 'chicago_building_permits' ? `${pad(100000000 + i * 7, 9)}` : `${pad(2000000 + i * 3, 8)}`;
    return {
      permit_id: `${src}:${permitNo}`,
      source_system: src,
      pin14: withPin ? prop.pin14 : null,
      address: prop.address,
      lat: prop.lat,
      lon: prop.lon,
      geohash6: prop.geohash6,
      permit_type: roofing
        ? 'PERMIT - EASY PERMIT PROCESS'
        : pick(['PERMIT - RENOVATION/ALTERATION', 'PERMIT - ELECTRIC WIRING', 'PERMIT - NEW CONSTRUCTION']),
      work_description: work,
      is_roofing: isRoofing,
      roofing_match_rule: isRoofing ? ROOFING_RULE : null,
      status: open ? pick(OPEN_STATUS) : pick(CLOSED_STATUS),
      status_is_open: open,
      issued_at: iso(issued),
      applied_at: iso(daysAgo(issued, int(1, 45))),
      closed_at: closed ? iso(closed) : null,
      open_days: Math.round(((closed ?? now).getTime() - issued.getTime()) / 86_400_000),
      applicant_name: contractor ? contractor.name : prop.owner_name,
      contractor_name: contractor ? contractor.name : null,
      contractor_id: contractor ? contractor.contractor_id : null,
      municipality: prop.municipality,
      source_record_key: permitNo,
      source_record_hash: hash(permitNo + work),
      source_url:
        src === 'chicago_building_permits'
          ? `https://data.cityofchicago.org/resource/ydr8-5enu.json?permit_=${permitNo}`
          : `https://datacatalog.cookcountyil.gov/resource/6yjf-dfxs.json?permit_number=${permitNo}`,
      ingested_at: ingested,
      run_id: runId,
    };
  });

  // roof age: latest CLOSED roofing permit per pin wins (open permit != replaced roof), else year_built
  const roofByPin = new Map<string, (typeof permits)[number]>();
  for (const p of permits) {
    if (!p.is_roofing || !p.pin14 || !p.closed_at) continue;
    const prev = roofByPin.get(p.pin14);
    if (!prev || (p.issued_at ?? '') > (prev.issued_at ?? '')) roofByPin.set(p.pin14, p);
  }
  for (const prop of properties) {
    const rp = roofByPin.get(prop.pin14);
    const anchor = rp?.closed_at ? new Date(rp.closed_at) : new Date(`${prop.year_built}-01-01`);
    prop.roof_age_years = +((now.getTime() - anchor.getTime()) / (365.25 * 86_400_000)).toFixed(2);
    prop.roof_age_anchor_date = iso(anchor);
    if (rp) {
      prop.roof_age_basis = 'reroof_permit';
      prop.roof_age_confidence = 'high';
    }
  }

  // ---- sales (one per property with a sale)
  const sales = properties
    .filter((p) => p.last_sale_date)
    .map((p, i) => ({
      sale_id: `cook_parcel_sales:${pad(1000000 + i, 8)}`,
      pin14: p.pin14,
      sale_date: p.last_sale_date,
      sale_price: p.last_sale_price,
      deed_type: pick(['WARRANTY DEED', 'TRUSTEE DEED', 'QUIT CLAIM DEED', 'SPECIAL WARRANTY DEED']),
      buyer_name: p.owner_name,
      seller_name: `${pick(FIRST)} ${pick(LAST)}`,
      doc_no: `${pad(int(1, 99999999), 10)}`,
      source_system: FIXTURE_SOURCE,
      source_record_key: `${p.pin14}:${p.last_sale_date}`,
      source_record_hash: hash(p.pin14 + p.last_sale_date),
      source_url: `https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json?pin=${p.pin14}`,
      ingested_at: ingested,
      run_id: runId,
    }));

  // ---- businesses (500)
  const businesses = Array.from({ length: 500 }, (_, i) => {
    const area = AREAS[0];
    const lat = +(area.lat + (rand() - 0.5) * 2 * area.spread).toFixed(6);
    const lon = +(area.lon + (rand() - 0.5) * 2 * area.spread * 1.3).toFixed(6);
    const legal = `${pick(LAST)} ${pick(['ENTERPRISES', 'GROUP', 'SERVICES', 'FOODS', 'AUTO', 'ROOFING'])} ${pick(['INC', 'LLC'])}`;
    const issued = daysAgo(now, int(30, 1500));
    return {
      license_id: `${pad(2500000 + i, 7)}-${pad(int(1, 2026), 8)}`,
      legal_name: legal,
      dba: rand() < 0.5 ? legal.split(' ').slice(0, 2).join(' ') : null,
      address: `${int(100, 7999)} ${pick(STREETS)}`,
      city: 'CHICAGO',
      zip: pick(area.zips),
      lat,
      lon,
      geohash6: ngeohash.encode(lat, lon, 6),
      license_description: pick([
        'Limited Business License',
        'Regulated Business License',
        'Retail Food Establishment',
        'Home Repair',
        'General Contractor',
      ]),
      status: rand() < 0.85 ? 'AAI' : 'REV',
      issued_at: iso(issued),
      expires_at: iso(daysAgo(issued, -730)),
      source_system: FIXTURE_SOURCE,
      source_record_key: `${2500000 + i}`,
      source_record_hash: hash(legal),
      source_url: `https://data.cityofchicago.org/resource/r5kz-chrr.json?license_id=${2500000 + i}`,
      ingested_at: ingested,
      run_id: runId,
    };
  });

  const counts = {
    property: properties.length,
    permit: permits.length,
    roofing_permit: permits.filter((p) => p.is_roofing).length,
    open_roofing_permit: permits.filter((p) => p.is_roofing && p.status_is_open).length,
    contractor: contractors.length,
    business: businesses.length,
    sale: sales.length,
  };
  const sourceList = (fetchedAt: string, scale: number) => [
    {
      source_system: 'cook_parcel_universe',
      url: 'https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json',
      records: Math.round(counts.property * scale),
      fetched_at: fetchedAt,
      note: 'FIXTURE sample, not the full 1.86M parcel universe',
    },
    {
      source_system: 'cook_residential_characteristics',
      url: 'https://datacatalog.cookcountyil.gov/resource/x54s-btds.json',
      records: Math.round(counts.property * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'cook_parcel_addresses',
      url: 'https://datacatalog.cookcountyil.gov/resource/3723-97qp.json',
      records: Math.round(counts.property * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'cook_parcel_sales',
      url: 'https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json',
      records: Math.round(counts.sale * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'cook_assessor_permits',
      url: 'https://datacatalog.cookcountyil.gov/resource/6yjf-dfxs.json',
      records: Math.round(permits.filter((p) => p.source_system === 'cook_assessor_permits').length * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'chicago_building_permits',
      url: 'https://data.cityofchicago.org/resource/ydr8-5enu.json',
      records: Math.round(
        permits.filter((p) => p.source_system === 'chicago_building_permits').length * scale,
      ),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'chicago_business_licenses',
      url: 'https://data.cityofchicago.org/resource/r5kz-chrr.json',
      records: Math.round(counts.business * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'idfpr_roofing_licenses',
      url: 'https://data.illinois.gov/resource/pzzh-kp68.json',
      records: Math.round(counts.contractor * scale),
      fetched_at: fetchedAt,
    },
    {
      source_system: 'bbb',
      url: 'https://www.bbb.org/',
      records: contractors.filter((c) => c.bbb_rating).length,
      fetched_at: fetchedAt,
      note: 'BBB has no bulk API; ratings scraped per contractor profile where a public page exists',
    },
  ];
  const scale = (k: number) => [0.92, 0.97, 1][k] ?? 1;
  const limitations = [
    'FIXTURE DATA: synthetic records generated locally for UI development; counts are not real Cook County totals.',
    'FIXTURE DATA: root/manifest CIDs are placeholders and were not published to IPFS.',
    'BBB ratings are only available where a public BBB profile exists; bbb_state records the lookup outcome.',
    'Cook County Assessor permits carry no coordinates; location comes from the parcel join on pin14.',
  ];
  const runs = RUN_IDS.map((id, k) => {
    const started = new Date(id.replace(/-(\d\d)-(\d\d)Z$/, ':$1:$2Z'));
    const prevScale = k === 0 ? 0 : scale(k - 1);
    const delta = (n: number) => ({
      added: Math.round(n * (scale(k) - prevScale)),
      changed: k === 0 ? 0 : Math.round(n * 0.01),
      removed: 0,
    });
    return {
      run_id: id,
      started_at: started.toISOString(),
      finished_at: new Date(started.getTime() + (18 + k * 3) * 60_000).toISOString(),
      status: 'succeeded',
      sources: sourceList(new Date(started.getTime() + 10 * 60_000).toISOString(), scale(k)),
      counts: Object.fromEntries(Object.entries(counts).map(([t, n]) => [t, Math.round(n * scale(k))])),
      deltas: Object.fromEntries(Object.entries(counts).map(([t, n]) => [t, delta(n)])),
      dead_letters:
        k === 2
          ? [
              {
                source_system: 'bbb',
                source_record_key: contractors[7]?.license_number,
                error: 'HTTP 429 after 3 retries',
                at: ingested,
              },
            ]
          : [],
      limitations,
      manifest_cid: placeholderCid(`manifest${k + 1}`),
      root_cid: placeholderCid(`root${k + 1}`),
      previous_run_id: k === 0 ? null : RUN_IDS[k - 1],
    };
  });
  const watermarks = sourceList(ingested, 1)
    .slice(0, 8)
    .map((s) => ({
      source_system: s.source_system,
      watermark_field: ':updated_at',
      watermark_value: ingested,
      last_run_id: runId,
    }));

  // ---- write NDJSON + load into a fresh duckdb file
  const tmp = join(tmpdir(), `cook-il-fixture-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) rmSync(dbPath);
  const nd = (name: string, rows: object[]) => {
    const f = join(tmp, `${name}.ndjson`);
    writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return f.replace(/'/g, "''");
  };
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  const load = async (name: string, rows: object[], columns: string) =>
    conn.run(
      `CREATE TABLE ${name} AS SELECT * FROM read_ndjson('${nd(name, rows)}', columns = {${columns}})`,
    );
  const prov =
    "source_system: 'VARCHAR', source_record_key: 'VARCHAR', source_record_hash: 'VARCHAR', source_url: 'VARCHAR', ingested_at: 'TIMESTAMP', run_id: 'VARCHAR'";
  await load(
    'property',
    properties,
    `pin14: 'VARCHAR', pin10: 'VARCHAR', address: 'VARCHAR', city: 'VARCHAR', zip: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', geohash6: 'VARCHAR', year_built: 'INTEGER', class: 'VARCHAR', municipality: 'VARCHAR', township: 'VARCHAR', owner_name: 'VARCHAR', mail_address: 'VARCHAR', mail_city: 'VARCHAR', mail_state: 'VARCHAR', mail_zip: 'VARCHAR', is_out_of_area: 'BOOLEAN', last_sale_date: 'DATE', last_sale_price: 'DOUBLE', years_since_sale: 'DOUBLE', roof_age_years: 'DOUBLE', roof_age_basis: 'VARCHAR', roof_age_confidence: 'VARCHAR', roof_age_anchor_date: 'DATE', ${prov}`,
  );
  await load(
    'permit',
    permits,
    `permit_id: 'VARCHAR', source_system: 'VARCHAR', pin14: 'VARCHAR', address: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', geohash6: 'VARCHAR', permit_type: 'VARCHAR', work_description: 'VARCHAR', is_roofing: 'BOOLEAN', roofing_match_rule: 'VARCHAR', status: 'VARCHAR', status_is_open: 'BOOLEAN', issued_at: 'DATE', applied_at: 'DATE', closed_at: 'DATE', open_days: 'INTEGER', applicant_name: 'VARCHAR', contractor_name: 'VARCHAR', contractor_id: 'VARCHAR', municipality: 'VARCHAR', source_record_key: 'VARCHAR', source_record_hash: 'VARCHAR', source_url: 'VARCHAR', ingested_at: 'TIMESTAMP', run_id: 'VARCHAR'`,
  );
  await load(
    'contractor',
    contractors,
    `contractor_id: 'VARCHAR', name: 'VARCHAR', name_normalized: 'VARCHAR', license_number: 'VARCHAR', license_type: 'VARCHAR', license_status: 'VARCHAR', city: 'VARCHAR', state: 'VARCHAR', county: 'VARCHAR', ever_disciplined: 'BOOLEAN', bbb_rating: 'VARCHAR', bbb_url: 'VARCHAR', bbb_checked_at: 'TIMESTAMP', bbb_state: 'VARCHAR', ${prov}`,
  );
  await load(
    'business',
    businesses,
    `license_id: 'VARCHAR', legal_name: 'VARCHAR', dba: 'VARCHAR', address: 'VARCHAR', city: 'VARCHAR', zip: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', geohash6: 'VARCHAR', license_description: 'VARCHAR', status: 'VARCHAR', issued_at: 'DATE', expires_at: 'DATE', ${prov}`,
  );
  await load(
    'sale',
    sales,
    `sale_id: 'VARCHAR', pin14: 'VARCHAR', sale_date: 'DATE', sale_price: 'DOUBLE', deed_type: 'VARCHAR', buyer_name: 'VARCHAR', seller_name: 'VARCHAR', doc_no: 'VARCHAR', ${prov}`,
  );
  await load(
    'run',
    runs,
    `run_id: 'VARCHAR', started_at: 'TIMESTAMP', finished_at: 'TIMESTAMP', status: 'VARCHAR', sources: 'JSON', counts: 'JSON', deltas: 'JSON', dead_letters: 'JSON', limitations: 'JSON', manifest_cid: 'VARCHAR', root_cid: 'VARCHAR', previous_run_id: 'VARCHAR'`,
  );
  await load(
    'source_watermark',
    watermarks,
    `source_system: 'VARCHAR', watermark_field: 'VARCHAR', watermark_value: 'VARCHAR', last_run_id: 'VARCHAR'`,
  );
  conn.closeSync();
  instance.closeSync();
  rmSync(tmp, { recursive: true, force: true });

  // ---- publications (placeholder manifests)
  for (const [k, run] of runs.entries()) {
    const dir = join(publicationsDir, run.run_id);
    mkdirSync(dir, { recursive: true });
    const artifacts = [...Object.keys(counts).filter((t) => !t.includes('_')), 'run', 'source_watermark'].map(
      (t, j) => ({
        cid: placeholderCid(`${t}${k + 1}`),
        name: `tables/${t}/part-0000.parquet`,
        size: 100_000 + j * 7_331 + k * 911,
        codec: 'file',
        sha256: hash(`${t}${k}`).slice(7),
      }),
    );
    const manifest = {
      run_id: run.run_id,
      created_at: run.finished_at,
      root_cid: run.root_cid,
      manifest_cid: run.manifest_cid,
      tables_cid: placeholderCid(`tables${k + 1}`),
      previous_root_cid: k === 0 ? null : runs[k - 1]?.root_cid,
      previous_run_id: run.previous_run_id,
      ipns: null,
      car: {
        name: `${run.run_id}.car`,
        cid: placeholderCid(`car${k + 1}`),
        size: 1_234_567 + k * 1000,
      },
      note: 'FIXTURE: placeholder CIDs, nothing was published to IPFS.',
      artifacts: [
        {
          cid: run.root_cid,
          name: '/',
          size: 0,
          codec: 'directory',
          sha256: null,
        },
        {
          cid: placeholderCid(`tables${k + 1}`),
          name: 'tables',
          size: 0,
          codec: 'directory',
          sha256: null,
        },
        ...artifacts,
        {
          cid: placeholderCid(`coverage${k + 1}`),
          name: 'coverage.json',
          size: 2_048,
          codec: 'file',
          sha256: hash(`coverage${k}`).slice(7),
        },
      ],
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(dir, 'verification.json'),
      JSON.stringify(
        {
          verified_at: run.finished_at,
          results: ['https://ipfs.io', 'https://dweb.link'].map((gw) => ({
            cid: run.root_cid,
            name: '/',
            gateway: gw,
            url: `${gw}/ipfs/${run.root_cid}`,
            status: 'skipped (fixture, not published)',
            size_match: null,
            digest_match: null,
            fetched_at: run.finished_at,
          })),
        },
        null,
        2,
      ),
    );
  }
  return { dbPath, publicationsDir, counts };
}

const invokedDirectly = process.argv[1]?.endsWith('make-fixture.ts');
if (invokedDirectly) {
  const dbPath = process.argv[2] ?? 'data/cook_il.duckdb';
  const pubDir = process.argv[3] ?? join(dirname(dbPath), 'publications');
  makeFixture(dbPath, pubDir).then((s) => console.log(JSON.stringify(s)));
}
