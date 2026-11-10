import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { ExtLink } from "../components.js";
import { fmt, fmtDate, invalidDate, trpc } from "../trpc.js";
import { bbbLabel } from "../../bbb.js";

type Result = Awaited<ReturnType<typeof trpc.search.properties.query>>;
type Sort = "distance" | "roof_age" | "open_days";
const CHICAGO = { lat: 41.8781, lon: -87.6298 };

const maxOpenDays = (p: Result["properties"][number]): number =>
  Math.max(
    0,
    ...p.permits.filter((x) => x.is_roofing && x.status_is_open).map((x) => x.open_days ?? 0),
  );
/** ponytail: sorts the returned page (≤100 rows) client-side; the server orders by distance / open days. */
export function sortResults(rows: Result["properties"], sort: Sort): Result["properties"] {
  const by: Record<
    Sort,
    (a: Result["properties"][number], b: Result["properties"][number]) => number
  > = {
    distance: (a, b) => (a.distance_miles ?? Infinity) - (b.distance_miles ?? Infinity),
    roof_age: (a, b) => (b.roof_age_years ?? -1) - (a.roof_age_years ?? -1),
    open_days: (a, b) => maxOpenDays(b) - maxOpenDays(a),
  };
  return [...rows].sort(by[sort]);
}

