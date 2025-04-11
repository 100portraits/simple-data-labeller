import { json } from '@sveltejs/kit';

const REQUIRED_LABELS_PER_ARTICLE = 3; // Must match config in other APIs

export async function GET(event) {
    const clientAddress = event.getClientAddress();
    // Get D1 instance from Cloudflare environment
    const db = event.platform?.env?.DB;
    if (!db) {
        console.error(`[${new Date().toISOString()}] D1 Database binding 'DB' not found.`);
        return json({ error: 'Database connection failed' }, { status: 500 });
    }
    
    console.log(`[${new Date().toISOString()}] GET /api/labelled-articles requested by ${clientAddress}`);

    try {
        // Find articles that have reached the required number of labels.
        // Also calculate the average numeric rating (ignoring 'Not sure') for display.
        const stmt = db.prepare(`
            SELECT 
                a.id, 
                a.title,
                COUNT(l.id) as label_count,
                AVG(CASE WHEN l.rating IS NOT NULL THEN l.rating ELSE NULL END) as avg_rating,
                SUM(CASE WHEN l.rating_text = 'Not sure' THEN 1 ELSE 0 END) as not_sure_count
            FROM articles a
            JOIN labels l ON a.id = l.article_id
            GROUP BY a.id, a.title
            HAVING COUNT(l.id) >= ?1
            ORDER BY a.id DESC -- Show most recently completed potentially?
        `).bind(REQUIRED_LABELS_PER_ARTICLE);
        
        const { results: labelledArticles } = await stmt.all();

        const count = labelledArticles?.length ?? 0;
        console.log(`[${new Date().toISOString()}] Found ${count} fully labelled articles for ${clientAddress}.`);
        return json(labelledArticles || []); // Return empty array if needed

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching labelled articles data for ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch labelled articles data' }, { status: 500 });
    }
}

// Add a handler for potential OPTIONS requests if needed (CORS)
// export async function OPTIONS() {
//     return new Response(null, {
//         headers: {
//             'Access-Control-Allow-Methods': 'GET, OPTIONS',
//             'Access-Control-Allow-Origin': '*', // Adjust as necessary for security
//             'Access-Control-Allow-Headers': 'Content-Type',
//         }
//     });
// } 