import psycopg

with psycopg.connect('postgresql://postgres:postgres@localhost:55432/smart_design') as conn:
    cursor = conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'tag';")
    print([r[0] for r in cursor.fetchall()])