export function Explore() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [pin, setPin] = useState(CHICAGO);
  const [radius, setRadius] = useState(2);
  const [minRoofAge, setMinRoofAge] = useState<number | "">(15);
  const [openOnly, setOpenOnly] = useState(false);
  const [minOpenYears, setMinOpenYears] = useState<number | "">("");
  const [sortChoice, setSortChoice] = useState<Sort | null>(null);
  const sort: Sort = sortChoice ?? (minRoofAge === "" ? "distance" : "roof_age");
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = new maplibregl.Map({
      container: mapEl.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [CHICAGO.lon, CHICAGO.lat],
      zoom: 11,
    });
    m.addControl(new maplibregl.NavigationControl());
    m.on("click", (e) => setPin({ lat: +e.lngLat.lat.toFixed(6), lon: +e.lngLat.lng.toFixed(6) }));
    m.on("load", () => {
      m.addSource("results", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "results",
        type: "circle",
        source: "results",
        paint: {
          "circle-radius": 6,
          "circle-color": "#d7301f",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
        },
      });
      m.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "radius",
        type: "line",
        source: "radius",
        paint: { "line-color": "#0b5fff", "line-width": 2 },
      });
    });
    map.current = m;
    marker.current = new maplibregl.Marker({ color: "#0b5fff" })
      .setLngLat([CHICAGO.lon, CHICAGO.lat])
      .addTo(m);
  }, []);

  /** Typed coordinates: move the pin and recenter the map on it (map clicks already show the point). */
  const typePin = (next: { lat: number; lon: number }) => {
    setPin(next);
    if (Number.isFinite(next.lat) && Number.isFinite(next.lon))
      map.current?.easeTo({ center: [next.lon, next.lat] });
  };

  useEffect(() => {
    marker.current?.setLngLat([pin.lon, pin.lat]);
    const m = map.current;
    const src: maplibregl.GeoJSONSource | undefined = m?.getSource("radius");
    src?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: circle(pin.lat, pin.lon, radius) },
    });
  }, [pin, radius]);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await trpc.search.properties.query({
        lat: pin.lat,
        lon: pin.lon,
        radiusMiles: radius,
        minRoofAge: minRoofAge === "" ? undefined : minRoofAge,
        openRoofingPermitsOnly: openOnly,
        minOpenDays: openOnly && minOpenYears !== "" ? Math.round(minOpenYears * 365) : undefined,
        limit: 100,
      });
      setRes(r);
      const src: maplibregl.GeoJSONSource | undefined = map.current?.getSource("results");
      src?.setData({
        type: "FeatureCollection",
        features: r.properties
          .filter((p) => p.lat !== null && p.lon !== null)
          .map((p) => ({
            type: "Feature",
            properties: { pin14: p.pin14 },
            geometry: { type: "Point", coordinates: [p.lon as number, p.lat as number] },
          })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Explore: radius search</h1>
      <p className="muted">
        Click the map to drop a pin (or type coordinates), set a radius and filters. Prefilter by
        geohash, exact haversine distance.
      </p>
      <div className="row">
        <label className="f">
          lat
          <input
            type="number"
            step="0.0001"
            value={pin.lat}
            onChange={(e) => typePin({ ...pin, lat: Number(e.target.value) })}
            data-testid="lat"
          />
        </label>
        <label className="f">
          lon
          <input
            type="number"
            step="0.0001"
            value={pin.lon}
            onChange={(e) => typePin({ ...pin, lon: Number(e.target.value) })}
            data-testid="lon"
          />
        </label>
        <label className="f">
          radius (miles)
          <input
            type="number"
            min={0.1}
            max={50}
            step={0.5}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            data-testid="radius"
          />
        </label>
        <label className="f">
          min roof age (years)
          <input
            type="number"
            min={0}
            value={minRoofAge}
            onChange={(e) => setMinRoofAge(e.target.value === "" ? "" : Number(e.target.value))}
            data-testid="min-roof-age"
          />
        </label>
        <label className="f">
          open roofing permits only
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            data-testid="open-only"
          />
        </label>
        <label className="f">
          min open years
          <input
            type="number"
            min={0}
            value={minOpenYears}
            disabled={!openOnly}
            onChange={(e) => setMinOpenYears(e.target.value === "" ? "" : Number(e.target.value))}
            data-testid="min-open-years"
          />
        </label>
        <label className="f">
          sort results
          <select
            value={sort}
            onChange={(e) => setSortChoice(e.target.value as Sort)}
            data-testid="sort"
          >
            <option value="distance">distance</option>
            <option value="roof_age">roof age desc</option>
            <option value="open_days">open days desc</option>
          </select>
        </label>
        <button className="primary" onClick={search} disabled={busy} data-testid="search">
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      <div className="split" style={{ marginTop: 12 }}>
        <div id="map" ref={mapEl} data-testid="map" />
        <div>
          {error && (
            <p className="error" data-testid="search-error">
              {error}
            </p>
          )}
          {res && (
            <p data-testid="search-meta">
              Showing {res.properties.length} of {res.total_in_radius} properties within {radius} mi
              of ({pin.lat}, {pin.lon}). Snapshot run {res.source.runId}, root CID{" "}
              {res.source.rootCid ?? "—"}, manifest CID {res.source.manifestCid ?? "—"}.
            </p>
          )}
          <div data-testid="results">
            {res &&
              sortResults(res.properties, sort).map((p) => (
                <div className="result" key={p.pin14} data-testid="result">
                  <div className="title">
                    PIN {p.pin14} · {p.address}, {p.city} {p.zip} · {fmt(p.distance_miles)} mi
                  </div>
                  <div>
                    coordinates {p.lat}, {p.lon} · year built {fmt(p.year_built)} · roof age{" "}
                    {invalidDate(p.roof_age_anchor_date) ? (
                      <b className="bad" data-testid="invalid-anchor">
                        unknown
                      </b>
                    ) : (
                      <b>{fmt(p.roof_age_years)} y</b>
                    )}{" "}
                    (basis {p.roof_age_basis ?? "—"}, confidence {p.roof_age_confidence ?? "—"},
                    anchor {fmtDate(p.roof_age_anchor_date)})
                  </div>
                  <div>
                    owner {p.owner_name ?? "—"} · mail {p.mail_city ?? "—"}, {p.mail_state ?? "—"} ·
                    out of area: {fmt(p.is_out_of_area)} · last sale {fmt(p.last_sale_date)} (
                    {fmt(p.years_since_sale)} y ago)
                  </div>
                  <div className="muted">
                    provenance: {p.source_system} · ingested {p.ingested_at} · run {p.run_id} ·{" "}
                    <ExtLink href={p.source_url} />
                  </div>
                  {p.permits.length > 0 && (
                    <ul className="plain">
                      {p.permits.map((x) => (
                        <li key={x.permit_id}>
                          {x.is_roofing ? "ROOFING " : ""}permit {x.permit_id} · {x.status} (
                          {x.status_is_open ? "open" : "closed"}) · issued {fmtDate(x.issued_at)} ·
                          open_days {fmt(x.open_days)} · contractor {x.contractor_name ?? "—"}
                          {x.contractor
                            ? ` · license ${x.contractor.license_number ?? "—"}`
                            : ""} · {bbbLabel(x.contractor)}
                          {" · "}
                          <ExtLink href={x.source_url}>source</ExtLink>
                          {x.contractor?.bbb_url ? (
                            <>
                              {" "}
                              · <ExtLink href={x.contractor.bbb_url}>BBB profile</ExtLink>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

function circle(lat: number, lon: number, miles: number): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = miles / 69.0;
  const dLon = miles / (69.0 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lon + dLon * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  return pts;
}
