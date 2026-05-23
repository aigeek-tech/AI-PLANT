import os
import psycopg

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:55432/smart_design")

print("Applying PBS split migrations...")

try:
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Create pbs_node table
            cur.execute("""
            CREATE TABLE IF NOT EXISTS pbs_node (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                parent_id uuid REFERENCES pbs_node(id) ON DELETE CASCADE,
                code text NOT NULL,
                name text NOT NULL,
                description text,
                node_type text DEFAULT 'folder',
                status text NOT NULL DEFAULT 'active',
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE(project_id, code)
            );
            """)
            
            # Add pbs_node_id to tag table
            cur.execute("""
            ALTER TABLE tag 
            ADD COLUMN IF NOT EXISTS pbs_node_id uuid REFERENCES pbs_node(id) ON DELETE CASCADE;
            """)
            
            # Prevent dropping parent_id entirely unless exists
            cur.execute("""
            ALTER TABLE tag 
            DROP COLUMN IF EXISTS parent_id;
            """)
            
            print("Migration applied successfully")
except Exception as e:
    print(f"Error applying migration: {e}")
