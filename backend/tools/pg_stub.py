"""PostGIS 없는 PostgreSQL(pgserver)에서 스키마를 쓰기 위한 바꿔치기. 테스트와 로컬 실행(dev_local)만 쓴다.

geography 칸을 bytea로 바꾸고, GeoAlchemy·앱이 부르는 함수 몇 개를 흉내 낸다(EWKT 문자열을 그대로 보관).
좌표 계산(범위·최단 경로)은 앱이 파이썬(shapely)으로 하므로 PostGIS 함수가 더 필요하지 않다.
"""
import re

STUBS = r"""
CREATE FUNCTION ST_GeogFromText(text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1, 'UTF8') $$;
CREATE FUNCTION ST_AsBinary(bytea) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION ST_AsEWKB(bytea) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
-- 보관한 EWKT 문자열을 GeoJSON으로 바꾼다(Point·LineString·Polygon·MultiPolygon)
CREATE FUNCTION ST_AsGeoJSON(g bytea, digits int DEFAULT 9) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE t text; typ text; body text; name text;
BEGIN
  t := regexp_replace(convert_from(g, 'UTF8'), '^SRID=\d+;', '');
  typ := upper(trim(split_part(t, '(', 1)));
  body := substr(t, position('(' in t));
  body := regexp_replace(body, '(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)\s+(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)', '[\1,\2]', 'g');
  body := regexp_replace(replace(replace(body, '(', '['), ')', ']'), '\s+', '', 'g');
  IF typ = 'POINT' THEN body := substr(body, 2, length(body) - 2); END IF;
  name := CASE typ WHEN 'POINT' THEN 'Point' WHEN 'LINESTRING' THEN 'LineString'
                   WHEN 'POLYGON' THEN 'Polygon' WHEN 'MULTIPOLYGON' THEN 'MultiPolygon' END;
  RETURN '{"type":"' || name || '","coordinates":' || body || '}';
END $f$;
"""


def without_postgis(sql: str) -> str:
    sql = sql.replace("CREATE EXTENSION IF NOT EXISTS postgis;", "")
    sql = re.sub(r"geography\([A-Z]+,4326\)", "bytea", sql)
    sql = re.sub(r"CREATE INDEX \w+ ON \w+ USING gist \(\w+\);", "", sql)  # bytea에는 gist 인덱스 불가
    return STUBS + sql
