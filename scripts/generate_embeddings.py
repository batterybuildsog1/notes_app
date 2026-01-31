import os
import psycopg2
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv(".env.local")

# Database connection
DATABASE_URL = os.environ.get("DATABASE_URL")
# OpenAI API Key from environment
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is required")

client = OpenAI(api_key=OPENAI_API_KEY)

def get_embedding(text, model="text-embedding-3-small"):
    text = text.replace("\n", " ")
    return client.embeddings.create(input=[text], model=model).data[0].embedding

def process_notes():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Get notes without embeddings
    cur.execute("SELECT id, title, content FROM notes WHERE embedding IS NULL")
    notes = cur.fetchall()
    
    print(f"Found {len(notes)} notes to process.")

    for note_id, title, content in notes:
        try:
            full_text = f"{title}\n\n{content}"
            # Limit length to avoid token limits (conservative limit)
            truncated_text = full_text[:8000] 
            
            embedding = get_embedding(truncated_text)
            
            cur.execute(
                "UPDATE notes SET embedding = %s, indexed_at = NOW() WHERE id = %s",
                (embedding, note_id)
            )
            conn.commit()
            print(f"Processed note {note_id}: {title}")
        except Exception as e:
            print(f"Error processing note {note_id}: {e}")
            conn.rollback()

    cur.close()
    conn.close()
    print("Finished processing notes.")

if __name__ == "__main__":
    process_notes()
