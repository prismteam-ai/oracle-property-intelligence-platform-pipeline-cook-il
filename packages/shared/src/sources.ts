export interface Source {
  /** source_system value in the contract tables */
  system: string;
  host: string;
  datasetId: string;
  title: string;
  /** fields requested via $select (system fields :id/:updated_at are always added) */
  fields: readonly string[];
  /** SoQL $where (static filters) */
  where?: string;
  /** fields that form source_record_key (joined with '|'); falls back to :id */
  keyFields: readonly string[];
  /** feeds which contract table(s) */
  feeds: readonly string[];
}

const chicagoContacts = Array.from({ length: 15 }, (_, i) => i + 1).flatMap((n) => [
  `contact_${n}_type`,
  `contact_${n}_name`,
]);

export const SOURCES: readonly Source[] = [
  {
    system: "cook_parcels",
    host: "datacatalog.cookcountyil.gov",
    datasetId: "pabr-t5kh",
    title: "Assessor - Parcel Universe (Current Year)",
    fields: [
      "pin",
      "pin10",
      "year",
      "class",
      "township_name",
      "cook_municipality_name",
      "zip_code",
      "lat",
      "lon",
    ],
    keyFields: ["pin", "year"],
    feeds: ["property"],
  },
  {
    system: "cook_characteristics",
    host: "datacatalog.cookcountyil.gov",
    datasetId: "x54s-btds",
    title: "Assessor - Single and Multi-Family Improvement Characteristics",
    fields: ["pin", "year", "class", "char_yrblt", "char_roof_cnst"],
    where: "year=2026",
    keyFields: ["pin", "year"],
    feeds: ["property"],
  },
  {
    system: "cook_addresses",
    host: "datacatalog.cookcountyil.gov",
    datasetId: "3723-97qp",
    title: "Assessor - Parcel Addresses",
    fields: [
      "pin",
      "pin10",
      "year",
      "prop_address_full",
      "prop_address_city_name",
      "prop_address_zipcode_1",
      "mail_address_name",
      "mail_address_full",
      "mail_address_city_name",
      "mail_address_state",
      "mail_address_zipcode_1",
      "owner_address_name",
    ],
    where: "year=2026",
    keyFields: ["pin", "year"],
    feeds: ["property"],
  },
  {
    system: "cook_sales",
    host: "datacatalog.cookcountyil.gov",
    datasetId: "wvhk-k5uv",
    title: "Assessor - Parcel Sales",
    fields: [
      "pin",
      "year",
      "sale_date",
      "sale_price",
      "doc_no",
      "deed_type",
      "buyer_name",
      "seller_name",
      "is_multisale",
      "num_parcels_sale",
      "row_id",
    ],
    keyFields: ["row_id"],
    feeds: ["sale", "property"],
  },
  {
    system: "cook_assessor_permits",
    host: "datacatalog.cookcountyil.gov",
    datasetId: "6yjf-dfxs",
    title: "Assessor - Permits",
    fields: [
      "pin",
      "year",
      "permit_number",
      "local_permit_number",
      "date_issued",
      "estimated_date_of_completion",
      "status",
      "assessable",
      "amount",
      "municipality",
      "township",
      "property_address",
      "mailing_address",
      "applicant_name",
      "job_code_primary",
      "job_code_secondary",
      "work_description",
      "improvement_code_1",
      "improvement_code_2",
      "improvement_code_3",
      "improvement_code_4",
      "row_id",
    ],
    keyFields: ["row_id"],
    feeds: ["permit"],
  },
  {
    system: "chicago_permits",
    host: "data.cityofchicago.org",
    datasetId: "ydr8-5enu",
    title: "City of Chicago - Building Permits",
    fields: [
      "id",
      "permit_",
      "permit_status",
      "permit_milestone",
      "permit_type",
      "application_start_date",
      "issue_date",
      "street_number",
      "street_direction",
      "street_name",
      "work_description",
      "pin_list",
      "latitude",
      "longitude",
      ...chicagoContacts,
    ],
    keyFields: ["id"],
    feeds: ["permit"],
  },
  {
    system: "chicago_business_licenses",
    host: "data.cityofchicago.org",
    datasetId: "r5kz-chrr",
    title: "City of Chicago - Business Licenses",
    fields: [
      "id",
      "license_id",
      "account_number",
      "site_number",
      "legal_name",
      "doing_business_as_name",
      "address",
      "city",
      "state",
      "zip_code",
      "license_code",
      "license_description",
      "license_number",
      "license_status",
      "date_issued",
      "license_start_date",
      "expiration_date",
      "latitude",
      "longitude",
    ],
    keyFields: ["id"],
    feeds: ["business"],
  },
  {
    system: "idfpr_roofing",
    host: "data.illinois.gov",
    datasetId: "pzzh-kp68",
    title: "IDFPR Professional Licenses (roofing contractors)",
    fields: [
      "license_type",
      "description",
      "license_number",
      "license_status",
      "business",
      "first_name",
      "last_name",
      "business_name",
      "businessdba",
      "original_issue_date",
      "effective_date",
      "expiration_date",
      "city",
      "state",
      "zip",
      "county",
      "ever_disciplined",
      "lastmodifieddate",
    ],
    where: "license_type='ROOFING CONTRACTOR'",
    keyFields: ["license_number"],
    feeds: ["contractor"],
  },
];

export const SYSTEM_FIELDS = [":id", ":updated_at"] as const;

export function sourceUrl(s: Source): string {
  return `https://${s.host}/resource/${s.datasetId}`;
}
export function datasetPageUrl(s: Source): string {
  return `https://${s.host}/d/${s.datasetId}`;
}
export function findSource(system: string): Source {
  const s = SOURCES.find((x) => x.system === system);
  if (!s)
    throw new Error(`unknown source ${system}; known: ${SOURCES.map((x) => x.system).join(", ")}`);
  return s;
}
