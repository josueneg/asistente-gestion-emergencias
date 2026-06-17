-- Migración 0006: Estaciones WMO oficiales + columna station_type
-- Fuente: NOAA GHCN-Daily (https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily)
-- Las 40 estaciones sinópticas de la red WMO para Centroamérica y República Dominicana.
-- station_type = 'synoptic': estación meteorológica WMO oficial (coordenadas exactas)
-- station_type = 'city':     centroide de ciudad (default, usado para las 133 ciudades existentes)

-- 1. Agregar columna station_type (no rompe registros existentes)
ALTER TABLE weather_config
  ADD COLUMN IF NOT EXISTS station_type text NOT NULL DEFAULT 'city';

-- 2. Insertar estaciones WMO (evita duplicados por nombre+país)
INSERT INTO weather_config
  (location_name, country, lat, lon, rain_threshold_mm_h, wind_threshold_kmh, enabled, station_type)
SELECT
  n.location_name, n.country, n.lat, n.lon,
  n.rain_mm_h, n.wind_kmh, true, 'synoptic'
FROM (VALUES
  -- ── Guatemala ───────────────────────────────────────────────
  ('Est. INSIVUMEH (Ciudad de Guatemala)',   'Guatemala',             14.5800,  -90.5200, 10.0, 50.0),

  -- ── Belice ──────────────────────────────────────────────────
  ('Est. Philip S.W. Goldson Intl',         'Belice',                17.5390,  -88.3080, 12.0, 65.0),

  -- ── El Salvador ─────────────────────────────────────────────
  ('Est. San Salvador / Ilopango',          'El Salvador',           13.7000,  -89.1170, 10.0, 50.0),
  ('Est. Acajutla',                         'El Salvador',           13.5670,  -89.8330, 12.0, 60.0),
  ('Est. La Unión',                         'El Salvador',           13.3300,  -87.8300, 10.0, 55.0),

  -- ── Honduras ────────────────────────────────────────────────
  ('Est. Toncontín Intl (Tegucigalpa)',      'Honduras',              14.0500,  -87.2170, 10.0, 50.0),
  ('Est. La Mesa Intl (San Pedro Sula)',     'Honduras',              15.4530,  -87.9240, 12.0, 55.0),
  ('Est. Golosón Intl (La Ceiba)',           'Honduras',              15.7420,  -86.8530, 12.0, 60.0),
  ('Est. Choluteca',                        'Honduras',              13.2300,  -87.1500, 10.0, 50.0),
  ('Est. Puerto Lempira',                   'Honduras',              15.2170,  -83.8000, 12.0, 65.0),
  ('Est. Catacamas',                        'Honduras',              14.8300,  -88.8600, 10.0, 50.0),
  ('Est. Puerto Castilla',                  'Honduras',              16.0170,  -85.9500, 12.0, 65.0),
  ('Est. Swan Island',                      'Honduras',              17.4000,  -83.9330, 12.0, 75.0),

  -- ── Nicaragua ───────────────────────────────────────────────
  ('Est. A.C. Sandino Intl (Managua)',       'Nicaragua',             12.1410,  -86.1680, 10.0, 50.0),
  ('Est. Corinto',                          'Nicaragua',             12.4833,  -87.1833, 12.0, 65.0),
  ('Est. Juigalpa',                         'Nicaragua',             12.1000,  -85.3670, 10.0, 50.0),
  ('Est. Hacienda San Francisco',           'Nicaragua',             12.9500,  -85.8600, 10.0, 50.0),
  ('Est. San Dionisio',                     'Nicaragua',             12.8800,  -86.4100, 10.0, 50.0),
  ('Est. Guasimón',                         'Nicaragua',             12.9300,  -85.5300, 10.0, 50.0),

  -- ── Costa Rica ──────────────────────────────────────────────
  ('Est. Juan Santamaría Intl (San José)',   'Costa Rica',             9.9940,  -84.2090, 15.0, 50.0),
  ('Est. Liberia / Daniel O. Cruz',          'Costa Rica',            10.6000,  -85.5330, 10.0, 55.0),
  ('Est. Puerto Limón',                     'Costa Rica',             9.9670,  -83.0170, 15.0, 60.0),
  ('Est. Puntarenas',                       'Costa Rica',             9.9670,  -84.8330, 12.0, 60.0),
  ('Est. Palmar Sur',                       'Costa Rica',             8.9500,  -83.4670, 15.0, 55.0),
  ('Est. Fabio Baudrit (Alajuela)',          'Costa Rica',            10.0100,  -84.2600, 15.0, 50.0),

  -- ── Panamá ──────────────────────────────────────────────────
  ('Est. Marcos A. Gelabert (Albrook)',      'Panamá',                 8.9670,  -79.5500, 15.0, 55.0),
  ('Est. Coco Solo (Colón)',                'Panamá',                 9.3670,  -79.9000, 15.0, 65.0),
  ('Est. Chepo',                            'Panamá',                 9.1000,  -79.0800, 12.0, 50.0),
  ('Est. Boca del Toabre (Penonomé)',        'Panamá',                 8.9100,  -80.5500, 10.0, 50.0),
  ('Est. La Mesa de Macaracas',             'Panamá',                 7.6300,  -80.6100, 10.0, 50.0),
  ('Est. El Palmar (Chiriquí)',              'Panamá',                 8.5300,  -81.0600, 10.0, 50.0),

  -- ── República Dominicana ────────────────────────────────────
  ('Est. Las Américas Intl (Sto. Domingo)', 'República Dominicana',  18.4330,  -69.8830, 10.0, 60.0),
  ('Est. San Isidro (Fuerza Aérea)',        'República Dominicana',  18.5000,  -69.7500, 10.0, 60.0),
  ('Est. Gregorio Luperón Intl (Pto. Plata)','República Dominicana', 19.7500,  -70.5500, 10.0, 65.0),
  ('Est. Punta Cana Intl',                  'República Dominicana',  18.5670,  -68.3630, 10.0, 65.0),
  ('Est. María Montez Intl (Barahona)',     'República Dominicana',  18.2510,  -71.1200, 10.0, 60.0)

) AS n(location_name, country, lat, lon, rain_mm_h, wind_kmh)
WHERE NOT EXISTS (
  SELECT 1 FROM weather_config w
  WHERE w.location_name = n.location_name
    AND w.country       = n.country
);

-- Verificación rápida
SELECT station_type, count(*) FROM weather_config GROUP BY station_type ORDER BY station_type;
