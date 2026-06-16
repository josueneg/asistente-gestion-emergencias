-- Agregar país a ubicaciones de monitoreo de clima
alter table weather_config
  add column if not exists country text;

-- Agregar país, coordenadas y vigencia a alertas
alter table alerts
  add column if not exists country text,
  add column if not exists valid_until timestamptz,
  add column if not exists lat float8,
  add column if not exists lon float8;
