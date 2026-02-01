/**
 * Note Enrichment - OpenAI Embeddings + Grok Tag Suggestions
 * 
 * Called on note create/update to:
 * 1. Generate embeddings via OpenAI text-embedding-3-small
 * 2. Get tag suggestions via Grok API
 */

const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";
const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

/**
 * Generate embedding for note content using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENRICHMENT] OPENAI_API_KEY not set, skipping embedding");
    return null;
  }

  try {
    // Truncate to ~8000 chars to stay within token limits
    const truncatedText = text.slice(0, 8000);

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncatedText,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENRICHMENT] OpenAI embedding error:", error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error("[ENRICHMENT] Embedding generation failed:", error);
    return null;
  }
}

/**
 * Get tag suggestions from Grok based on note content
 */
export async function suggestTags(
  title: string,
  content: string,
  existingTags: string[] = []
): Promise<string[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[ENRICHMENT] XAI_API_KEY not set, skipping tag suggestions");
    return [];
  }

  try {
    const prompt = `Analyze this note and suggest 2-4 relevant tags. Return ONLY a JSON array of lowercase tag strings, nothing else.

Title: ${title}

Content: ${content.slice(0, 2000)}

Existing tags to avoid duplicating: ${existingTags.join(", ") || "none"}

Rules:
- Tags should be 1-2 words, lowercase, no spaces (use hyphens)
- Focus on topics, projects, or themes
- Be specific, not generic (avoid "notes", "work", "stuff")
- Return empty array [] if no good tags come to mind

JSON array only:`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[ENRICHMENT] Grok tag suggestion error:", error);
      return [];
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "[]";
    
    // Parse JSON array from response (handle multiline with replace)
    const cleanedResponse = responseText.replace(/\n/g, " ");
    const match = cleanedResponse.match(/\[.*\]/);
    if (match) {
      const tags = JSON.parse(match[0]);
      return Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : [];
    }
    
    return [];
  } catch (error) {
    console.error("[ENRICHMENT] Tag suggestion failed:", error);
    return [];
  }
}

/**
 * Suggest category based on note content
 */
export async function suggestCategory(
  title: string,
  content: string
): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  try {
    const prompt = `Categorize this note into ONE of these categories: Work, Personal, Ideas, Reference, Archive, Solar, Real-Estate, Finance, Family.

Title: ${title}
Content: ${content.slice(0, 1000)}

Respond with ONLY the category name, nothing else:`;

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const category = data.choices[0]?.message?.content?.trim();
    
    const validCategories = ["Work", "Personal", "Ideas", "Reference", "Archive", "Solar", "Real-Estate", "Finance", "Family"];
    return validCategories.includes(category) ? category : null;
  } catch {
    return null;
  }
}

/**
 * Full enrichment pipeline - call on note save
 */
export async function enrichNote(
  title: string,
  content: string,
  existingTags: string[] = [],
  existingCategory: string | null = null
): Promise<{
  embedding: number[] | null;
  suggestedTags: string[];
  suggestedCategory: string | null;
}> {
  const fullText = `${title}\n\n${content}`;

  // Run embedding and tag suggestion in parallel
  const [embedding, suggestedTags, suggestedCategory] = await Promise.all([
    generateEmbedding(fullText),
    suggestTags(title, content, existingTags),
    existingCategory ? Promise.resolve(null) : suggestCategory(title, content),
  ]);

  return {
    embedding,
    suggestedTags,
    suggestedCategory,
  };
}
