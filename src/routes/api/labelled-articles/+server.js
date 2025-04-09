import { json } from '@sveltejs/kit';

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
        const stmt = db.prepare(`
            SELECT 
                id, 
                title, 
                label_human_centered, 
                label_active_voice, 
                label_crash_vs_accident, 
                label_human_story

            FROM articles 
            WHERE is_labelled = TRUE 
            ORDER BY id 
        `);
        
        // D1 returns results in a structured object
        const { results: labelledArticles } = await stmt.all();

        const count = labelledArticles?.length ?? 0;
        console.log(`[${new Date().toISOString()}] Found ${count} labelled articles for ${clientAddress}.`);
        return json(labelledArticles || []); // Return empty array if results are null/undefined

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching labelled articles for ${clientAddress}:`, error);
        return json({ error: 'Failed to fetch labelled articles' }, { status: 500 });
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