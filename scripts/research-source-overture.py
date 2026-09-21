"""Freeze a minimal US source extract. Requires duckdb==1.5.5.

No website scans, contacts, street addresses, or paid services are used here.
The output is operational source data, not a publication artifact.
"""

import argparse
from pathlib import Path

import duckdb

RELEASE = "2026-08-19.0"
SOURCE = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit("Refusing to overwrite an existing source snapshot")
args.output.parent.mkdir(parents=True, exist_ok=True)

connection = duckdb.connect()
connection.execute("INSTALL httpfs; LOAD httpfs;")
connection.execute("SET s3_region='us-west-2'; SET threads=2; SET memory_limit='1GB'; SET enable_progress_bar=false;")

# Bbox predicate pushdown avoids reading the global collection. The four boxes
# cover the contiguous states, Alaska, Hawaii and Alaska's dateline islands.
# The country + state checks remain authoritative for membership, not the boxes.
query = f"""
SELECT id AS source_id, addresses[1].region AS region, websites,
       taxonomy.primary AS category, taxonomy.hierarchy AS hierarchy,
       basic_category, confidence, CAST(sources AS JSON) AS provenance
FROM read_parquet('{SOURCE}', hive_partitioning=true)
WHERE (
    (bbox.xmin BETWEEN -125 AND -66 AND bbox.ymin BETWEEN 24 AND 50)
 OR (bbox.xmin BETWEEN -180 AND -129 AND bbox.ymin BETWEEN 51 AND 72)
 OR (bbox.xmin BETWEEN -161 AND -154 AND bbox.ymin BETWEEN 18 AND 23)
 OR (bbox.xmin BETWEEN 170 AND 180 AND bbox.ymin BETWEEN 51 AND 72)
)
AND addresses[1].country='US'
AND addresses[1].region IN (
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
)
AND array_length(websites)>0 AND brand IS NULL
AND confidence>=0.9 AND operating_status='open'
"""
print(f"Reading minimal eligible US records from Overture {RELEASE}", flush=True)
connection.execute(f"COPY ({query}) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(args.output)])
summary = connection.execute(
    "SELECT basic_category,count(*) n FROM read_parquet(?) GROUP BY 1 ORDER BY n DESC LIMIT 150",
    [str(args.output)],
).fetchall()
print({"release": RELEASE, "output_bytes": args.output.stat().st_size, "category_counts": summary}, flush=True)
