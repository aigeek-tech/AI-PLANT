# -*- coding: utf-8 -*-
import os
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:55432/smart_design")

print("Applying Tag parent hierarchy migration...")

try:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
            ALTER TABLE tag 
            ADD COLUMN IF NOT EXISTS parent_tag_id uuid REFERENCES tag(id) ON DELETE CASCADE;
            """)
            
            cur.execute("""
            CREATE INDEX IF NOT EXISTS tag_parent_tag_id_idx ON tag (parent_tag_id);
            """)
            
            print("Migration applied successfully: tag.parent_tag_id added")
except Exception as e:
    print(f"Error applying migration: {e}")
