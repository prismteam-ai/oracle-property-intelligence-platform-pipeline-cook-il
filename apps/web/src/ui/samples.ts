/** Sample queries for every README question. Shared by the SQL console and docs. */
export const SAMPLE_QUERIES: { title: string; sql: string }[] = [
  {
    title: "Properties within 2 miles of downtown Evanston",
    sql: `SELECT pin14, address, city, lat, lon,
  round(2 * 3958.7613 * asin(sqrt(pow(sin(radians(lat - 42.0451) / 2), 2) + cos(radians(42.0451)) * cos(radians(lat)) * pow(sin(radians(lon + 87.6877) / 2), 2))), 2) AS distance_miles,
  source_url
FROM property
WHERE lat BETWEEN 42.0451 - 0.03 AND 42.0451 + 0.03 -- bounding box (~2 mi) so the index prunes, then exact haversine
  AND lon BETWEEN -87.6877 - 0.04 AND -87.6877 + 0.04
  AND distance_miles <= 2
ORDER BY distance_miles
LIMIT 50`,
  },
  {
    title: "Roofs older than 15 years (with basis and confidence)",
    sql: `SELECT pin14, address, city, year_built, roof_age_years, roof_age_basis, roof_age_confidence, roof_age_anchor_date, source_url
FROM property
WHERE roof_age_years > 15
  AND roof_age_anchor_date BETWEEN DATE '1900-01-01' AND current_date -- anchors outside this range are source junk
ORDER BY roof_age_years DESC
LIMIT 100`,
  },
  {
    title: "Open roofing permits, longest open first, with contractor and BBB rating",
    sql: `SELECT p.permit_id, p.pin14, p.address, p.status, p.issued_at, p.open_days, round(p.open_days / 365.25, 1) AS open_years,
  p.contractor_name, c.license_number, c.bbb_rating, c.bbb_state, c.bbb_url, p.work_description, p.source_url
FROM permit p
LEFT JOIN contractor c ON c.contractor_id = p.contractor_id
WHERE p.is_roofing AND p.status_is_open
ORDER BY p.open_days DESC
LIMIT 100`,
  },
  {
    title: "No ownership change in more than 10 years",
    sql: `SELECT pin14, address, city, owner_name, last_sale_date, last_sale_price, years_since_sale, source_url
FROM property
WHERE years_since_sale > 10
ORDER BY years_since_sale DESC
LIMIT 100`,
  },
  {
    title: "Out-of-area (regional / non-local) owners",
    sql: `SELECT pin14, address, city, owner_name, mail_address, mail_city, mail_state, mail_zip, source_url
FROM property
WHERE is_out_of_area
ORDER BY mail_state, mail_city
LIMIT 100`,
  },
  {
    title: "Aged roof AND open roofing permit (lead shortlist)",
    sql: `SELECT pr.pin14, pr.address, pr.city, pr.roof_age_years, pr.roof_age_basis, pe.permit_id, pe.open_days, pe.contractor_name, c.bbb_rating, pr.source_url, pe.source_url AS permit_source_url
FROM property pr
JOIN permit pe ON pe.pin14 = pr.pin14 AND pe.is_roofing AND pe.status_is_open
LEFT JOIN contractor c ON c.contractor_id = pe.contractor_id
WHERE pr.roof_age_years > 15
  AND pr.roof_age_anchor_date BETWEEN DATE '1900-01-01' AND current_date
ORDER BY pe.open_days DESC
LIMIT 100`,
  },
  {
    title: "Record counts per table",
    sql: `SELECT 'property' AS t, count(*) AS n FROM property
UNION ALL SELECT 'permit', count(*) FROM permit
UNION ALL SELECT 'contractor', count(*) FROM contractor
UNION ALL SELECT 'business', count(*) FROM business
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'run', count(*) FROM run`,
  },
];
